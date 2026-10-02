"use client";

import {
  useCallback,
  useContext,
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
import {
  ExperienceFrameRotationContext,
  frameSizeOfRect,
  screenDeltaInFrame,
  screenPointInFrame,
} from "./experience-landscape-presentation";
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
  viewerLocale,
  orientation,
  onEvents,
  onRuntimeError,
  onTimelineHoldGateChange,
  decodedContentSize = null,
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
  /** Used when a clip's manifest omits width and height. */
  decodedContentSize?: ExperienceSize | null;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const viewportSize = useElementSize(layerRef);
  const [settledGestureIds, setSettledGestureIds] = useState<ReadonlySet<string>>(() => new Set());
  const settledRef = useRef(settledGestureIds);
  // Timeline-control gate state per gesture, lifted from PressHoldControl so
  // the host can pause/resume the scene media. The host keys this layer by
  // scene id, so both collections have exactly one scene-local lifecycle.
  const [gateStates, setGateStates] = useState<ReadonlyMap<string, boolean>>(() => new Map());
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
        ? createRendererContentTransforms(
            manifest,
            scene,
            orientation,
            sceneTimeMs,
            viewportSize,
            decodedContentSize
          )
        : new Map<string, ExperienceMediaContentTransform>(),
    [decodedContentSize, manifest, orientation, scene, sceneTimeMs, viewportSize]
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
    settledGestureIds,
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
    settledGestureIds,
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
    settledGestureIds,
    viewportSize,
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
    <div ref={layerRef} className="pointer-events-none absolute inset-0">
      {presentations.map((presentation) => (
        <PressHoldControl
          key={presentation.gesture.gestureId}
          presentation={presentation}
          runtimeState={runtimeState}
          sceneTimeMs={sceneTimeMs}
          viewportElementRef={layerRef}
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
    </div>
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
  const degrees = Math.round(Math.min(1, Math.max(0, progress)) * 360);
  return (
    <span
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      aria-hidden="true"
    >
      <style>{`
        @keyframes experience-cue-swipe {
          0% { transform: translateX(0); opacity: 0; }
          12% { opacity: 1; }
          74% { transform: translateX(var(--cue-travel)); opacity: 1; }
          90% { transform: translateX(var(--cue-travel)); opacity: 0; }
          100% { transform: translateX(0); opacity: 0; }
        }
        @keyframes experience-cue-tap {
          0%, 100% { transform: scale(1); }
          46% { transform: scale(0.9); }
        }
        .experience-cue-swipe { animation: experience-cue-swipe 1.45s ease-in-out infinite; }
        .experience-cue-tap { animation: experience-cue-tap 1.15s ease-in-out infinite; }
      `}</style>
      <span className="flex max-w-full flex-col items-center">
        {kind === "swipe" ? (
          <SwipeTrack direction={direction} />
        ) : (
          <span
            className={classNames(
              "grid size-14 place-items-center rounded-full p-1 shadow-[0_8px_28px_rgba(0,0,0,0.38)] transition-transform",
              pressing && "scale-105",
              completed && "scale-110"
            )}
            style={{
              background:
                kind === "press-hold"
                  ? `conic-gradient(#fff ${degrees}deg, rgba(0,0,0,0.55) ${degrees}deg)`
                  : "rgba(0,0,0,0.55)",
            }}
          >
            <span
              className={classNames(
                "grid size-full place-items-center rounded-full border border-white/30 bg-black/70 backdrop-blur-md",
                kind === "tap" && "experience-cue-tap",
                marked && "ring-2 ring-inset ring-white"
              )}
            >
              <GestureGlyph kind={kind} direction={direction} />
            </span>
          </span>
        )}
        <span className="mt-2.5 flex max-w-full flex-col items-center rounded-lg border border-white/25 bg-black/78 px-2.5 py-1 text-center shadow-[0_6px_18px_rgba(0,0,0,0.4)] backdrop-blur-md">
          <span className="max-w-full truncate text-[13px] leading-5 font-semibold text-white">
            {label}
          </span>
          <span className="max-w-full truncate text-[13px] leading-5 font-medium text-white/90">
            {gestureCueHint(kind, direction, locale)}
          </span>
        </span>
      </span>
    </span>
  );
}

function SwipeTrack({ direction }: { direction: GestureCueDirection }) {
  const vertical = direction === "up" || direction === "down";
  const rotation = { right: 0, down: 90, left: 180, up: -90 }[direction];
  return (
    <span
      className={classNames(
        "grid place-items-center",
        vertical ? "h-[120px] w-14" : "h-14 w-[120px]"
      )}
    >
      <span
        className="relative h-10 w-[112px] overflow-hidden rounded-full border border-white/30 bg-black/72 p-1 shadow-[0_8px_28px_rgba(0,0,0,0.45)] backdrop-blur-md"
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <span
          className="absolute inset-y-1/2 right-4 left-3.5 h-0.5 -translate-y-1/2"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(255,255,255,0.85) 0 4px, transparent 4px 8px)",
          }}
        />
        <svg
          viewBox="0 0 24 24"
          className="absolute top-1/2 right-1.5 size-4 -translate-y-1/2"
          fill="none"
          stroke="white"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 6.5 15 12l-6 5.5" />
        </svg>
        <span
          className="experience-cue-swipe absolute top-1 left-1 grid size-7 place-items-center rounded-full border border-white/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
          style={{ ["--cue-travel" as string]: "52px" } as CSSProperties}
        >
          <span className="size-2.5 rounded-full bg-black/75" />
        </span>
      </span>
    </span>
  );
}

function GestureGlyph({
  kind,
  direction,
}: {
  kind: "tap" | "press-hold" | "swipe";
  direction: GestureCueDirection;
}) {
  const stroke = {
    viewBox: "0 0 24 24",
    className: "size-6",
    fill: "none",
    stroke: "white",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "swipe") {
    const rotation = { up: 0, right: 90, down: 180, left: -90 }[direction];
    return (
      <svg {...stroke} style={{ transform: `rotate(${rotation}deg)` }}>
        <path d="M12 19V6" />
        <path d="M7 10.5 12 5.5l5 5" />
      </svg>
    );
  }
  if (kind === "tap") {
    return (
      <svg {...stroke}>
        <path d="M12 11.4V5.2a1.45 1.45 0 0 1 2.9 0V12" />
        <path d="M14.9 11.2V8.4a1.25 1.25 0 0 1 2.5 0v4.6c0 3.1-2.2 5.2-5.4 5.2-2.6 0-4.4-1.5-5.1-3.5L6.2 12a1.25 1.25 0 0 1 2.2-1.1" />
        <path d="M8.4 6.6a4.6 4.6 0 0 1 .2-2.4" />
        <path d="M6.2 7.2a6.4 6.4 0 0 1 .2-2" />
      </svg>
    );
  }
  return (
    <svg {...stroke}>
      <path d="M8.2 11V6.4a1.35 1.35 0 0 1 2.7 0V11" />
      <path d="M10.9 10.4V5.2a1.35 1.35 0 0 1 2.7 0v5.4" />
      <path d="M13.6 10.8V7.2a1.35 1.35 0 0 1 2.7 0v5.2c0 3.4-2.2 5.8-5.6 5.8-2.6 0-4.4-1.4-5.3-3.4L4.4 12.2a1.3 1.3 0 0 1 2.4-1.1L8.2 13" />
    </svg>
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
  const projected = projectExperienceGeometryToViewport(
    presentation.geometry,
    presentation.transform
  );
  const bounds = boundsOfExperienceProjectedGeometry(projected);
  const clipPath = geometryClipPath(projected, bounds);
  return (
    <div
      className={classNames("absolute", !presentation.available && "pointer-events-none opacity-0")}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: 30,
      }}
    >
      <button
        type="button"
        className={classNames(
          "absolute inset-0 touch-manipulation bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-white/80",
          presentation.available ? "pointer-events-auto" : "pointer-events-none"
        )}
        style={{ clipPath }}
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
      <GestureCue kind="tap" label={presentation.label} locale={locale} />
    </div>
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
  const pointerRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    startedAt: number;
  } | null>(null);
  const rotated = useContext(ExperienceFrameRotationContext);
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

  const cancelPointer = useCallback(
    (pointerId?: number) => {
      const pointer = pointerRef.current;
      if (!pointer || (pointerId !== undefined && pointer.pointerId !== pointerId)) return;
      pointerRef.current = null;
      emit("gesture.cancelled", {
        reason: "pointer-cancelled",
        durationMs: Math.max(0, Math.round(performance.now() - pointer.startedAt)),
      });
    },
    [emit]
  );

  const completePointer = (event: PointerEvent<HTMLButtonElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pointerRef.current = null;
    if (!presentation.available) return;
    const durationMs = Math.max(0, Math.round(performance.now() - pointer.startedAt));
    // Directions belong to the picture: on a frame drawn sideways, a swipe
    // toward the picture's right runs down the screen.
    const delta = screenDeltaInFrame(event.clientX - pointer.x, event.clientY - pointer.y, rotated);
    const evaluation = evaluateExperienceSwipe(presentation.gesture, {
      deltaX: delta.x,
      deltaY: delta.y,
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
    <div
      className={classNames("absolute", !presentation.available && "pointer-events-none opacity-0")}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: 30,
      }}
    >
      <button
        type="button"
        className={classNames(
          "absolute inset-0 touch-none bg-transparent select-none outline-none focus-visible:ring-2 focus-visible:ring-white/80",
          presentation.available ? "pointer-events-auto" : "pointer-events-none"
        )}
        style={{ clipPath }}
        aria-label={presentation.description ?? presentation.label}
        aria-disabled={!presentation.available}
        onPointerDown={(event) => {
          if (event.button !== 0 || !presentation.available || pointerRef.current) return;
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
        onPointerCancel={(event) => cancelPointer(event.pointerId)}
        onLostPointerCapture={(event) => cancelPointer(event.pointerId)}
        onBlur={() => cancelPointer()}
        onKeyDown={handleKeyDown}
        onClick={(event) => event.preventDefault()}
      >
        <span className="sr-only">{presentation.label}</span>
      </button>
      <GestureCue
        kind="swipe"
        label={presentation.label}
        direction={presentation.gesture.directions[0]}
        locale={locale}
      />
    </div>
  );
}

function PressHoldControl({
  presentation,
  runtimeState,
  sceneTimeMs,
  viewportElementRef,
  locale,
  onEvents,
  onRuntimeError,
  onGateStateChange,
}: {
  presentation: PressHoldPresentation;
  runtimeState: ExperienceRuntimeState;
  sceneTimeMs: number;
  viewportElementRef: RefObject<HTMLDivElement | null>;
  locale: string;
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
  const rotated = useContext(ExperienceFrameRotationContext);
  const timelineControl = gesture.timelineControl === true;
  const [state, setState] = useState<ExperiencePressHoldState>(() =>
    createExperiencePressHoldState()
  );
  const stateRef = useRef(state);
  const activeInputRef = useRef<
    { kind: "pointer"; id: number } | { kind: "keyboard"; key: string } | null
  >(null);
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
    const input = activeInputRef.current;
    if (input?.kind !== "pointer" || input.id !== event.pointerId) return;
    const viewport = viewportElementRef.current?.getBoundingClientRect();
    if (!viewport) return;
    pointerInsideRef.current = hitTestExperienceGeometry(
      geometry,
      screenPointInFrame(viewport, event.clientX, event.clientY, rotated),
      transform
    );
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !presentation.available || activeInputRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeInputRef.current = { kind: "pointer", id: event.pointerId };
    startPress();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      (event.key !== " " && event.key !== "Enter") ||
      event.repeat ||
      !presentation.available ||
      activeInputRef.current
    )
      return;
    event.preventDefault();
    activeInputRef.current = { kind: "keyboard", key: event.key };
    startPress();
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    const input = activeInputRef.current;
    if (input?.kind !== "keyboard" || input.key !== event.key) return;
    event.preventDefault();
    activeInputRef.current = null;
    stopPress();
  };

  const stopPointerPress = (event: PointerEvent<HTMLButtonElement>) => {
    const input = activeInputRef.current;
    if (input?.kind !== "pointer" || input.id !== event.pointerId) return;
    if (event.type === "pointerup") updatePointerInside(event);
    activeInputRef.current = null;
    stopPress();
  };

  const displayProgress = timelineControl ? timelineProgress : state.progress;
  const displayPressing = timelineControl ? timelinePressed : state.status === "pressing";
  const displayCompleted = timelineControl ? timelineResolved : state.status === "completed";
  const controlStyle = {
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
    zIndex: presentation.layer,
  } satisfies CSSProperties;

  return (
    <div
      className={classNames("absolute", !presentation.available && "pointer-events-none opacity-0")}
      style={controlStyle}
    >
      <button
        type="button"
        className={classNames(
          "absolute inset-0 touch-none bg-transparent select-none outline-none focus-visible:ring-2 focus-visible:ring-white/80",
          presentation.available ? "pointer-events-auto" : "pointer-events-none"
        )}
        style={{ clipPath }}
        aria-label={presentation.description ?? presentation.label}
        aria-pressed={displayPressing}
        aria-disabled={!presentation.available}
        onPointerDown={handlePointerDown}
        onPointerMove={updatePointerInside}
        onPointerUp={stopPointerPress}
        onPointerCancel={stopPointerPress}
        onLostPointerCapture={stopPointerPress}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={() => {
          activeInputRef.current = null;
          stopPress();
        }}
        onClick={(event) => event.preventDefault()}
      >
        <span className="sr-only">{presentation.label}</span>
      </button>
      <GestureCue
        kind="press-hold"
        label={presentation.label}
        locale={locale}
        progress={displayProgress}
        pressing={displayPressing}
        completed={displayCompleted}
        marked={presentation.appearance === "target"}
      />
    </div>
  );
}

function createRendererContentTransforms(
  manifest: ExperienceRuntimeManifest,
  scene: ExperienceScene,
  orientation: ExperienceOrientation,
  sceneTimeMs: number,
  viewportSize: ExperienceSize,
  decodedContentSize: ExperienceSize | null
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
    const contentSize =
      variant?.width && variant?.height
        ? { width: variant.width, height: variant.height }
        : decodedContentSize;
    if (!contentSize) return;
    transforms.set(
      renderer.instanceId,
      createMediaContentTransform(
        viewportSize,
        contentSize,
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

/**
 * The layer's box in the film frame's own axes. Re-read when the frame turns:
 * a turn changes the screen rect without resizing the element, so the resize
 * observer alone would keep the old reading.
 */
function useElementSize(ref: RefObject<HTMLElement | null>): ExperienceSize | null {
  const rotated = useContext(ExperienceFrameRotationContext);
  const [size, setSize] = useState<ExperienceSize | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize(frameSizeOfRect(rect, rotated));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rotated]);
  return size;
}

function localize(value: ExperienceLocalizedText, locale: string, defaultLocale: string): string {
  return value[locale] ?? value[defaultLocale] ?? Object.values(value)[0] ?? "";
}

function runtimeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unknown spatial interaction error";
}
