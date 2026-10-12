import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useGatedScreenActive } from "@/hooks/use-app-active";
import { usePausableTimeout } from "../hooks/use-pausable-timeout";
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
  viewerLocale,
  orientation,
  onEvents,
  onRuntimeError,
  onTimelineHoldGateChange,
  onGestureTapGuardChange,
  onSettledGestureIdsChange,
  initialSettledGestureIds,
}: {
  manifest: ExperienceRuntimeManifest;
  scene: ExperienceScene;
  runtimeState: ExperienceRuntimeState;
  sceneTimeMs: number;
  locale: string;
  /** Viewer UI language for gesture hints. Content copy still uses `locale`. */
  viewerLocale?: string;
  orientation: ExperienceOrientation;
  onEvents: (events: readonly ExperienceRuntimeEvent[]) => void;
  onRuntimeError: (message: string) => void;
  onTimelineHoldGateChange?: (gating: boolean) => void;
  onGestureTapGuardChange?: (guard: ((x: number, y: number) => boolean) | null) => void;
  onSettledGestureIdsChange?: (ids: string[]) => void;
  initialSettledGestureIds?: readonly string[];
}) {
  const [viewportSize, setViewportSize] = useState<ExperienceSize | null>(null);
  const layerOriginRef = useRef({ x: 0, y: 0 });
  const presenting = useGatedScreenActive();
  const layerRef = useRef<View>(null);
  const [settledGestureIds, setSettledGestureIds] = useState<ReadonlySet<string>>(
    () => new Set(initialSettledGestureIds)
  );
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

  const markGestureSettled = useCallback(
    (gestureId: string) => {
      if (settledRef.current.has(gestureId)) return false;
      const next = new Set(settledRef.current);
      next.add(gestureId);
      settledRef.current = next;
      setSettledGestureIds(next);
      onSettledGestureIdsChange?.([...next]);
      return true;
    },
    [onSettledGestureIdsChange]
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
    // Use the same projected boxes as the visible native controls, with the
    // official Web player's 24px grace margin for a finger grazing an edge.
    const bounds = [...presentations, ...tapPresentations, ...swipePresentations]
      .filter((item) => item.available)
      .map((item) => hotspotBounds(item.geometry, item.transform));
    onGestureTapGuardChange?.((pageX, pageY) => {
      if (!viewportSize) return scene.gestures.length > 0;
      const x = pageX - layerOriginRef.current.x;
      const y = pageY - layerOriginRef.current.y;
      return bounds.some(
        (box) =>
          x >= box.x - 24 &&
          x <= box.x + box.width + 24 &&
          y >= box.y - 24 &&
          y <= box.y + box.height + 24
      );
    });
    return () => onGestureTapGuardChange?.(null);
  }, [
    onGestureTapGuardChange,
    presentations,
    tapPresentations,
    swipePresentations,
    viewportSize,
    scene.gestures,
  ]);

  useEffect(() => {
    const timedOutEvents = scene.gestures.flatMap((gesture): ExperienceRuntimeEvent[] => {
      if (
        gesture.holdFrame ||
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

  useEffect(() => {
    for (const gesture of scene.gestures) {
      if (!gesture.holdFrame || !gesture.activeWindow) continue;
      handleGateStateChange(
        gesture.gestureId,
        !settledRef.current.has(gesture.gestureId) && sceneTimeMs >= gesture.activeWindow.endMs
      );
    }
  }, [handleGateStateChange, scene.gestures, sceneTimeMs, settledGestureIds]);

  return (
    <View
      ref={layerRef}
      pointerEvents={presenting ? "box-none" : "none"}
      accessibilityElementsHidden={!presenting}
      importantForAccessibility={presenting ? "auto" : "no-hide-descendants"}
      style={styles.layer}
      onLayout={handleLayout}
    >
      {presentations.map((presentation) => (
        <PressHoldControl
          key={presentation.gesture.gestureId}
          presentation={presentation}
          runtimeState={runtimeState}
          sceneTimeMs={sceneTimeMs}
          layerOriginRef={layerOriginRef}
          locale={viewerLocale ?? locale}
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
          locale={viewerLocale ?? locale}
          onEvents={emitGestureEvents}
        />
      ))}
      {swipePresentations.map((presentation) => (
        <SwipeControl
          key={presentation.gesture.gestureId}
          presentation={presentation}
          locale={viewerLocale ?? locale}
          onEvents={emitGestureEvents}
        />
      ))}
    </View>
  );
}

function TapControl({
  presentation,
  locale,
  onEvents,
}: {
  presentation: TapPresentation;
  locale: string;
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
      />
      <GestureCue kind="tap" label={presentation.label} locale={locale} />
    </HotspotFrame>
  );
}

function SwipeControl({
  presentation,
  locale,
  onEvents,
}: {
  presentation: SwipePresentation;
  locale: string;
  onEvents: (events: readonly ExperienceRuntimeEvent[]) => void;
}) {
  const presenting = useGatedScreenActive();
  const pointerRef = useRef<{ x: number; y: number; startedAt: number } | null>(null);
  useEffect(() => {
    if (!presenting) pointerRef.current = null;
  }, [presenting]);
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
      />
      <GestureCue
        kind="swipe"
        label={presentation.label}
        direction={presentation.gesture.directions[0]}
        locale={locale}
      />
    </HotspotFrame>
  );
}

function PressHoldControl({
  presentation,
  runtimeState,
  sceneTimeMs,
  layerOriginRef,
  locale,
  onEvents,
  onRuntimeError,
  onGateStateChange,
}: {
  presentation: PressHoldPresentation;
  runtimeState: ExperienceRuntimeState;
  sceneTimeMs: number;
  layerOriginRef: { current: { x: number; y: number } };
  locale: string;
  onEvents: (events: readonly ExperienceRuntimeEvent[]) => void;
  onRuntimeError: (message: string) => void;
  onGateStateChange?: (gating: boolean) => void;
}) {
  const presenting = useGatedScreenActive();
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

  usePausableTimeout({
    enabled: timelineGate,
    running: presenting,
    durationMs: TIMELINE_CONTROL_IDLE_TIMEOUT_MS,
    onTimeout: () => {
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
    },
  });

  const startTimelinePress = () => {
    if (!presentation.available || timelineResolved) return;
    timelinePressedRef.current = true;
    setTimelinePressed(true);
  };

  const stopTimelinePress = useCallback(() => {
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
  }, [gesture.durationMs, gesture.gestureId, onEvents, timelineProgress, timelineResolved]);

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
  }, [ensureAnimationFrame, step, stopTimelinePress, timelineControl]);

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    },
    []
  );

  useEffect(() => {
    if (presenting) return;
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    previousFrameTimeRef.current = null;
    pressedRef.current = false;
    pointerInsideRef.current = true;
    timelinePressedRef.current = false;
    // An interrupted gesture has no verdict. Keep completed gestures settled.
    if (stateRef.current.status !== "completed") {
      stateRef.current = createExperiencePressHoldState();
    }
  }, [presenting]);
  const [lastPresenting, setLastPresenting] = useState(presenting);
  if (lastPresenting !== presenting) {
    setLastPresenting(presenting);
    if (!presenting) {
      setTimelinePressed(false);
      if (state.status !== "completed") setState(createExperiencePressHoldState());
    }
  }

  const startPress = () => {
    if (!presenting) return;
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
        <GestureCue
          kind="press-hold"
          label={presentation.label}
          locale={locale}
          progress={displayProgress}
          pressing={displayPressing}
          completed={displayCompleted}
          marked={presentation.appearance === "target"}
        />
      </View>
    </HotspotFrame>
  );
}

type GestureCueDirection = "up" | "down" | "left" | "right";

function gestureCueHint(
  kind: "tap" | "press-hold" | "swipe",
  direction: GestureCueDirection,
  locale: string
): string {
  const traditional = /zh-(HK|TW|Hant)/i.test(locale);
  const chinese = /^zh/i.test(locale);
  if (!chinese) {
    if (kind === "tap") return "Tap";
    if (kind === "press-hold") return "Hold";
    return { up: "Swipe up", down: "Swipe down", left: "Swipe left", right: "Swipe right" }[
      direction
    ];
  }
  if (kind === "tap") return traditional ? "點擊" : "点击";
  if (kind === "press-hold") return traditional ? "長按" : "长按";
  return {
    up: traditional ? "向上滑動" : "向上滑动",
    down: traditional ? "向下滑動" : "向下滑动",
    left: traditional ? "向左滑動" : "向左滑动",
    right: traditional ? "向右滑動" : "向右滑动",
  }[direction];
}

function SwipeTrack({ direction }: { direction: GestureCueDirection }) {
  const [travel] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(travel, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.timing(travel, { toValue: 1, duration: 1050, useNativeDriver: true }),
        Animated.delay(220),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [travel]);
  const vertical = direction === "up" || direction === "down";
  const rotation = { right: "0deg", down: "90deg", left: "180deg", up: "-90deg" }[direction];
  const translateX = travel.interpolate({ inputRange: [0, 1], outputRange: [0, 52] });
  const opacity = travel.interpolate({
    inputRange: [0, 0.12, 0.74, 0.9, 1],
    outputRange: [0, 1, 1, 0, 0],
  });
  return (
    <View style={[styles.cueTrackFrame, vertical && styles.cueTrackFrameVertical]}>
      <View style={[styles.cueTrack, { transform: [{ rotate: rotation }] }]}>
        <View style={styles.cueTrackLine} />
        <View style={styles.cueTrackArrow}>
          <Svg width={16} height={16} viewBox="0 0 24 24">
            <Path
              d="M9 6.5 15 12l-6 5.5"
              stroke="white"
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
        <Animated.View style={[styles.cueKnob, { opacity, transform: [{ translateX }] }]}>
          <View style={styles.cueKnobDot} />
        </Animated.View>
      </View>
    </View>
  );
}

function GestureCue({
  kind,
  label,
  direction = "up",
  locale = "zh-CN",
  progress = 0,
  pressing = false,
  completed = false,
  marked = false,
}: {
  kind: "tap" | "press-hold" | "swipe";
  label: string;
  direction?: GestureCueDirection;
  locale?: string;
  progress?: number;
  pressing?: boolean;
  completed?: boolean;
  marked?: boolean;
}) {
  return (
    <View pointerEvents="none" style={styles.cue}>
      <View
        style={[
          styles.cueStack,
          pressing && { transform: [{ scale: 1.05 }] },
          completed && { transform: [{ scale: 1.1 }] },
        ]}
      >
        {kind === "swipe" ? (
          <SwipeTrack direction={direction} />
        ) : (
          <View style={styles.cueRing}>
            {kind === "press-hold" ? <HoldArc progress={progress} /> : null}
            <View style={[styles.cueDisc, marked && styles.cueDiscMarked]}>
              <GestureGlyph kind={kind} direction={direction} />
            </View>
          </View>
        )}
        <View style={styles.cueCaption}>
          <Text style={styles.cueLabel} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.cueHint} numberOfLines={1}>
            {gestureCueHint(kind, direction, locale)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function HoldArc({ progress }: { progress: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, progress));
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { transform: [{ rotate: "-90deg" }] }]}
    >
      <Svg width={56} height={56}>
        <Circle
          cx={28}
          cy={28}
          r={radius}
          stroke="rgba(255,255,255,0.35)"
          strokeWidth={2}
          fill="none"
        />
        <Circle
          cx={28}
          cy={28}
          r={radius}
          stroke="white"
          strokeWidth={2}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - clamped)}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

function GestureGlyph({
  kind,
  direction,
}: {
  kind: "tap" | "press-hold" | "swipe";
  direction: GestureCueDirection;
}) {
  const rotation = { up: "0deg", right: "90deg", down: "180deg", left: "-90deg" }[direction];
  if (kind === "swipe") {
    return (
      <View style={{ transform: [{ rotate: rotation }] }}>
        <Svg width={24} height={24} viewBox="0 0 24 24">
          <Path
            d="M12 19V6M7 10.5 12 5.5l5 5"
            stroke="white"
            strokeWidth={1.7}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
    );
  }
  if (kind === "tap") {
    return (
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <Path
          d="M12 11.4V5.2a1.45 1.45 0 0 1 2.9 0V12M14.9 11.2V8.4a1.25 1.25 0 0 1 2.5 0v4.6c0 3.1-2.2 5.2-5.4 5.2-2.6 0-4.4-1.5-5.1-3.5L6.2 12a1.25 1.25 0 0 1 2.2-1.1M8.4 6.6a4.6 4.6 0 0 1 .2-2.4M6.2 7.2a6.4 6.4 0 0 1 .2-2"
          stroke="white"
          strokeWidth={1.7}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Path
        d="M8.2 11V6.4a1.35 1.35 0 0 1 2.7 0V11M10.9 10.4V5.2a1.35 1.35 0 0 1 2.7 0v5.4M13.6 10.8V7.2a1.35 1.35 0 0 1 2.7 0v5.2c0 3.4-2.2 5.8-5.6 5.8-2.6 0-4.4-1.4-5.3-3.4L4.4 12.2a1.3 1.3 0 0 1 2.4-1.1L8.2 13"
        stroke="white"
        strokeWidth={1.7}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
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
    overflow: "visible",
  },
  cue: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  cueStack: {
    alignItems: "center",
    maxWidth: "100%",
  },
  cueRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    padding: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  cueDisc: {
    width: "100%",
    height: "100%",
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.35)",
  },
  cueDiscMarked: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.8)",
  },
  cueTrackFrame: {
    width: 120,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  cueTrackFrameVertical: {
    width: 56,
    height: 120,
  },
  cueTrack: {
    width: 112,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.3)",
    backgroundColor: "rgba(0,0,0,0.72)",
    overflow: "hidden",
  },
  cueTrackLine: {
    position: "absolute",
    left: 14,
    right: 20,
    top: 19,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  cueTrackArrow: {
    position: "absolute",
    right: 4,
    top: 12,
  },
  cueKnob: {
    position: "absolute",
    left: 4,
    top: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "white",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.8)",
  },
  cueKnobDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(0,0,0,0.75)",
  },
  cueCaption: {
    marginTop: 10,
    maxWidth: "100%",
    alignItems: "center",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "rgba(0,0,0,0.78)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.25)",
  },
  cueLabel: {
    maxWidth: "100%",
    overflow: "hidden",
    color: "white",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  cueHint: {
    maxWidth: "100%",
    overflow: "hidden",
    color: "rgba(255,255,255,0.9)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
});
