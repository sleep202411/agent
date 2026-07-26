"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID,
  EXPERIENCE_CORE_CHECKPOINT_RENDERER_ID,
  EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  EXPERIENCE_CORE_TEXT_RENDERER_ID,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  EXPERIENCE_RENDERER_MAX_LAYER,
  ExperienceCoreCheckpointRendererConfigSchema,
  ExperienceCoreChoiceRendererConfigSchema,
  ExperienceCoreTextRendererConfigSchema,
  ExperienceCoreVideoRendererConfigSchema,
  ExperienceRuntimeManifestSchema,
  type ExperienceCoreVideoRendererConfig,
  type ExperienceGraphNode,
  type ExperienceImageAsset,
  type ExperienceLocalizedText,
  type ExperienceOrientation,
  type ExperienceProfile,
  type ExperienceRendererInstance,
  type ExperienceRuntimeAsset,
  type ExperienceRuntimeManifest,
  type ExperienceThemeConfig,
  type ExperienceVideoAsset,
} from "@repo/shared/experience-runtime";
import {
  EXPERIENCE_CORE_RENDERER_ADAPTERS,
  advanceExperienceTimeline,
  createExperienceTimelineCursor,
  evaluateExperienceCondition,
  isExperienceRendererVisible,
  type ExperienceEventQueueResult,
  type ExperienceRuntimeController,
  type ExperienceRuntimeEvent,
  type ExperienceRuntimeState,
  type ExperienceTimelineCursor,
} from "@repo/experience-engine";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconPlayerPlay,
  IconRefresh,
  IconVolumeOff,
} from "@tabler/icons-react";
import { classNames } from "./class-names";
import {
  loadExperienceTheme as defaultLoadExperienceTheme,
  type ExperienceThemeLoader,
} from "./experience-theme-loader";
import type { ExperiencePlayerCopy } from "./experience-player-copy";
import { createExperienceRuntime } from "./experience-runtime-host";
import {
  ExperienceMediaPlayer,
  type ExperienceMediaPlaybackHandle,
} from "./experience-media-player";
import { resolveExperiencePlaybackRejection } from "./experience-playback-rejection";
import { ExperienceSpatialLayer } from "./experience-spatial-layer";
import { useExperienceAudioHost } from "./use-experience-audio-host";

export type ExperiencePlayerFrameProfile = "auto" | ExperienceOrientation;

export interface ExperiencePlayerProps {
  runtime: unknown;
  locale: string;
  copy: ExperiencePlayerCopy;
  randomSeed?: string;
  frameProfile?: ExperiencePlayerFrameProfile;
  loadTheme?: ExperienceThemeLoader;
}

const PRIMARY_BUTTON =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--experience-color-accent,#ea2804)] px-7 text-sm font-semibold text-white outline-none transition-colors hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none";
const SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-white/[0.12] px-5 text-sm font-semibold text-white outline-none transition-colors hover:bg-white/[0.2] focus-visible:ring-2 focus-visible:ring-white/60 motion-reduce:transition-none";

export function ExperiencePlayer({
  runtime,
  locale,
  randomSeed: initialRandomSeed,
  copy,
  frameProfile = "auto",
  loadTheme = defaultLoadExperienceTheme,
}: ExperiencePlayerProps) {
  const hydrationSeedId = useId();
  const [restartEpoch, setRestartEpoch] = useState(0);
  const generatedSessionSeedRef = useRef<string | null>(null);
  const [randomSeed, setRandomSeed] = useState(
    () => initialRandomSeed ?? `experience-player:${hydrationSeedId}`
  );

  useEffect(() => {
    if (initialRandomSeed) return;
    generatedSessionSeedRef.current ??= globalThis.crypto.randomUUID();
    setRandomSeed(generatedSessionSeedRef.current);
  }, [initialRandomSeed]);

  const prepared = useMemo(() => {
    const parsed = ExperienceRuntimeManifestSchema.safeParse(runtime);
    if (!parsed.success) return { ok: false as const, issues: parsed.error.issues };
    try {
      return {
        ok: true as const,
        manifest: parsed.data,
        controller: createExperienceRuntime(parsed.data, {
          rendererAdapters: EXPERIENCE_CORE_RENDERER_ADAPTERS,
          randomSeed,
        }),
      };
    } catch (error) {
      return {
        ok: false as const,
        issues: [{ path: [], message: runtimeErrorMessage(error) }],
      };
    }
  }, [randomSeed, runtime]);

  if (!prepared.ok) {
    return (
      <div role="alert" className="mx-auto max-w-3xl rounded-2xl bg-red-500/10 p-6 text-red-100">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <IconAlertTriangle className="size-4" />
          {copy.invalidManifest}
        </div>
        <ul className="mt-3 space-y-1.5 font-mono text-[11px] leading-5 text-red-100/70">
          {prepared.issues.slice(0, 8).map((issue, index) => (
            <li key={`${issue.path.join(".")}:${index}`}>
              {issue.path.join(".") || copy.manifestRoot} — {issue.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <ActiveExperienceRuntimePlayer
      key={`${prepared.manifest.buildId}:${randomSeed}:${restartEpoch}`}
      manifest={prepared.manifest}
      controller={prepared.controller}
      locale={locale}
      copy={copy}
      frameProfile={frameProfile}
      loadTheme={loadTheme}
      onRestart={() => {
        setRandomSeed(globalThis.crypto.randomUUID());
        setRestartEpoch((value) => value + 1);
      }}
    />
  );
}

function ActiveExperienceRuntimePlayer({
  manifest,
  controller,
  locale,
  copy,
  frameProfile,
  loadTheme,
  onRestart,
}: {
  manifest: ExperienceRuntimeManifest;
  controller: ExperienceRuntimeController;
  locale: string;
  copy: ExperiencePlayerCopy;
  frameProfile: ExperiencePlayerFrameProfile;
  loadTheme: ExperienceThemeLoader;
  onRestart: () => void;
}) {
  const [runtimeState, setRuntimeState] = useState(() => controller.state());
  const [openRendererIds, setOpenRendererIds] = useState<ReadonlySet<string>>(() => new Set());
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [sceneTimeMs, setSceneTimeMs] = useState(0);
  const [theme, setTheme] = useState<ExperienceThemeConfig | null>(null);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  // Playback always asks for sound. This flips only when a browser actually
  // refuses audible playback, and it stays flipped for the rest of the session
  // so later clips do not each re-run the same rejected attempt. Turning sound
  // on is the user's call, never a decision read off the media's metadata.
  const [soundBlocked, setSoundBlocked] = useState(false);
  const timelineCursorRef = useRef<ExperienceTimelineCursor>(
    createExperienceTimelineCursor(runtimeState.currentSceneId)
  );
  const playbackHandlesRef = useRef(new Map<string, ExperienceMediaPlaybackHandle>());
  const playbackEnabledRef = useRef(false);
  const orientation = usePlaybackOrientation(manifest, frameProfile);
  const experienceProfile = manifest.metadata.experienceProfile ?? "cinematic";
  const playbackLocale = resolvePlaybackLocale(manifest, locale);
  const {
    unlock: unlockAudio,
    suspend: suspendAudio,
    applyEffects: applyAudioEffects,
  } = useExperienceAudioHost(manifest, playbackLocale, setRuntimeError);

  const applyResult = useCallback(
    (result: ExperienceEventQueueResult) => {
      setRuntimeState(result.state);
      applyAudioEffects(result.effects);
      let sceneChangeCount = 0;
      let latestSceneId: string | null = null;
      setOpenRendererIds((current) => {
        let next = new Set(current);
        result.effects.forEach((effect) => {
          if (effect.kind === "scene.changed") {
            next = new Set();
            sceneChangeCount += 1;
            latestSceneId = effect.toSceneId;
          }
          if (effect.kind === "renderer.command" && effect.commandType === "open") {
            next.add(effect.instanceId);
          }
        });
        return next;
      });
      if (sceneChangeCount > 0) {
        setSceneEpoch((value) => value + sceneChangeCount);
        setSceneTimeMs(0);
        timelineCursorRef.current = createExperienceTimelineCursor(
          latestSceneId ?? result.state.currentSceneId
        );
      }
    },
    [applyAudioEffects]
  );

  const run = useCallback(
    (operation: () => ExperienceEventQueueResult) => {
      try {
        applyResult(operation());
        return true;
      } catch (error) {
        setRuntimeError(runtimeErrorMessage(error));
        return false;
      }
    },
    [applyResult]
  );

  useEffect(() => {
    const abortController = new AbortController();
    void loadTheme(manifest, abortController.signal)
      .then(setTheme)
      .catch((error: unknown) => {
        if (!abortController.signal.aborted) setRuntimeError(runtimeErrorMessage(error));
      });
    return () => abortController.abort();
  }, [loadTheme, manifest]);

  const currentNode = findGraphNode(manifest, runtimeState.currentSceneId);
  const scene = currentNode?.kind === "scene" ? currentNode : null;
  const endingId = runtimeState.completedEndingId ?? null;
  const ending = endingId
    ? (manifest.endings.find((candidate) => candidate.endingId === endingId) ?? null)
    : null;
  let videoSlotIndex = 0;
  const rendererSlots = scene
    ? scene.renderers
        .filter((renderer) =>
          isExperienceRendererVisible(manifest, runtimeState, renderer.instanceId)
        )
        .sort((left, right) => left.layer - right.layer)
        .map((renderer) => ({
          renderer,
          key:
            renderer.rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID
              ? `core-video-slot:${videoSlotIndex++}`
              : `${scene.sceneId}:${sceneEpoch}:${renderer.instanceId}`,
        }))
    : [];
  const stageProfile = resolveRendererStageProfile(
    rendererSlots.map(({ renderer }) => renderer),
    experienceProfile
  );
  // The unmute affordance belongs to video playback, so it only appears while a
  // video renderer is on stage.
  const hasVideoRenderer = rendererSlots.some(
    ({ renderer }) => renderer.rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID
  );

  const emitOutcome = useCallback(
    (
      instanceId: string,
      outcomeType: string,
      payload: Record<string, never> | { choiceId: string }
    ) => run(() => controller.emitRendererOutcome({ instanceId, outcomeType, payload })),
    [controller, run]
  );

  const advanceTimeline = useCallback(
    (positionMs: number) => {
      setSceneTimeMs(positionMs);
      const currentState = controller.state();
      const activeNode = findGraphNode(manifest, currentState.currentSceneId);
      if (!activeNode || activeNode.kind !== "scene") return;
      const advanced = advanceExperienceTimeline(activeNode, timelineCursorRef.current, positionMs);
      timelineCursorRef.current = advanced.cursor;
      if (advanced.events.length > 0) run(() => controller.dispatch(advanced.events));
    },
    [controller, manifest, run]
  );

  const emitRuntimeEvents = useCallback(
    (events: readonly ExperienceRuntimeEvent[]) => run(() => controller.dispatch(events)),
    [controller, run]
  );

  // A `fixed` scene clock is the only clock the experience itself owns. A
  // `renderer` clock is driven by its media's currentTime, and `none` never
  // advances — so a scene that must last a known duration without any media to
  // time it (a placeholder for footage that is not attached yet, a text beat)
  // has nothing to move it along until this runs.
  //
  // Position is fed through the same `advanceTimeline` the media path uses, so
  // timeline cues fire identically whether the clock came from a video or from
  // here. `scene.clock-ended` is emitted exactly once per scene entry.
  const clockScene = scene?.clock.kind === "fixed" ? scene : null;
  const clockDurationMs = clockScene?.clock.kind === "fixed" ? clockScene.clock.durationMs : null;
  useEffect(() => {
    if (!clockScene || clockDurationMs === null || !started) return;
    let frame = 0;
    let ended = false;
    const startedAt = performance.now();
    const tick = () => {
      const elapsed = Math.min(performance.now() - startedAt, clockDurationMs);
      advanceTimeline(elapsed);
      if (elapsed < clockDurationMs) {
        frame = window.requestAnimationFrame(tick);
        return;
      }
      if (ended) return;
      ended = true;
      emitRuntimeEvents([{ type: "scene.clock-ended", sourceId: clockScene.sceneId }]);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [advanceTimeline, clockDurationMs, clockScene, emitRuntimeEvents, started]);

  const handleSoundBlocked = useCallback(() => setSoundBlocked(true), []);
  // Unmute the live elements INSIDE the click, then let state follow. Leaving it
  // to the `muted` prop and its effect would push the element write into a task
  // after the user-activation one, which is the fragile half of Chrome's
  // autoplay rules; doing it here means the unmute is unambiguously
  // user-activated. The state flip still has to happen — it hides the affordance
  // and keeps clips mounted later in the session unmuted.
  const enableSound = useCallback(() => {
    playbackHandlesRef.current.forEach((handle) => handle.setMuted(false));
    setSoundBlocked(false);
  }, []);

  const registerPlaybackHandle = useCallback(
    (instanceId: string, handle: ExperienceMediaPlaybackHandle | null) => {
      if (!handle) {
        playbackHandlesRef.current.delete(instanceId);
        return;
      }
      playbackHandlesRef.current.set(instanceId, handle);
      if (!playbackEnabledRef.current) return;
      void handle.play().catch((error: unknown) => {
        // Two guards, both about the gap between "a play() rejected" and "the
        // film is broken": the rejection may belong to a handle that has since
        // been replaced, and an interrupted play() is what a normal clip
        // transition looks like. Either way, pausing and raising the dialog
        // would stop a film that is playing perfectly well. The reasoning and
        // the ordering live with the verdict, next to its tests.
        const verdict = resolveExperiencePlaybackRejection(
          playbackHandlesRef.current.get(instanceId),
          handle,
          error
        );
        if (verdict !== "surface") return;
        handle.pause();
        void Promise.allSettled([suspendAudio()]).then(() => {
          setRuntimeError(runtimeErrorMessage(error));
        });
      });
    },
    [suspendAudio]
  );

  const begin = async () => {
    if (started || starting || !theme) return;
    setStarting(true);
    const playbackHandles = [...playbackHandlesRef.current.values()];
    try {
      const playbacks = playbackHandles.map((handle) => handle.play());
      const audioUnlock = unlockAudio();
      if (!run(() => controller.start())) {
        await Promise.allSettled([audioUnlock, ...playbacks]);
        playbackHandles.forEach((handle) => handle.pause());
        await Promise.allSettled([suspendAudio()]);
        return;
      }
      const results = await Promise.allSettled([audioUnlock, ...playbacks]);
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (failure) throw failure.reason;
      playbackEnabledRef.current = true;
      setStarted(true);
    } catch (error) {
      playbackHandles.forEach((handle) => handle.pause());
      await Promise.allSettled([suspendAudio()]);
      setRuntimeError(runtimeErrorMessage(error));
    } finally {
      setStarting(false);
    }
  };

  return (
    <PlayerFrame
      orientation={orientation}
      experienceProfile={experienceProfile}
      stageProfile={stageProfile}
      copy={copy}
      style={theme ? themeStyle(theme) : undefined}
    >
      {scene ? (
        rendererSlots.map(({ renderer, key }) => (
          <CoreRenderer
            key={key}
            manifest={manifest}
            renderer={renderer}
            runtimeState={runtimeState}
            active={started}
            open={openRendererIds.has(renderer.instanceId)}
            locale={playbackLocale}
            orientation={orientation}
            copy={copy}
            muted={soundBlocked}
            onTimelineTimeMs={advanceTimeline}
            onOutcome={emitOutcome}
            onRuntimeError={setRuntimeError}
            onPlaybackHandle={registerPlaybackHandle}
            onSoundBlocked={handleSoundBlocked}
          />
        ))
      ) : (
        <div className="absolute inset-0 bg-black" />
      )}

      {soundBlocked && started && !endingId && !runtimeError && hasVideoRenderer ? (
        // Renderer overlays stack on the manifest's own `renderer.layer` as a raw
        // zIndex — choice and checkpoint compile to 100 — so a Tailwind z-* on
        // this button puts it BEHIND the overlay it most needs to sit next to.
        // Stack above the widest band any manifest may declare instead.
        <div
          className="absolute top-0 right-0 p-4 pt-[max(1rem,env(safe-area-inset-top))] sm:p-6"
          style={{ zIndex: EXPERIENCE_RENDERER_MAX_LAYER + 1 }}
        >
          <button type="button" className={SECONDARY_BUTTON} onClick={enableSound}>
            <IconVolumeOff className="size-4" aria-hidden="true" />
            {copy.video.unmute}
          </button>
        </div>
      ) : null}

      {scene && started && !endingId ? (
        <ExperienceSpatialLayer
          manifest={manifest}
          scene={scene}
          runtimeState={runtimeState}
          sceneTimeMs={sceneTimeMs}
          locale={playbackLocale}
          orientation={orientation}
          onEvents={emitRuntimeEvents}
          onRuntimeError={setRuntimeError}
        />
      ) : null}

      {!started && !runtimeError ? (
        <div
          className={classNames(
            "absolute inset-0 z-40 grid place-items-center p-6 text-center",
            experienceProfile === "cinematic"
              ? "bg-black/68 backdrop-blur-sm"
              : "bg-[var(--experience-color-background,#111)]"
          )}
        >
          <div className="max-w-lg">
            {experienceProfile === "cinematic" ? (
              <p className="text-[11px] font-semibold tracking-[0.18em] text-white/48 uppercase">
                {copy.interactiveFilm}
              </p>
            ) : null}
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-white sm:text-3xl">
              {localize(
                manifest.metadata.title,
                playbackLocale,
                manifest.localization.defaultLocale
              )}
            </h1>
            {manifest.metadata.summary ? (
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-white/58">
                {localize(
                  manifest.metadata.summary,
                  playbackLocale,
                  manifest.localization.defaultLocale
                )}
              </p>
            ) : null}
            <button
              type="button"
              className={`${PRIMARY_BUTTON} mt-6`}
              disabled={!theme || starting}
              onClick={() => void begin()}
            >
              <IconPlayerPlay className="size-4 fill-current" />
              {starting ? copy.starting : copy.start}
            </button>
          </div>
        </div>
      ) : null}

      {endingId && !runtimeError ? (
        <div
          role="dialog"
          aria-modal="true"
          className="absolute inset-0 z-50 grid place-items-center bg-black/78 p-6 text-center backdrop-blur-md"
        >
          <div className="max-w-lg">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-white/42 uppercase">
              {copy.endingEyebrow}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-white">
              {ending
                ? localize(ending.title, playbackLocale, manifest.localization.defaultLocale)
                : copy.unknownEnding(endingId)}
            </h2>
            {ending?.summary ? (
              <p className="mt-3 text-sm leading-6 text-white/56">
                {localize(ending.summary, playbackLocale, manifest.localization.defaultLocale)}
              </p>
            ) : null}
            <button type="button" className={`${PRIMARY_BUTTON} mt-6`} onClick={onRestart}>
              <IconRefresh className="size-4" />
              {copy.playAgain}
            </button>
          </div>
        </div>
      ) : null}

      {runtimeError ? (
        <div
          role="alertdialog"
          aria-modal="true"
          className="absolute inset-0 z-[60] grid place-items-center bg-black/84 p-6 text-center backdrop-blur-md"
        >
          <div className="max-w-md">
            <IconAlertTriangle className="mx-auto size-6 text-red-400" />
            <h2 className="mt-4 text-base font-semibold text-white">{copy.runtimeError}</h2>
            <p className="mt-2 text-xs leading-5 text-white/58">{runtimeError}</p>
            <button type="button" className={`${SECONDARY_BUTTON} mt-5`} onClick={onRestart}>
              <IconRefresh className="size-4" />
              {copy.restart}
            </button>
          </div>
        </div>
      ) : null}
    </PlayerFrame>
  );
}

function CoreRenderer({
  manifest,
  renderer,
  runtimeState,
  active,
  open,
  locale,
  orientation,
  copy,
  muted,
  onTimelineTimeMs,
  onOutcome,
  onRuntimeError,
  onPlaybackHandle,
  onSoundBlocked,
}: {
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  runtimeState: ExperienceRuntimeState;
  active: boolean;
  open: boolean;
  locale: string;
  orientation: ExperienceOrientation;
  copy: ExperiencePlayerCopy;
  muted: boolean;
  onTimelineTimeMs: (timeMs: number) => void;
  onOutcome: (
    instanceId: string,
    outcomeType: string,
    payload: Record<string, never> | { choiceId: string }
  ) => void;
  onRuntimeError: (message: string) => void;
  onPlaybackHandle: (instanceId: string, handle: ExperienceMediaPlaybackHandle | null) => void;
  onSoundBlocked: () => void;
}) {
  if (renderer.rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID) {
    // A video scene with nothing to play is a preview Build of a work whose
    // footage is not attached yet. It stands in for the shot and then finishes
    // on the SAME outcome a real clip produces, so every exit downstream — auto,
    // choice, checkpoint, ending — keeps working untouched.
    if (isEmptyVideoSequence(renderer)) {
      return (
        <EmptyVideoSequencePlaceholder
          label={copy.emptySequence}
          onCompleted={() => onOutcome(renderer.instanceId, "media-ended", {})}
        />
      );
    }
    return (
      <CoreVideoRenderer
        manifest={manifest}
        renderer={renderer}
        orientation={orientation}
        copy={copy}
        muted={muted}
        onTimelineTimeMs={onTimelineTimeMs}
        onCompleted={() => onOutcome(renderer.instanceId, "media-ended", {})}
        onRuntimeError={onRuntimeError}
        onPlaybackHandle={onPlaybackHandle}
        onSoundBlocked={onSoundBlocked}
      />
    );
  }
  if (renderer.rendererId === EXPERIENCE_CORE_TEXT_RENDERER_ID) {
    return (
      <CoreTextRenderer
        manifest={manifest}
        renderer={renderer}
        locale={locale}
        active={active}
        copy={copy}
        onCompleted={() => onOutcome(renderer.instanceId, "text-completed", {})}
      />
    );
  }
  if (renderer.rendererId === EXPERIENCE_CORE_CHOICE_RENDERER_ID) {
    return (
      <CoreChoiceRenderer
        manifest={manifest}
        renderer={renderer}
        runtimeState={runtimeState}
        active={active}
        open={open}
        locale={locale}
        copy={copy}
        onSelect={(choiceId) => onOutcome(renderer.instanceId, "choice-selected", { choiceId })}
      />
    );
  }
  if (renderer.rendererId === EXPERIENCE_CORE_CHECKPOINT_RENDERER_ID) {
    return (
      <CoreCheckpointRenderer
        renderer={renderer}
        active={active}
        open={open}
        copy={copy}
        onSelect={(actionId) => onOutcome(renderer.instanceId, actionId, {})}
      />
    );
  }
  if (renderer.rendererId === EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID) return null;
  return null;
}

function CoreTextRenderer({
  manifest,
  renderer,
  locale,
  active,
  copy,
  onCompleted,
}: {
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  locale: string;
  active: boolean;
  copy: ExperiencePlayerCopy;
  onCompleted: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const scrollRef = useRef<HTMLElement | null>(null);
  const [completed, setCompleted] = useState(false);
  const config = ExperienceCoreTextRendererConfigSchema.parse(renderer.config);
  const title = config.title
    ? localize(config.title, locale, manifest.localization.defaultLocale)
    : null;
  const body = localize(config.body, locale, manifest.localization.defaultLocale);

  useEffect(() => {
    if (!active) return;
    const scrollRegion = scrollRef.current;
    if (!scrollRegion) return;
    scrollRegion.scrollTop = 0;
    scrollRegion.focus({ preventScroll: true });
  }, [active, renderer.instanceId]);

  const complete = () => {
    if (!active || completed) return;
    setCompleted(true);
    onCompleted();
  };

  return (
    <article
      ref={scrollRef}
      tabIndex={active ? 0 : -1}
      aria-hidden={active ? undefined : true}
      aria-labelledby={title ? titleId : undefined}
      aria-label={
        title
          ? undefined
          : localize(manifest.metadata.title, locale, manifest.localization.defaultLocale)
      }
      aria-describedby={bodyId}
      className="absolute inset-0 overflow-y-auto overscroll-contain bg-[var(--experience-color-background,#111)] px-6 py-12 text-[var(--experience-color-text,#fff)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/40 sm:px-10 sm:py-16"
      style={{ zIndex: renderer.layer }}
      data-experience-renderer="core.text"
    >
      <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center">
        {title ? (
          <h2
            id={titleId}
            className="text-balance text-2xl font-semibold tracking-[-0.025em] sm:text-4xl"
          >
            {title}
          </h2>
        ) : null}
        <p
          id={bodyId}
          className={classNames(
            "whitespace-pre-wrap text-pretty text-base leading-8 text-current/82 sm:text-lg sm:leading-9",
            title && "mt-6"
          )}
        >
          {body}
        </p>
        {config.completion === "continue" ? (
          <div className="mt-10 flex justify-end pb-[max(0px,env(safe-area-inset-bottom))]">
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={!active || completed}
              onClick={complete}
            >
              {copy.continue}
              <IconArrowRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

type CoreVideoTerminalMode =
  | { kind: "held" }
  | { kind: "loop"; assetId: string; clipStartTime?: number }
  | null;

type CoreVideoPlaybackState = {
  rendererInstanceId: string;
  sequenceIndex: number;
  terminalMode: CoreVideoTerminalMode;
};

function initialCoreVideoPlaybackState(rendererInstanceId: string): CoreVideoPlaybackState {
  return { rendererInstanceId, sequenceIndex: 0, terminalMode: null };
}

function isEmptyVideoSequence(renderer: ExperienceRendererInstance): boolean {
  const parsed = ExperienceCoreVideoRendererConfigSchema.safeParse(renderer.config);
  return parsed.success && parsed.data.sequence.length === 0;
}

/**
 * Holds the scene for a fixed beat so a shot without footage still occupies the
 * time it will occupy, then finishes. Reading a real duration is impossible —
 * there is no media to read it from — so the beat is a constant, chosen to be
 * long enough to register as a scene and short enough not to stall a playthrough.
 */
const EMPTY_SEQUENCE_HOLD_MS = 6_000;

function EmptyVideoSequencePlaceholder({
  label,
  onCompleted,
}: {
  label: string;
  onCompleted: () => void;
}) {
  const completedRef = useRef(false);
  useEffect(() => {
    completedRef.current = false;
    const timer = window.setTimeout(() => {
      if (completedRef.current) return;
      completedRef.current = true;
      onCompleted();
    }, EMPTY_SEQUENCE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [onCompleted]);
  return (
    <div className="absolute inset-0 grid place-items-center bg-black">
      <p className="text-sm font-semibold tracking-wide text-white/45">{label}</p>
    </div>
  );
}

function CoreVideoRenderer({
  manifest,
  renderer,
  orientation,
  copy,
  muted,
  onTimelineTimeMs,
  onCompleted,
  onRuntimeError,
  onPlaybackHandle,
  onSoundBlocked,
}: {
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  orientation: ExperienceOrientation;
  copy: ExperiencePlayerCopy;
  muted: boolean;
  onTimelineTimeMs: (timeMs: number) => void;
  onCompleted: () => void;
  onRuntimeError: (message: string) => void;
  onPlaybackHandle: (instanceId: string, handle: ExperienceMediaPlaybackHandle | null) => void;
  onSoundBlocked: () => void;
}) {
  const config = ExperienceCoreVideoRendererConfigSchema.parse(renderer.config);
  const [playbackState, setPlaybackState] = useState<CoreVideoPlaybackState>(() =>
    initialCoreVideoPlaybackState(renderer.instanceId)
  );
  const activePlaybackState =
    playbackState.rendererInstanceId === renderer.instanceId
      ? playbackState
      : initialCoreVideoPlaybackState(renderer.instanceId);
  const { sequenceIndex, terminalMode } = activePlaybackState;
  const completionTimerRef = useRef<number | null>(null);
  const completedRendererIdRef = useRef<string | null>(null);
  const missingAssetRef = useRef<string | null>(null);
  const clip = config.sequence[sequenceIndex];
  const assetId = terminalMode?.kind === "loop" ? terminalMode.assetId : clip?.assetId;
  const media = assetId ? resolveVideoMedia(manifest.assets, assetId, orientation) : null;
  const posterAssetId = clip?.posterAssetId ?? config.posterAssetId;
  const poster = posterAssetId
    ? resolveImageUri(manifest.assets, posterAssetId, orientation)
    : undefined;
  const timelineOffsetMs = sequenceTimelineOffsetMs(
    manifest.assets,
    config,
    sequenceIndex,
    orientation
  );
  const playbackIdentity =
    terminalMode?.kind === "loop"
      ? `${renderer.instanceId}:${sequenceIndex}:loop:${assetId}:${terminalMode.clipStartTime ?? 0}`
      : `${renderer.instanceId}:${sequenceIndex}:sequence:${assetId}`;
  const registerPlaybackHandle = useCallback(
    (handle: ExperienceMediaPlaybackHandle | null) =>
      onPlaybackHandle(
        renderer.instanceId,
        config.autoplay && terminalMode?.kind !== "held" ? handle : null
      ),
    [config.autoplay, onPlaybackHandle, renderer.instanceId, terminalMode?.kind]
  );

  useEffect(() => {
    completedRendererIdRef.current = null;
    missingAssetRef.current = null;
    if (completionTimerRef.current !== null) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    return () => {
      if (completionTimerRef.current !== null) window.clearTimeout(completionTimerRef.current);
    };
  }, [renderer.instanceId]);

  useEffect(() => {
    const missingAssetKey = `${renderer.instanceId}:${assetId}`;
    if (media || !assetId || missingAssetRef.current === missingAssetKey) return;
    missingAssetRef.current = missingAssetKey;
    onRuntimeError(copy.mediaError(assetId));
  }, [assetId, copy, media, onRuntimeError, renderer.instanceId]);

  const completeRenderer = () => {
    if (completedRendererIdRef.current === renderer.instanceId) return;
    completedRendererIdRef.current = renderer.instanceId;
    onCompleted();
  };
  const advanceSequence = () => {
    if (sequenceIndex + 1 < config.sequence.length) {
      setPlaybackState({
        rendererInstanceId: renderer.instanceId,
        sequenceIndex: sequenceIndex + 1,
        terminalMode: null,
      });
      return;
    }
    completeRenderer();
  };
  const handleEnd = () => {
    if (!clip || terminalMode?.kind === "loop") return;
    const behavior = clip.endBehavior;
    if (behavior.behavior === "advance") return advanceSequence();
    if (behavior.behavior === "hold-last-frame") {
      setPlaybackState({
        rendererInstanceId: renderer.instanceId,
        sequenceIndex,
        terminalMode: { kind: "held" },
      });
      if (behavior.durationMs !== undefined) {
        completionTimerRef.current = window.setTimeout(advanceSequence, behavior.durationMs);
      }
      return;
    }
    if (behavior.behavior === "loop") {
      setPlaybackState({
        rendererInstanceId: renderer.instanceId,
        sequenceIndex,
        terminalMode: { kind: "loop", assetId: behavior.assetId },
      });
      return;
    }
    const durationSeconds = media?.variant.durationMs ? media.variant.durationMs / 1_000 : 0;
    setPlaybackState({
      rendererInstanceId: renderer.instanceId,
      sequenceIndex,
      terminalMode: {
        kind: "loop",
        assetId: clip.assetId,
        clipStartTime: Math.max(0, durationSeconds - behavior.tailSeconds),
      },
    });
  };

  if (!clip || !assetId || !media) return null;
  // A "native" clip is inline reading media: it keeps its intrinsic aspect
  // ratio, is centered in the responsive stage, and scales down to fit without
  // ever cropping. Everything else fills a fixed full-bleed frame.
  const native = config.fit === "native";
  const player = (
    <ExperienceMediaPlayer
      source={{ src: media.variant.uri, type: media.variant.mediaType }}
      title={copy.videoLabel(renderer.instanceId)}
      autoPlay={false}
      // Never metadata-driven: a clip is played with sound and only muted once
      // the browser has actually refused it (see onSoundBlocked).
      muted={muted}
      loop={terminalMode?.kind === "loop"}
      durationSeconds={media.variant.durationMs ? media.variant.durationMs / 1_000 : undefined}
      clipStartTime={terminalMode?.kind === "loop" ? terminalMode.clipStartTime : undefined}
      poster={poster}
      fit={config.fit === "native" ? "contain" : config.fit}
      onEnd={handleEnd}
      onTimeUpdate={(seconds) => onTimelineTimeMs(timelineOffsetMs + Math.round(seconds * 1_000))}
      onPlaybackError={(message) => onRuntimeError(message?.trim() || copy.mediaError(assetId))}
      onPlaybackHandle={registerPlaybackHandle}
      onSoundBlocked={onSoundBlocked}
      playbackIdentity={playbackIdentity}
      copy={copy.video}
    />
  );
  if (native) {
    return (
      <div
        className="absolute inset-0 grid place-items-center p-4 sm:p-6"
        style={{ zIndex: renderer.layer }}
        data-experience-video-fit="native"
      >
        <div
          className="relative overflow-hidden rounded-lg bg-black"
          style={{
            // Percentage width (not a fixed px) so an aspect-ratio box also
            // shrinks when the viewport height is the binding constraint; the
            // native width is only an upper cap so the clip never upscales.
            width: "100%",
            maxWidth: media.variant.width,
            maxHeight: "100%",
            ...(media.variant.width && media.variant.height
              ? {
                  aspectRatio: `${media.variant.width} / ${media.variant.height}`,
                }
              : {}),
          }}
        >
          {player}
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0" style={{ zIndex: renderer.layer }}>
      {player}
    </div>
  );
}

function CoreChoiceRenderer({
  manifest,
  renderer,
  runtimeState,
  active,
  open,
  locale,
  copy,
  onSelect,
}: {
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  runtimeState: ExperienceRuntimeState;
  active: boolean;
  open: boolean;
  locale: string;
  copy: ExperiencePlayerCopy;
  onSelect: (choiceId: string) => void;
}) {
  const promptId = useId();
  const config = ExperienceCoreChoiceRendererConfigSchema.parse(renderer.config);
  if (!active || (!config.initiallyOpen && !open)) return null;
  const choices = config.choices.filter(
    (choice) =>
      !choice.visibleWhen ||
      evaluateExperienceCondition(choice.visibleWhen, runtimeState, {
        type: "runtime.visibility",
      })
  );
  return (
    <div
      role="group"
      aria-labelledby={promptId}
      className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black via-black/88 to-transparent px-4 pt-24 pb-5 sm:px-8 sm:pb-8"
      style={{ zIndex: renderer.layer }}
    >
      <p id={promptId} className="text-center text-sm font-semibold text-white sm:text-base">
        {localize(config.prompt, locale, manifest.localization.defaultLocale)}
      </p>
      {choices.length > 0 ? (
        <div className="mx-auto mt-4 grid max-w-2xl gap-2 sm:grid-cols-2">
          {choices.map((choice) => (
            <button
              key={choice.choiceId}
              type="button"
              onClick={() => onSelect(choice.choiceId)}
              className="min-h-12 rounded-xl bg-white/[0.12] px-4 py-3 text-left text-sm font-semibold text-white backdrop-blur-xl transition-colors hover:bg-white/[0.2] focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
              aria-label={
                choice.accessibilityLabel
                  ? localize(choice.accessibilityLabel, locale, manifest.localization.defaultLocale)
                  : undefined
              }
            >
              {localize(choice.label, locale, manifest.localization.defaultLocale)}
            </button>
          ))}
        </div>
      ) : (
        <p role="alert" className="mt-3 text-center text-xs text-white/52">
          {copy.noVisibleChoices}
        </p>
      )}
    </div>
  );
}

function CoreCheckpointRenderer({
  renderer,
  active,
  open,
  copy,
  onSelect,
}: {
  renderer: ExperienceRendererInstance;
  active: boolean;
  open: boolean;
  copy: ExperiencePlayerCopy;
  onSelect: (actionId: string) => void;
}) {
  const titleId = useId();
  const config = ExperienceCoreCheckpointRendererConfigSchema.parse(renderer.config);
  if (!active || (!config.initiallyOpen && !open)) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="absolute inset-0 flex items-end bg-linear-to-t from-black via-black/90 to-black/20 px-5 pt-24 pb-5 text-center sm:px-8 sm:pb-8"
      style={{ zIndex: renderer.layer }}
    >
      <div className="mx-auto max-w-xl rounded-2xl bg-white/[0.1] p-5 backdrop-blur-2xl">
        <p id={titleId} className="text-sm font-semibold text-white">
          {copy.checkpointPrompt}
        </p>
        <p className="mt-1.5 text-xs leading-5 text-white/52">{copy.checkpointDescription}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {config.actionIds.map((actionId) => (
            <button
              key={actionId}
              type="button"
              className={`${PRIMARY_BUTTON} min-w-40`}
              onClick={() => onSelect(actionId)}
            >
              {copy.continue}
              <IconArrowRight className="size-4" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const STAGE_ASPECT: Record<ExperienceOrientation, number> = {
  landscape: 16 / 9,
  portrait: 9 / 16,
  square: 1,
};

/**
 * The cinematic shell preserves the authored aspect ratio and covers the
 * viewport, rotating landscape work on portrait screens when necessary. The
 * narrative shell is responsive instead, so long-form text owns the available
 * reading viewport without being cropped. Renderer selection remains entirely
 * manifest-driven in both profiles.
 */
function PlayerFrame({
  orientation,
  experienceProfile,
  stageProfile,
  copy,
  style,
  children,
}: {
  orientation: ExperienceOrientation;
  experienceProfile: ExperienceProfile;
  stageProfile: ExperienceProfile;
  copy: ExperiencePlayerCopy;
  style?: CSSProperties;
  children: React.ReactNode;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const shellSize = useShellSize(shellRef);
  const aspect = STAGE_ASPECT[orientation];
  const rotated =
    stageProfile === "cinematic" &&
    orientation === "landscape" &&
    shellSize !== null &&
    shellSize.height > shellSize.width;
  let stageStyle: CSSProperties = { width: "100%", height: "100%" };
  if (stageProfile === "cinematic" && shellSize) {
    const availWidth = rotated ? shellSize.height : shellSize.width;
    const availHeight = rotated ? shellSize.width : shellSize.height;
    const width = Math.max(availWidth, availHeight * aspect);
    stageStyle = { width: Math.round(width), height: Math.round(width / aspect) };
  }
  return (
    <div
      ref={shellRef}
      role="region"
      aria-label={copy.regionLabel}
      style={style}
      data-experience-profile={experienceProfile}
      data-experience-stage-profile={stageProfile}
      className="relative h-full min-h-[inherit] w-full overflow-hidden bg-[var(--experience-color-background,#000)] text-[var(--experience-color-text,#fff)]"
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          ...stageStyle,
          transform: rotated ? "translate(-50%, -50%) rotate(90deg)" : "translate(-50%, -50%)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Project profile controls the overall product presentation, while the active
 * scene controls the safe stage geometry. Text must never inherit cinematic
 * cover/rotation behavior: a mixed cinematic story can therefore move into a
 * full-viewport reading scene and return to its authored cinematic frame for
 * the next video scene.
 */
function resolveRendererStageProfile(
  visibleRenderers: readonly ExperienceRendererInstance[],
  experienceProfile: ExperienceProfile
): ExperienceProfile {
  if (
    visibleRenderers.some((renderer) => renderer.rendererId === EXPERIENCE_CORE_TEXT_RENDERER_ID)
  ) {
    return "narrative";
  }
  return experienceProfile;
}

function useShellSize(ref: React.RefObject<HTMLDivElement | null>): {
  width: number;
  height: number;
} | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize((current) =>
          current && current.width === rect.width && current.height === rect.height
            ? current
            : { width: rect.width, height: rect.height }
        );
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function usePlaybackOrientation(
  manifest: ExperienceRuntimeManifest,
  frameProfile: ExperiencePlayerFrameProfile
): ExperienceOrientation {
  const [preferPortrait, setPreferPortrait] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px) and (orientation: portrait)");
    const update = () => setPreferPortrait(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const orientations = new Set(
    manifest.assets.flatMap((asset) =>
      asset.kind === "video" || asset.kind === "image"
        ? asset.variants.map((variant) => variant.orientation)
        : []
    )
  );
  if (frameProfile !== "auto" && orientations.has(frameProfile)) return frameProfile;
  if (preferPortrait && orientations.has("portrait")) return "portrait";
  if (orientations.has("landscape")) return "landscape";
  if (orientations.has("portrait")) return "portrait";
  return "square";
}

function findGraphNode(
  manifest: ExperienceRuntimeManifest,
  sceneId: string
): ExperienceGraphNode | undefined {
  return manifest.graph.nodes.find((node) => node.sceneId === sceneId);
}

function resolvePlaybackLocale(
  manifest: ExperienceRuntimeManifest,
  requestedLocale: string
): string {
  if (manifest.localization.locales.includes(requestedLocale)) return requestedLocale;
  const requestedLanguage = requestedLocale.split("-")[0]?.toLowerCase();
  const sameLanguage = manifest.localization.locales.find(
    (candidate) => candidate.split("-")[0]?.toLowerCase() === requestedLanguage
  );
  return sameLanguage ?? manifest.localization.defaultLocale;
}

function localize(value: ExperienceLocalizedText, locale: string, defaultLocale: string): string {
  return value[locale] ?? value[defaultLocale] ?? Object.values(value)[0] ?? "";
}

function resolveVideoMedia(
  assets: readonly ExperienceRuntimeAsset[],
  assetId: string,
  orientation: ExperienceOrientation
): { asset: ExperienceVideoAsset; variant: ExperienceVideoAsset["variants"][number] } | null {
  const asset = assets.find(
    (candidate): candidate is ExperienceVideoAsset =>
      candidate.assetId === assetId && candidate.kind === "video"
  );
  if (!asset) return null;
  const variant =
    asset.variants.find((candidate) => candidate.orientation === orientation) ?? asset.variants[0];
  return variant ? { asset, variant } : null;
}

function resolveImageUri(
  assets: readonly ExperienceRuntimeAsset[],
  assetId: string,
  orientation: ExperienceOrientation
): string | undefined {
  const asset = assets.find(
    (candidate): candidate is ExperienceImageAsset =>
      candidate.assetId === assetId && candidate.kind === "image"
  );
  if (!asset) return undefined;
  return (
    asset.variants.find((candidate) => candidate.orientation === orientation) ?? asset.variants[0]
  )?.uri;
}

function sequenceTimelineOffsetMs(
  assets: readonly ExperienceRuntimeAsset[],
  config: ExperienceCoreVideoRendererConfig,
  sequenceIndex: number,
  orientation: ExperienceOrientation
): number {
  return config.sequence.slice(0, sequenceIndex).reduce((total, clip) => {
    const media = resolveVideoMedia(assets, clip.assetId, orientation);
    return total + (media?.variant.durationMs ?? 0);
  }, 0);
}

function runtimeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unknown experience runtime error";
}

function themeStyle(theme: ExperienceThemeConfig): CSSProperties & Record<`--${string}`, string> {
  const token = (key: string, fallback: string): string => {
    const value = theme.tokens[key];
    return value === undefined ? fallback : String(value);
  };
  return {
    colorScheme: theme.colorScheme,
    "--experience-color-background": token("color.background", "#000000"),
    "--experience-color-surface": token("color.surface", "#18181a"),
    "--experience-color-text": token("color.text", "#ffffff"),
    "--experience-color-text-muted": token("color.textMuted", "#a1a1aa"),
    "--experience-color-accent": token("color.accent", "#ea2804"),
    "--experience-radius-panel": `${token("radius.panel", "20")}px`,
    "--experience-spacing-unit": `${token("spacing.unit", "4")}px`,
  };
}
