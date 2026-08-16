"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  ExperienceCoreChargeFeedbackRendererConfigSchema,
  ExperienceCoreVideoRendererConfigSchema,
  type ExperienceLocalizedText,
  type ExperienceOrientation,
  type ExperienceRuntimeManifest,
  type ExperienceScene,
  type ExperienceSpatialAnchor,
  type ExperienceSpatialGeometry,
} from "@repo/shared/experience-runtime";
import {
  boundsOfExperienceProjectedGeometry,
  createExperiencePressHoldState,
  createMediaContentTransform,
  hitTestExperienceGeometry,
  isExperienceGestureAvailable,
  projectExperienceGeometryToViewport,
  resolveExperienceAnchorGeometry,
  stepExperiencePressHoldInRuntime,
  type ExperienceMediaContentTransform,
  type ExperiencePressHoldGesture,
  type ExperiencePressHoldState,
  type ExperienceRuntimeEvent,
  type ExperienceRuntimeState,
  type ExperienceSize,
} from "@repo/experience-engine";
import { classNames } from "./class-names";
import { evaluateExperienceSwipe, type ExperienceSwipeGesture } from "./experience-swipe-gesture";

/**
 * Wall-clock grace before an untouched timeline-control charge times out.
 * The scene media is paused while the gate is up, so the media-driven window
 * timeout can never fire on its own; without this the clip would freeze
 * forever waiting for a press that never comes.
 */
const TIMELINE_CONTROL_IDLE_TIMEOUT_MS = 3_000;

type PressHoldPresentation = {
  anchor: ExperienceSpatialAnchor;
  geometry: ExperienceSpatialGeometry;
  transform: ExperienceMediaContentTransform;
  gesture: ExperiencePressHoldGesture;
  label: string;
  description?: string;
  appearance: "ring" | "target";
  layer: number;
  available: boolean;
};

type TapPresentation = {
  anchor: ExperienceSpatialAnchor;
  geometry: ExperienceSpatialGeometry;
  transform: ExperienceMediaContentTransform;
  gestureId: string;
  label: string;
  description?: string;
  available: boolean;
};

type SwipePresentation = {
  anchor: ExperienceSpatialAnchor;
  geometry: ExperienceSpatialGeometry;
  transform: ExperienceMediaContentTransform;
  gesture: ExperienceSwipeGesture;
  label: string;
  description?: string;
  available: boolean;
};

export function ExperienceSpatialLayer({
  manifest,
  scene,
  runtimeState,
  sceneTimeMs,
  locale,
  orientation,
  onEvents,
  onRuntimeError,
  onTimelineHoldGateChange,
}: {
  manifest: ExperienceRuntimeManifest;
  scene: ExperienceScene;
  runtimeState: ExperienceRuntimeState;
  sceneTimeMs: number;
  locale: string;
  orientation: ExperienceOrientation;
  onEvents: (events: readonly ExperienceRuntimeEvent[]) => void;
  onRuntimeError: (message: string) => void;
  onTimelineHoldGateChange?: (gating: boolean) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const viewportSize = useElementSize(layerRef);
  const settledRef = useRef<{ sceneId: string; gestureIds: Set<string> }>({
    sceneId: scene.sceneId,
    gestureIds: new Set(),
  });
  const [settledVersion, setSettledVersion] = useState(0);
  if (settledRef.current.sceneId !== scene.sceneId) {
    settledRef.current = { sceneId: scene.sceneId, gestureIds: new Set() };
  }
  const settledGestureIds = settledRef.current.gestureIds;
  // Timeline-control gate state per gesture, lifted from PressHoldControl so
  // the host can pause/resume the scene media. Resets with the scene, like
  // the settled set above.
  const gateStatesRef = useRef<{ sceneId: string; gating: Map<string, boolean> }>({
    sceneId: scene.sceneId,
    gating: new Map(),
  });
  const [gateVersion, setGateVersion] = useState(0);
  if (gateStatesRef.current.sceneId !== scene.sceneId) {
    gateStatesRef.current = { sceneId: scene.sceneId, gating: new Map() };
  }
  const handleGateStateChange = useCallback((gestureId: string, gating: boolean) => {
    const current = gateStatesRef.current;
    if (current.gating.get(gestureId) === gating) return;
    current.gating.set(gestureId, gating);
    setGateVersion((version) => version + 1);
  }, []);
  const timelineHoldGate = [...gateStatesRef.current.gating.values()].some(Boolean);
  useEffect(() => {
    onTimelineHoldGateChange?.(timelineHoldGate);
  }, [onTimelineHoldGateChange, timelineHoldGate]);

  const markGestureSettled = useCallback(
    (gestureId: string) => {
      if (settledRef.current.sceneId !== scene.sceneId) {
        settledRef.current = { sceneId: scene.sceneId, gestureIds: new Set() };
      }
      if (settledRef.current.gestureIds.has(gestureId)) return false;
      settledRef.current.gestureIds.add(gestureId);
      setSettledVersion((version) => version + 1);
      return true;
    },
    [scene.sceneId]
  );

  const sceneHandlesGestureEvent = useCallback(
    (gestureId: string, eventType: "gesture.cancelled" | "gesture.timed-out") =>
      scene.eventBindings.some(
        (binding) =>
          binding.on.type === eventType &&
          (binding.on.sourceId === undefined || binding.on.sourceId === gestureId)
      ),
    [scene.eventBindings]
  );

  const emitGestureEvents = useCallback(
    (events: readonly ExperienceRuntimeEvent[]) => {
      const forwarded = events.filter((event) => {
        if (!event.sourceId) return true;
        if (event.type === "gesture.completed") {
          return markGestureSettled(event.sourceId);
        }
        if (
          event.type === "gesture.cancelled" &&
          sceneHandlesGestureEvent(event.sourceId, "gesture.cancelled")
        ) {
          return markGestureSettled(event.sourceId);
        }
        return !settledRef.current.gestureIds.has(event.sourceId);
      });
      if (forwarded.length > 0) onEvents(forwarded);
    },
    [markGestureSettled, onEvents, sceneHandlesGestureEvent]
  );
  const rendererTransforms = useMemo(
    () =>
      viewportSize
        ? createRendererContentTransforms(manifest, scene, orientation, sceneTimeMs, viewportSize)
        : new Map<string, ExperienceMediaContentTransform>(),
    [manifest, orientation, scene, sceneTimeMs, viewportSize]
  );

  const presentations = useMemo(() => {
    if (!viewportSize) return [];
    return scene.gestures.flatMap((gesture) => {
      if (gesture.kind !== "press-hold") return [];
      const anchor = scene.anchors.find((candidate) => candidate.anchorId === gesture.anchorId);
      if (!anchor) return [];
      const transform =
        anchor.space.kind === "viewport"
          ? createMediaContentTransform(viewportSize, viewportSize, "contain")
          : rendererTransforms.get(anchor.space.rendererInstanceId);
      if (!transform) return [];
      const geometry = resolveExperienceAnchorGeometry(anchor, orientation, sceneTimeMs);
      const feedback = gesture.feedbackRendererInstanceId
        ? scene.renderers.find(
            (renderer) => renderer.instanceId === gesture.feedbackRendererInstanceId
          )
        : undefined;
      const feedbackConfig =
        feedback?.rendererId === EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID
          ? ExperienceCoreChargeFeedbackRendererConfigSchema.parse(feedback.config)
          : null;
      const action = manifest.inputActions.find(
        (candidate) => candidate.actionId === gesture.inputActionId
      );
      const labelSource = feedbackConfig?.label ?? action?.label;
      const descriptionSource = action?.accessibilityDescription;
      return [
        {
          anchor,
          geometry,
          transform,
          gesture,
          label: labelSource
            ? localize(labelSource, locale, manifest.localization.defaultLocale)
            : gesture.inputActionId,
          ...(descriptionSource
            ? {
                description: localize(
                  descriptionSource,
                  locale,
                  manifest.localization.defaultLocale
                ),
              }
            : {}),
          appearance: feedbackConfig?.appearance ?? "ring",
          layer: feedback?.layer ?? 20,
          available:
            !settledGestureIds.has(gesture.gestureId) &&
            isExperienceGestureAvailable(gesture, runtimeState, sceneTimeMs),
        } satisfies PressHoldPresentation,
      ];
    });
  }, [
    locale,
    manifest.inputActions,
    manifest.localization.defaultLocale,
    orientation,
    rendererTransforms,
    runtimeState,
    scene,
    sceneTimeMs,
    settledVersion,
    viewportSize,
  ]);
  const tapPresentations = useMemo(() => {
    if (!viewportSize) return [];
    return scene.gestures.flatMap((gesture) => {
      if (gesture.kind !== "tap") return [];
      const anchor = scene.anchors.find((candidate) => candidate.anchorId === gesture.anchorId);
      if (!anchor) return [];
      const transform =
        anchor.space.kind === "viewport"
          ? createMediaContentTransform(viewportSize, viewportSize, "contain")
          : rendererTransforms.get(anchor.space.rendererInstanceId);
      if (!transform) return [];
      const action = manifest.inputActions.find(
        (candidate) => candidate.actionId === gesture.inputActionId
      );
      return [
        {
          anchor,
          geometry: resolveExperienceAnchorGeometry(anchor, orientation, sceneTimeMs),
          transform,
          gestureId: gesture.gestureId,
          label: action
            ? localize(action.label, locale, manifest.localization.defaultLocale)
            : gesture.inputActionId,
          ...(action?.accessibilityDescription
            ? {
                description: localize(
                  action.accessibilityDescription,
                  locale,
                  manifest.localization.defaultLocale
                ),
              }
            : {}),
          available:
            !settledGestureIds.has(gesture.gestureId) &&
            isExperienceGestureAvailable(gesture, runtimeState, sceneTimeMs),
        } satisfies TapPresentation,
      ];
    });
  }, [
    locale,
    manifest.inputActions,
    manifest.localization.defaultLocale,
    orientation,
    rendererTransforms,
    runtimeState,
    scene,
    sceneTimeMs,
    settledVersion,
    viewportSize,
  ]);
  const swipePresentations = useMemo(() => {
    if (!viewportSize) return [];
    return scene.gestures.flatMap((gesture) => {
      if (gesture.kind !== "swipe") return [];
      const anchor = scene.anchors.find((candidate) => candidate.anchorId === gesture.anchorId);
      if (!anchor) return [];
      const transform =
        anchor.space.kind === "viewport"
          ? createMediaContentTransform(viewportSize, viewportSize, "contain")
          : rendererTransforms.get(anchor.space.rendererInstanceId);
      if (!transform) return [];
      const action = manifest.inputActions.find(
        (candidate) => candidate.actionId === gesture.inputActionId
      );
      return [
        {
          anchor,
          geometry: resolveExperienceAnchorGeometry(anchor, orientation, sceneTimeMs),
          transform,
          gesture,
          label: action
            ? localize(action.label, locale, manifest.localization.defaultLocale)
            : gesture.inputActionId,
          ...(action?.accessibilityDescription
            ? {
                description: localize(
                  action.accessibilityDescription,
                  locale,
                  manifest.localization.defaultLocale
                ),
              }
            : {}),
          available:
            !settledGestureIds.has(gesture.gestureId) &&
            isExperienceGestureAvailable(gesture, runtimeState, sceneTimeMs),
        } satisfies SwipePresentation,
      ];
    });
  }, [
    locale,
    manifest.inputActions,
    manifest.localization.defaultLocale,
    orientation,
    rendererTransforms,
    runtimeState,
    scene,
    sceneTimeMs,
    settledVersion,
    viewportSize,
  ]);

  useEffect(() => {
    const timedOutEvents = scene.gestures.flatMap((gesture): ExperienceRuntimeEvent[] => {
      if (
        !gesture.activeWindow ||
        sceneTimeMs < gesture.activeWindow.endMs ||
        settledRef.current.gestureIds.has(gesture.gestureId) ||
        !sceneHandlesGestureEvent(gesture.gestureId, "gesture.timed-out")
      ) {
        return [];
      }
      if (!markGestureSettled(gesture.gestureId)) return [];
      return [
        {
          type: "gesture.timed-out",
          sourceId: gesture.gestureId,
          payload: { sceneTimeMs, activeWindowEndMs: gesture.activeWindow.endMs },
        },
      ];
    });
    if (timedOutEvents.length > 0) onEvents(timedOutEvents);
  }, [markGestureSettled, onEvents, scene.gestures, sceneHandlesGestureEvent, sceneTimeMs]);

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0">
      {presentations.map((presentation) => (
        <PressHoldControl
          key={presentation.gesture.gestureId}
          presentation={presentation}
          runtimeState={runtimeState}
          sceneTimeMs={sceneTimeMs}
          viewportElementRef={layerRef}
          onEvents={emitGestureEvents}
          onRuntimeError={onRuntimeError}
          onGateStateChange={
            presentation.gesture.timelineControl
              ? (gating) => handleGateStateChange(presentation.gesture.gestureId, gating)
              : undefined
          }
        />
      ))}
      {tapPresentations.map((presentation) => (
        <TapControl
          key={presentation.gestureId}
          presentation={presentation}
          onEvents={emitGestureEvents}
        />
      ))}
      {swipePresentations.map((presentation) => (
        <SwipeControl
          key={presentation.gesture.gestureId}
          presentation={presentation}
          onEvents={emitGestureEvents}
        />
      ))}
    </div>
  );
}

function TapControl({
  presentation,
  onEvents,
}: {
  presentation: TapPresentation;
  onEvents: (events: readonly ExperienceRuntimeEvent[]) => void;
}) {
  const projected = projectExperienceGeometryToViewport(
    presentation.geometry,
    presentation.transform
  );
  const bounds = boundsOfExperienceProjectedGeometry(projected);
  const clipPath = geometryClipPath(projected, bounds);
  return (
    <button
      type="button"
      className={classNames(
        "pointer-events-auto absolute touch-manipulation border border-[var(--experience-interaction-color,#4d8dff)]/75 bg-[var(--experience-interaction-color,#4d8dff)]/10 outline-none transition hover:bg-[var(--experience-interaction-color,#4d8dff)]/20 focus-visible:ring-2 focus-visible:ring-white/80",
        !presentation.available && "pointer-events-none opacity-0"
      )}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        clipPath,
        zIndex: 30,
      }}
      aria-label={presentation.description ?? presentation.label}
      aria-disabled={!presentation.available}
      onClick={() =>
        onEvents([
          {
            type: "gesture.completed",
            sourceId: presentation.gestureId,
            payload: {},
          },
        ])
      }
    >
      <span className="sr-only">{presentation.label}</span>
    </button>
  );
}

function SwipeControl({
  presentation,
  onEvents,
}: {
  presentation: SwipePresentation;
  onEvents: (events: readonly ExperienceRuntimeEvent[]) => void;
}) {
  const pointerRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    startedAt: number;
  } | null>(null);
  const projected = projectExperienceGeometryToViewport(
    presentation.geometry,
    presentation.transform
  );
  const bounds = boundsOfExperienceProjectedGeometry(projected);
  const clipPath = geometryClipPath(projected, bounds);

  const emit = useCallback(
    (
      type: "gesture.completed" | "gesture.cancelled",
      payload: Readonly<Record<string, string | number>>
    ) => {
      onEvents([{ type, sourceId: presentation.gesture.gestureId, payload }]);
    },
    [onEvents, presentation.gesture.gestureId]
  );

  const cancelPointer = useCallback(() => {
    const pointer = pointerRef.current;
    if (!pointer) return;
    pointerRef.current = null;
    emit("gesture.cancelled", {
      reason: "pointer-cancelled",
      durationMs: Math.max(0, Math.round(performance.now() - pointer.startedAt)),
    });
  }, [emit]);

  const completePointer = (event: PointerEvent<HTMLButtonElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pointerRef.current = null;
    const durationMs = Math.max(0, Math.round(performance.now() - pointer.startedAt));
    const deltaX = event.clientX - pointer.x;
    const deltaY = event.clientY - pointer.y;
    const evaluation = evaluateExperienceSwipe(presentation.gesture, {
      deltaX,
      deltaY,
      durationMs,
      viewportWidth: bounds.width,
      viewportHeight: bounds.height,
    });
    emit(evaluation.completed ? "gesture.completed" : "gesture.cancelled", {
      direction: evaluation.direction,
      distance: evaluation.distance,
      durationMs: evaluation.durationMs,
      ...(evaluation.completed ? {} : { reason: "gesture-threshold-not-met" }),
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const direction = keyboardSwipeDirection(event.key);
    if (!direction || event.repeat || !presentation.available) return;
    event.preventDefault();
    const completed = presentation.gesture.directions.includes(direction);
    emit(completed ? "gesture.completed" : "gesture.cancelled", {
      direction,
      distance: 1,
      durationMs: 0,
      input: "keyboard",
      ...(completed ? {} : { reason: "direction-not-allowed" }),
    });
  };

  return (
    <button
      type="button"
      className={classNames(
        "pointer-events-auto absolute touch-none select-none border border-[var(--experience-interaction-color,#4d8dff)]/75 bg-[var(--experience-interaction-color,#4d8dff)]/10 outline-none transition hover:bg-[var(--experience-interaction-color,#4d8dff)]/20 focus-visible:ring-2 focus-visible:ring-white/80",
        !presentation.available && "pointer-events-none opacity-0"
      )}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        clipPath,
        zIndex: 30,
      }}
      aria-label={presentation.description ?? presentation.label}
      aria-disabled={!presentation.available}
      onPointerDown={(event) => {
        if (event.button !== 0 || !presentation.available) return;
        event.preventDefault();
        pointerRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          startedAt: performance.now(),
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={completePointer}
      onPointerCancel={cancelPointer}
      onLostPointerCapture={cancelPointer}
      onKeyDown={handleKeyDown}
      onClick={(event) => event.preventDefault()}
    >
      <span className="sr-only">{presentation.label}</span>
    </button>
  );
}

function PressHoldControl({
  presentation,
  runtimeState,
  sceneTimeMs,
  viewportElementRef,
  onEvents,
  onRuntimeError,
  onGateStateChange,
}: {
  presentation: PressHoldPresentation;
  runtimeState: ExperienceRuntimeState;
  sceneTimeMs: number;
  viewportElementRef: RefObject<HTMLDivElement | null>;
  onEvents: (events: readonly ExperienceRuntimeEvent[]) => void;
  onRuntimeError: (message: string) => void;
  /**
   * Timeline-control only: reports whether this gesture currently gates the
   * scene media (window open, unresolved, not held). The host pauses playback
   * while any gate is active so media position equals charge progress.
   */
  onGateStateChange?: (gating: boolean) => void;
}) {
  const { gesture, geometry, transform } = presentation;
  const timelineControl = gesture.timelineControl === true;
  const [state, setState] = useState<ExperiencePressHoldState>(() =>
    createExperiencePressHoldState()
  );
  const stateRef = useRef(state);
  const pressedRef = useRef(false);
  const pointerInsideRef = useRef(true);
  const animationFrameRef = useRef<number | null>(null);
  const previousFrameTimeRef = useRef<number | null>(null);
  const latestRef = useRef({ gesture, runtimeState, sceneTimeMs });
  const runFrameRef = useRef<(time: number) => void>(() => undefined);

  // ── Timeline-control branch ─────────────────────────────────────────────
  // The scene media only advances while the pointer is held, so charge
  // progress is derived from the scene clock instead of wall-clock rAF.
  const timelineWindowStartMs = gesture.activeWindow?.startMs ?? 0;
  const timelineProgress = Math.min(
    1,
    Math.max(0, (sceneTimeMs - timelineWindowStartMs) / gesture.durationMs)
  );
  const [timelinePressed, setTimelinePressed] = useState(false);
  const [timelineResolved, setTimelineResolved] = useState(false);
  const timelinePressedRef = useRef(false);
  const timelineGate =
    timelineControl && presentation.available && !timelineResolved && !timelinePressed;

  useEffect(() => {
    if (!timelineControl) return;
    onGateStateChange?.(timelineGate);
  }, [onGateStateChange, timelineControl, timelineGate]);

  useEffect(() => {
    if (!timelineControl || !timelinePressed || timelineResolved) return;
    if (timelineProgress < 1) return;
    setTimelineResolved(true);
    onEvents([
      {
        type: "gesture.completed",
        sourceId: gesture.gestureId,
        payload: { holdDurationMs: gesture.durationMs, progress: 1 },
      },
    ]);
  }, [
    gesture.durationMs,
    gesture.gestureId,
    onEvents,
    timelineControl,
    timelinePressed,
    timelineProgress,
    timelineResolved,
  ]);

  // A gated charge that nobody presses would freeze the clip forever. The
  // scene clock cannot run to the window end while paused, so the idle
  // timeout is wall-clock and resolves the gesture so playback resumes.
  useEffect(() => {
    if (!timelineGate) return;
    const timer = window.setTimeout(() => {
      timelinePressedRef.current = false;
      setTimelinePressed(false);
      setTimelineResolved(true);
      onEvents([
        {
          type: "gesture.timed-out",
          sourceId: gesture.gestureId,
          payload: { sceneTimeMs, idleTimeout: true },
        },
      ]);
    }, TIMELINE_CONTROL_IDLE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [gesture.gestureId, onEvents, sceneTimeMs, timelineGate]);

  const startTimelinePress = () => {
    if (!presentation.available || timelineResolved) return;
    timelinePressedRef.current = true;
    setTimelinePressed(true);
  };

  const stopTimelinePress = () => {
    if (!timelinePressedRef.current) return;
    timelinePressedRef.current = false;
    setTimelinePressed(false);
    if (timelineResolved) return;
    // Release below the threshold latches failure; the host unpauses so the
    // clip plays its resolve beat to the safe branch frame before the cut.
    setTimelineResolved(true);
    onEvents([
      {
        type: "gesture.cancelled",
        sourceId: gesture.gestureId,
        payload: {
          holdDurationMs: Math.round(timelineProgress * gesture.durationMs),
          progress: timelineProgress,
        },
      },
    ]);
  };
  // ── End timeline-control branch ─────────────────────────────────────────

  useEffect(() => {
    latestRef.current = { gesture, runtimeState, sceneTimeMs };
  }, [gesture, runtimeState, sceneTimeMs]);

  const projected = projectExperienceGeometryToViewport(geometry, transform);
  const bounds = boundsOfExperienceProjectedGeometry(projected);
  const clipPath = geometryClipPath(projected, bounds);

  const emitSignals = useCallback(
    (
      signals: readonly ("started" | "cancelled" | "completed")[],
      nextState: ExperiencePressHoldState
    ) => {
      const events = signals.map((signal): ExperienceRuntimeEvent => {
        const holdDurationMs = Math.round(nextState.progress * gesture.durationMs);
        return {
          type: `gesture.${signal}`,
          sourceId: gesture.gestureId,
          payload: { holdDurationMs, progress: nextState.progress },
        };
      });
      if (events.length > 0) onEvents(events);
    },
    [gesture.durationMs, gesture.gestureId, onEvents]
  );

  const step = useCallback(
    (deltaMs: number) => {
      try {
        const current = latestRef.current;
        const result = stepExperiencePressHoldInRuntime(
          current.gesture,
          stateRef.current,
          {
            pressed: pressedRef.current,
            pointerInside: pointerInsideRef.current,
            deltaMs,
          },
          { state: current.runtimeState, sceneTimeMs: current.sceneTimeMs }
        );
        stateRef.current = result.state;
        setState(result.state);
        emitSignals(result.signals, result.state);
        return result.state;
      } catch (error) {
        onRuntimeError(runtimeErrorMessage(error));
        return stateRef.current;
      }
    },
    [emitSignals, onRuntimeError]
  );

  const runFrame = useCallback(
    (time: number) => {
      const previous = previousFrameTimeRef.current ?? time;
      previousFrameTimeRef.current = time;
      const nextState = step(Math.min(100, Math.max(0, time - previous)));
      const needsNextFrame =
        pressedRef.current || nextState.status === "decaying" || nextState.blockedUntilRelease;
      animationFrameRef.current = needsNextFrame
        ? window.requestAnimationFrame(runFrameRef.current)
        : null;
    },
    [step]
  );

  useEffect(() => {
    runFrameRef.current = runFrame;
  }, [runFrame]);

  const ensureAnimationFrame = useCallback(() => {
    if (animationFrameRef.current !== null) return;
    previousFrameTimeRef.current = null;
    animationFrameRef.current = window.requestAnimationFrame(runFrameRef.current);
  }, []);

  const stopPress = useCallback(() => {
    if (timelineControl) {
      stopTimelinePress();
      return;
    }
    if (!pressedRef.current) return;
    pressedRef.current = false;
    pointerInsideRef.current = true;
    step(0);
    ensureAnimationFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureAnimationFrame, step, timelineControl, timelineProgress]);

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    },
    []
  );

  const startPress = () => {
    if (timelineControl) {
      startTimelinePress();
      return;
    }
    if (!presentation.available || stateRef.current.status === "completed") return;
    pressedRef.current = true;
    pointerInsideRef.current = true;
    step(0);
    ensureAnimationFrame();
  };

  const updatePointerInside = (event: PointerEvent<HTMLButtonElement>) => {
    const viewport = viewportElementRef.current?.getBoundingClientRect();
    if (!viewport) return;
    pointerInsideRef.current = hitTestExperienceGeometry(
      geometry,
      { x: event.clientX - viewport.left, y: event.clientY - viewport.top },
      transform
    );
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startPress();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key !== " " && event.key !== "Enter") || event.repeat) return;
    event.preventDefault();
    startPress();
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    stopPress();
  };

  const displayProgress = timelineControl ? timelineProgress : state.progress;
  const displayPressing = timelineControl ? timelinePressed : state.status === "pressing";
  const displayCompleted = timelineControl ? timelineResolved : state.status === "completed";
  const progressDegrees = Math.round(displayProgress * 360);
  const controlStyle = {
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
    clipPath,
    zIndex: presentation.layer,
  } satisfies CSSProperties;
  const indicatorStyle = {
    background: `conic-gradient(var(--experience-interaction-color,#4d8dff) ${progressDegrees}deg,rgba(255,255,255,.18) ${progressDegrees}deg)`,
  } satisfies CSSProperties;

  return (
    <button
      type="button"
      className={classNames(
        "pointer-events-auto absolute touch-none select-none outline-none transition-opacity",
        !presentation.available && "pointer-events-none opacity-0"
      )}
      style={controlStyle}
      aria-label={presentation.description ?? presentation.label}
      aria-pressed={displayPressing}
      aria-disabled={!presentation.available}
      onPointerDown={handlePointerDown}
      onPointerMove={updatePointerInside}
      onPointerUp={(event) => {
        updatePointerInside(event);
        stopPress();
      }}
      onPointerCancel={stopPress}
      onLostPointerCapture={stopPress}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={stopPress}
      onClick={(event) => event.preventDefault()}
    >
      <span
        className={classNames(
          "absolute top-1/2 left-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full p-[3px] shadow-[0_8px_32px_rgba(0,0,0,0.38)] transition-transform",
          displayPressing && "scale-105",
          displayCompleted && "scale-110"
        )}
        style={indicatorStyle}
        aria-hidden="true"
      >
        <span
          className={classNames(
            "size-full rounded-full border border-white/20 bg-black/60 backdrop-blur-md",
            presentation.appearance === "target" &&
              "before:absolute before:inset-3 before:rounded-full before:border before:border-white/55"
          )}
        />
      </span>
      <span className="sr-only">{presentation.label}</span>
    </button>
  );
}

function createRendererContentTransforms(
  manifest: ExperienceRuntimeManifest,
  scene: ExperienceScene,
  orientation: ExperienceOrientation,
  sceneTimeMs: number,
  viewportSize: ExperienceSize
): ReadonlyMap<string, ExperienceMediaContentTransform> {
  const transforms = new Map<string, ExperienceMediaContentTransform>();
  scene.renderers.forEach((renderer) => {
    if (renderer.rendererId !== EXPERIENCE_CORE_VIDEO_RENDERER_ID) return;
    const config = ExperienceCoreVideoRendererConfigSchema.parse(renderer.config);
    const clip = videoSequenceClipAtTime(manifest, config.sequence, sceneTimeMs, orientation);
    if (!clip) return;
    const media = manifest.assets.find(
      (asset) => asset.assetId === clip.assetId && asset.kind === "video"
    );
    if (!media || media.kind !== "video") return;
    const variant =
      media.variants.find((candidate) => candidate.orientation === orientation) ??
      media.variants[0];
    if (!variant?.width || !variant.height) return;
    transforms.set(
      renderer.instanceId,
      createMediaContentTransform(
        viewportSize,
        { width: variant.width, height: variant.height },
        // Native inline video is never cropped, so its content maps like contain.
        config.fit === "native" ? "contain" : config.fit
      )
    );
  });
  return transforms;
}

function videoSequenceClipAtTime(
  manifest: ExperienceRuntimeManifest,
  sequence: readonly { assetId: string }[],
  sceneTimeMs: number,
  orientation: ExperienceOrientation
): { assetId: string } | undefined {
  let offset = 0;
  for (const clip of sequence) {
    const asset = manifest.assets.find(
      (candidate) => candidate.assetId === clip.assetId && candidate.kind === "video"
    );
    if (!asset || asset.kind !== "video") continue;
    const variant =
      asset.variants.find((candidate) => candidate.orientation === orientation) ??
      asset.variants[0];
    if (!variant) continue;
    if (variant.durationMs === undefined) return clip;
    if (sceneTimeMs < offset + variant.durationMs) return clip;
    offset += variant.durationMs;
  }
  return sequence.at(-1);
}

function geometryClipPath(
  geometry: ReturnType<typeof projectExperienceGeometryToViewport>,
  bounds: { x: number; y: number; width: number; height: number }
): string | undefined {
  if (geometry.kind === "ellipse") return "ellipse(50% 50% at 50% 50%)";
  if (geometry.kind !== "polygon" || bounds.width <= 0 || bounds.height <= 0) return undefined;
  return `polygon(${geometry.points
    .map(
      (point) =>
        `${((point.x - bounds.x) / bounds.width) * 100}% ${((point.y - bounds.y) / bounds.height) * 100}%`
    )
    .join(",")})`;
}

function keyboardSwipeDirection(key: string): ExperienceSwipeGesture["directions"][number] | null {
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  return null;
}

function useElementSize(ref: RefObject<HTMLElement | null>): ExperienceSize | null {
  const [size, setSize] = useState<ExperienceSize | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function localize(value: ExperienceLocalizedText, locale: string, defaultLocale: string): string {
  return value[locale] ?? value[defaultLocale] ?? Object.values(value)[0] ?? "";
}

function runtimeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unknown spatial interaction error";
}
