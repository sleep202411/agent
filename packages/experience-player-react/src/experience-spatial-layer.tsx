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

export function ExperienceSpatialLayer({
  manifest,
  scene,
  runtimeState,
  sceneTimeMs,
  locale,
  orientation,
  onEvents,
  onRuntimeError,
}: {
  manifest: ExperienceRuntimeManifest;
  scene: ExperienceScene;
  runtimeState: ExperienceRuntimeState;
  sceneTimeMs: number;
  locale: string;
  orientation: ExperienceOrientation;
  onEvents: (events: readonly ExperienceRuntimeEvent[]) => void;
  onRuntimeError: (message: string) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const viewportSize = useElementSize(layerRef);
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
          available: isExperienceGestureAvailable(gesture, runtimeState, sceneTimeMs),
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
    viewportSize,
  ]);

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0">
      {presentations.map((presentation) => (
        <PressHoldControl
          key={presentation.gesture.gestureId}
          presentation={presentation}
          runtimeState={runtimeState}
          sceneTimeMs={sceneTimeMs}
          viewportElementRef={layerRef}
          onEvents={onEvents}
          onRuntimeError={onRuntimeError}
        />
      ))}
    </div>
  );
}

function PressHoldControl({
  presentation,
  runtimeState,
  sceneTimeMs,
  viewportElementRef,
  onEvents,
  onRuntimeError,
}: {
  presentation: PressHoldPresentation;
  runtimeState: ExperienceRuntimeState;
  sceneTimeMs: number;
  viewportElementRef: RefObject<HTMLDivElement | null>;
  onEvents: (events: readonly ExperienceRuntimeEvent[]) => void;
  onRuntimeError: (message: string) => void;
}) {
  const { gesture, geometry, transform } = presentation;
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
    if (!pressedRef.current) return;
    pressedRef.current = false;
    pointerInsideRef.current = true;
    step(0);
    ensureAnimationFrame();
  }, [ensureAnimationFrame, step]);

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    },
    []
  );

  const startPress = () => {
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

  const progressDegrees = Math.round(state.progress * 360);
  const controlStyle = {
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
    clipPath,
    zIndex: presentation.layer,
  } satisfies CSSProperties;
  const indicatorStyle = {
    background: `conic-gradient(var(--experience-color-accent,#ea2804) ${progressDegrees}deg,rgba(255,255,255,.18) ${progressDegrees}deg)`,
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
      aria-pressed={state.status === "pressing"}
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
          state.status === "pressing" && "scale-105",
          state.status === "completed" && "scale-110"
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
    if (!variant) return;
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
