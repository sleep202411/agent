import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
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
import {
  EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  ExperienceCoreChargeFeedbackRendererConfigSchema,
  ExperienceCoreVideoRendererConfigSchema,
  type ExperienceOrientation,
  type ExperienceRuntimeManifest,
  type ExperienceScene,
  type ExperienceSpatialAnchor,
  type ExperienceSpatialGeometry,
} from "@repo/shared/experience-runtime";

import {
  isStillVideoVariant,
  resolveVideoMedia,
  stillClipDurationMs,
} from "../lib/experience-media";
import {
  evaluateExperienceSwipe,
  type ExperienceSwipeGesture,
} from "../lib/experience-swipe-gesture";
import { localize } from "../lib/localize";

/**
 * Wall-clock grace before an untouched timeline-control charge times out.
 * The scene media is paused while the gate is up, so the media-driven window
 * timeout can never fire on its own; without this the clip would freeze
 * forever waiting for a press that never comes.
 */
const TIMELINE_CONTROL_IDLE_TIMEOUT_MS = 3_000;
const INTERACTION = "rgba(77,141,255,0.75)";
const INTERACTION_FILL = "rgba(77,141,255,0.12)";

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
  const [viewportSize, setViewportSize] = useState<ExperienceSize | null>(null);
  const layerOriginRef = useRef({ x: 0, y: 0 });
  const layerRef = useRef<View>(null);
  const [settledGestureIds, setSettledGestureIds] = useState<ReadonlySet<string>>(() => new Set());
  const settledRef = useRef(settledGestureIds);
  const [gateStates, setGateStates] = useState<ReadonlyMap<string, boolean>>(() => new Map());

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    setViewportSize((current) =>
      current && current.width === width && current.height === height ? current : { width, height }
    );
    layerRef.current?.measureInWindow((x, y) => {
      layerOriginRef.current = { x, y };
    });
  };

  const handleGateStateChange = useCallback((gestureId: string, gating: boolean) => {
    setGateStates((current) => {
      if (current.get(gestureId) === gating) return current;
      const next = new Map(current);
      next.set(gestureId, gating);
      return next;
    });
  }, []);
  const timelineHoldGate = [...gateStates.values()].some(Boolean);
  useEffect(() => {
    onTimelineHoldGateChange?.(timelineHoldGate);
  }, [onTimelineHoldGateChange, timelineHoldGate]);
  useEffect(() => {
    return () => onTimelineHoldGateChange?.(false);
  }, [onTimelineHoldGateChange]);

  const markGestureSettled = useCallback((gestureId: string) => {
    if (settledRef.current.has(gestureId)) return false;
    const next = new Set(settledRef.current);
    next.add(gestureId);
    settledRef.current = next;
    setSettledGestureIds(next);
    return true;
  }, []);

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
        return !settledRef.current.has(event.sourceId);
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
    if (!viewportSize) return [] as PressHoldPresentation[];
    return scene.gestures.flatMap((gesture) => {
      if (gesture.kind !== "press-hold") return [];
      const built = buildPresentation(manifest, scene, gesture, {
        locale,
        orientation,
        rendererTransforms,
        runtimeState,
        sceneTimeMs,
        settledGestureIds,
        viewportSize,
      });
      return built ? [built] : [];
    });
  }, [
    locale,
    manifest,
    orientation,
    rendererTransforms,
    runtimeState,
    scene,
    sceneTimeMs,
    settledGestureIds,
    viewportSize,
  ]);

  const tapPresentations = useMemo(() => {
    if (!viewportSize) return [] as TapPresentation[];
    return scene.gestures.flatMap((gesture) => {
      if (gesture.kind !== "tap") return [];
      const built = buildTapPresentation(manifest, scene, gesture, {
        locale,
        orientation,
        rendererTransforms,
        runtimeState,
        sceneTimeMs,
        settledGestureIds,
        viewportSize,
      });
      return built ? [built] : [];
    });
  }, [
    locale,
    manifest,
    orientation,
    rendererTransforms,
    runtimeState,
    scene,
    sceneTimeMs,
    settledGestureIds,
    viewportSize,
  ]);

  const swipePresentations = useMemo(() => {
    if (!viewportSize) return [] as SwipePresentation[];
    return scene.gestures.flatMap((gesture) => {
      if (gesture.kind !== "swipe") return [];
      const built = buildSwipePresentation(manifest, scene, gesture, {
        locale,
        orientation,
        rendererTransforms,
        runtimeState,
        sceneTimeMs,
        settledGestureIds,
        viewportSize,
      });
      return built ? [built] : [];
    });
  }, [
    locale,
    manifest,
    orientation,
    rendererTransforms,
    runtimeState,
    scene,
    sceneTimeMs,
    settledGestureIds,
    viewportSize,
  ]);

  useEffect(() => {
    const timedOutEvents = scene.gestures.flatMap((gesture): ExperienceRuntimeEvent[] => {
      if (
        !gesture.activeWindow ||
        sceneTimeMs < gesture.activeWindow.endMs ||
        settledRef.current.has(gesture.gestureId) ||
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
    <View ref={layerRef} pointerEvents="box-none" style={styles.layer} onLayout={handleLayout}>
      {presentations.map((presentation) => (
        <PressHoldControl
          key={presentation.gesture.gestureId}
          presentation={presentation}
          runtimeState={runtimeState}
          sceneTimeMs={sceneTimeMs}
          layerOriginRef={layerOriginRef}
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
    </View>
  );
}

function TapControl({
  presentation,
  onEvents,
}: {
  presentation: TapPresentation;
  onEvents: (events: readonly ExperienceRuntimeEvent[]) => void;
}) {
  const bounds = hotspotBounds(presentation.geometry, presentation.transform);
  return (
    <HotspotFrame
      bounds={bounds}
      available={presentation.available}
      zIndex={30}
      label={presentation.description ?? presentation.label}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={presentation.description ?? presentation.label}
        disabled={!presentation.available}
        onPress={() =>
          onEvents([{ type: "gesture.completed", sourceId: presentation.gestureId, payload: {} }])
        }
        style={StyleSheet.absoluteFill}
      >
        <View style={styles.hotspotChrome} />
      </Pressable>
    </HotspotFrame>
  );
}

function SwipeControl({
  presentation,
  onEvents,
}: {
  presentation: SwipePresentation;
  onEvents: (events: readonly ExperienceRuntimeEvent[]) => void;
}) {
  const pointerRef = useRef<{ x: number; y: number; startedAt: number } | null>(null);
  const bounds = hotspotBounds(presentation.geometry, presentation.transform);

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

  return (
    <HotspotFrame
      bounds={bounds}
      available={presentation.available}
      zIndex={30}
      label={presentation.description ?? presentation.label}
    >
      <View
        accessible
        accessibilityLabel={presentation.description ?? presentation.label}
        accessibilityRole="button"
        pointerEvents={presentation.available ? "auto" : "none"}
        style={StyleSheet.absoluteFill}
        onStartShouldSetResponder={() => presentation.available}
        onResponderGrant={(event) => {
          pointerRef.current = {
            x: event.nativeEvent.pageX,
            y: event.nativeEvent.pageY,
            startedAt: performance.now(),
          };
        }}
        onResponderRelease={(event) => {
          const pointer = pointerRef.current;
          if (!pointer) return;
          pointerRef.current = null;
          const durationMs = Math.max(0, Math.round(performance.now() - pointer.startedAt));
          const evaluation = evaluateExperienceSwipe(presentation.gesture, {
            deltaX: event.nativeEvent.pageX - pointer.x,
            deltaY: event.nativeEvent.pageY - pointer.y,
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
        }}
        onResponderTerminate={cancelPointer}
      >
        <View style={styles.hotspotChrome} />
      </View>
    </HotspotFrame>
  );
}

function PressHoldControl({
  presentation,
  runtimeState,
  sceneTimeMs,
  layerOriginRef,
  onEvents,
  onRuntimeError,
  onGateStateChange,
}: {
  presentation: PressHoldPresentation;
  runtimeState: ExperienceRuntimeState;
  sceneTimeMs: number;
  layerOriginRef: { current: { x: number; y: number } };
  onEvents: (events: readonly ExperienceRuntimeEvent[]) => void;
  onRuntimeError: (message: string) => void;
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

  const timelineCompleted = timelineControl && timelinePressed && timelineProgress >= 1;
  if (timelineCompleted && !timelineResolved) setTimelineResolved(true);
  const timelineCompletionSent = useRef(false);
  useEffect(() => {
    if (!timelineCompleted || timelineCompletionSent.current) return;
    timelineCompletionSent.current = true;
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
    timelineCompleted,
  ]);

  useEffect(() => {
    if (!timelineGate) return;
    const timer = setTimeout(() => {
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
    return () => clearTimeout(timer);
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

  useEffect(() => {
    latestRef.current = { gesture, runtimeState, sceneTimeMs };
  }, [gesture, runtimeState, sceneTimeMs]);

  const bounds = hotspotBounds(geometry, transform);

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
        ? requestAnimationFrame(runFrameRef.current)
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
    animationFrameRef.current = requestAnimationFrame(runFrameRef.current);
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
  }, [ensureAnimationFrame, step, timelineControl, timelineProgress]);

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
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

  const updatePointerInside = (event: GestureResponderEvent) => {
    const origin = layerOriginRef.current;
    pointerInsideRef.current = hitTestExperienceGeometry(
      geometry,
      { x: event.nativeEvent.pageX - origin.x, y: event.nativeEvent.pageY - origin.y },
      transform
    );
  };

  const displayProgress = timelineControl ? timelineProgress : state.progress;
  const displayPressing = timelineControl ? timelinePressed : state.status === "pressing";
  const displayCompleted = timelineControl ? timelineResolved : state.status === "completed";

  return (
    <HotspotFrame
      bounds={bounds}
      available={presentation.available}
      zIndex={presentation.layer}
      label={presentation.description ?? presentation.label}
    >
      <View
        accessible
        accessibilityLabel={presentation.description ?? presentation.label}
        accessibilityRole="button"
        accessibilityState={{ disabled: !presentation.available, selected: displayPressing }}
        pointerEvents={presentation.available ? "auto" : "none"}
        style={StyleSheet.absoluteFill}
        onStartShouldSetResponder={() => presentation.available}
        onResponderGrant={() => startPress()}
        onResponderMove={updatePointerInside}
        onResponderRelease={(event) => {
          updatePointerInside(event);
          stopPress();
        }}
        onResponderTerminate={stopPress}
      >
        <View style={styles.holdStage} pointerEvents="none">
          <View
            style={[
              styles.holdRing,
              displayPressing && styles.holdRingPressing,
              displayCompleted && styles.holdRingCompleted,
            ]}
          >
            <View
              style={[
                styles.holdCore,
                presentation.appearance === "target" && styles.holdTarget,
                { opacity: 0.35 + displayProgress * 0.65 },
              ]}
            />
          </View>
        </View>
      </View>
    </HotspotFrame>
  );
}

function HotspotFrame({
  bounds,
  available,
  zIndex,
  label,
  children,
}: {
  bounds: { x: number; y: number; width: number; height: number };
  available: boolean;
  zIndex: number;
  label: string;
  children: ReactNode;
}) {
  return (
    <View
      accessibilityElementsHidden={!available}
      importantForAccessibility={available ? "yes" : "no-hide-descendants"}
      pointerEvents="box-none"
      style={[
        styles.hotspot,
        {
          left: bounds.x,
          top: bounds.y,
          width: Math.max(1, bounds.width),
          height: Math.max(1, bounds.height),
          zIndex,
          opacity: available ? 1 : 0,
        },
      ]}
      accessibilityLabel={label}
    >
      {children}
    </View>
  );
}

function hotspotBounds(
  geometry: ExperienceSpatialGeometry,
  transform: ExperienceMediaContentTransform
) {
  const projected = projectExperienceGeometryToViewport(geometry, transform);
  return boundsOfExperienceProjectedGeometry(projected);
}

type PresentationContext = {
  locale: string;
  orientation: ExperienceOrientation;
  rendererTransforms: ReadonlyMap<string, ExperienceMediaContentTransform>;
  runtimeState: ExperienceRuntimeState;
  sceneTimeMs: number;
  settledGestureIds: ReadonlySet<string>;
  viewportSize: ExperienceSize;
};

function resolveTransform(
  anchor: ExperienceSpatialAnchor,
  context: PresentationContext
): ExperienceMediaContentTransform | undefined {
  return anchor.space.kind === "viewport"
    ? createMediaContentTransform(context.viewportSize, context.viewportSize, "contain")
    : context.rendererTransforms.get(anchor.space.rendererInstanceId);
}

function buildPressHoldExtras(
  manifest: ExperienceRuntimeManifest,
  scene: ExperienceScene,
  gesture: ExperiencePressHoldGesture,
  locale: string
) {
  const feedback = gesture.feedbackRendererInstanceId
    ? scene.renderers.find((renderer) => renderer.instanceId === gesture.feedbackRendererInstanceId)
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
  return {
    label: labelSource
      ? localize(labelSource, locale, manifest.localization.defaultLocale)
      : gesture.inputActionId,
    ...(descriptionSource
      ? {
          description: localize(descriptionSource, locale, manifest.localization.defaultLocale),
        }
      : {}),
    appearance: (feedbackConfig?.appearance ?? "ring") as "ring" | "target",
    layer: feedback?.layer ?? 20,
  };
}

function buildPresentation(
  manifest: ExperienceRuntimeManifest,
  scene: ExperienceScene,
  gesture: ExperiencePressHoldGesture,
  context: PresentationContext
): PressHoldPresentation | null {
  const anchor = scene.anchors.find((candidate) => candidate.anchorId === gesture.anchorId);
  if (!anchor) return null;
  const transform = resolveTransform(anchor, context);
  if (!transform) return null;
  return {
    anchor,
    geometry: resolveExperienceAnchorGeometry(anchor, context.orientation, context.sceneTimeMs),
    transform,
    gesture,
    available:
      !context.settledGestureIds.has(gesture.gestureId) &&
      isExperienceGestureAvailable(gesture, context.runtimeState, context.sceneTimeMs),
    ...buildPressHoldExtras(manifest, scene, gesture, context.locale),
  };
}

function actionCopy(
  manifest: ExperienceRuntimeManifest,
  locale: string,
  inputActionId: string
): { label: string; description?: string } {
  const action = manifest.inputActions.find((candidate) => candidate.actionId === inputActionId);
  return {
    label: action
      ? localize(action.label, locale, manifest.localization.defaultLocale)
      : inputActionId,
    ...(action?.accessibilityDescription
      ? {
          description: localize(
            action.accessibilityDescription,
            locale,
            manifest.localization.defaultLocale
          ),
        }
      : {}),
  };
}

function buildTapPresentation(
  manifest: ExperienceRuntimeManifest,
  scene: ExperienceScene,
  gesture: Extract<ExperienceScene["gestures"][number], { kind: "tap" }>,
  context: PresentationContext
): TapPresentation | null {
  const anchor = scene.anchors.find((candidate) => candidate.anchorId === gesture.anchorId);
  if (!anchor) return null;
  const transform = resolveTransform(anchor, context);
  if (!transform) return null;
  return {
    anchor,
    geometry: resolveExperienceAnchorGeometry(anchor, context.orientation, context.sceneTimeMs),
    transform,
    gestureId: gesture.gestureId,
    available:
      !context.settledGestureIds.has(gesture.gestureId) &&
      isExperienceGestureAvailable(gesture, context.runtimeState, context.sceneTimeMs),
    ...actionCopy(manifest, context.locale, gesture.inputActionId),
  };
}

function buildSwipePresentation(
  manifest: ExperienceRuntimeManifest,
  scene: ExperienceScene,
  gesture: ExperienceSwipeGesture,
  context: PresentationContext
): SwipePresentation | null {
  const anchor = scene.anchors.find((candidate) => candidate.anchorId === gesture.anchorId);
  if (!anchor) return null;
  const transform = resolveTransform(anchor, context);
  if (!transform) return null;
  return {
    anchor,
    geometry: resolveExperienceAnchorGeometry(anchor, context.orientation, context.sceneTimeMs),
    transform,
    gesture,
    available:
      !context.settledGestureIds.has(gesture.gestureId) &&
      isExperienceGestureAvailable(gesture, context.runtimeState, context.sceneTimeMs),
    ...actionCopy(manifest, context.locale, gesture.inputActionId),
  };
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
    const clip = videoSequenceClipAtTime(manifest, config, sceneTimeMs, orientation);
    if (!clip) return;
    const media = resolveVideoMedia(manifest.assets, clip.assetId, orientation);
    if (!media?.variant.width || !media.variant.height) return;
    transforms.set(
      renderer.instanceId,
      createMediaContentTransform(
        viewportSize,
        { width: media.variant.width, height: media.variant.height },
        config.fit === "native" ? "contain" : config.fit
      )
    );
  });
  return transforms;
}

function videoSequenceClipAtTime(
  manifest: ExperienceRuntimeManifest,
  config: ReturnType<typeof ExperienceCoreVideoRendererConfigSchema.parse>,
  sceneTimeMs: number,
  orientation: ExperienceOrientation
): { assetId: string } | undefined {
  let offset = 0;
  for (const clip of config.sequence) {
    const media = resolveVideoMedia(manifest.assets, clip.assetId, orientation);
    if (!media) continue;
    const durationMs = isStillVideoVariant(media.variant.mediaType)
      ? stillClipDurationMs(clip)
      : (media.variant.durationMs ?? 0);
    if (durationMs === 0) return clip;
    if (sceneTimeMs < offset + durationMs) return clip;
    offset += durationMs;
  }
  return config.sequence.at(-1);
}

function runtimeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unknown spatial interaction error";
}

const styles = StyleSheet.create({
  // Above video (layer 0) so hotspots receive touches; below choice (100).
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: 30,
  },
  hotspot: {
    position: "absolute",
    overflow: "hidden",
  },
  hotspotChrome: {
    ...StyleSheet.absoluteFill,
    borderWidth: 1,
    borderColor: INTERACTION,
    backgroundColor: INTERACTION_FILL,
  },
  holdStage: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  holdRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    padding: 3,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.2)",
  },
  holdRingPressing: {
    transform: [{ scale: 1.05 }],
  },
  holdRingCompleted: {
    transform: [{ scale: 1.1 }],
  },
  holdCore: {
    flex: 1,
    borderRadius: 21,
    backgroundColor: "rgba(77,141,255,0.55)",
  },
  holdTarget: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.55)",
  },
});
