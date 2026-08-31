"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID,
  EXPERIENCE_CORE_CHOICE_RENDERER_ID,
  EXPERIENCE_CORE_TEXT_RENDERER_ID,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID,
  EXPERIENCE_RENDERER_MAX_LAYER,
  ExperienceCoreChoiceRendererConfigSchema,
  ExperienceCoreTextRendererConfigSchema,
  ExperienceCoreVideoRendererConfigSchema,
  ExperienceCoreWorldModelRendererConfigSchema,
  ExperienceRuntimeManifestSchema,
  type ExperienceCoreVideoRendererConfig,
  type ExperienceCoreWorldModelRendererConfig,
  type ExperienceGraphNode,
  type ExperienceImageAsset,
  type ExperienceLocalizedText,
  type ExperienceOrientation,
  type ExperienceProfile,
  type ExperienceRendererInstance,
  type ExperienceRuntimeAsset,
  type ExperienceRuntimeManifest,
  type ExperienceScene,
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

export interface ExperienceWorldModelRendererProps {
  config: ExperienceCoreWorldModelRendererConfig;
  active: boolean;
  onCompleted: () => void;
  onError: (error: unknown) => void;
}

export interface ExperiencePlayerProps {
  runtime: unknown;
  locale: string;
  copy: ExperiencePlayerCopy;
  coverUrl?: string;
  randomSeed?: string;
  frameProfile?: ExperiencePlayerFrameProfile;
  loadTheme?: ExperienceThemeLoader;
  renderWorldModel?: (props: ExperienceWorldModelRendererProps) => ReactNode;
}

const PRIMARY_BUTTON =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--experience-color-accent,#ea2804)] px-7 text-sm font-semibold text-white outline-none transition-colors hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none";
const SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-white/[0.12] px-5 text-sm font-semibold text-white outline-none transition-colors hover:bg-white/[0.2] focus-visible:ring-2 focus-visible:ring-white/60 motion-reduce:transition-none";

export function ExperiencePlayer({
  runtime,
  locale,
  coverUrl,
  randomSeed: initialRandomSeed,
  copy,
  frameProfile = "auto",
  loadTheme = defaultLoadExperienceTheme,
  renderWorldModel,
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
      coverUrl={coverUrl}
      frameProfile={frameProfile}
      loadTheme={loadTheme}
      renderWorldModel={renderWorldModel}
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
  coverUrl,
  frameProfile,
  loadTheme,
  renderWorldModel,
  onRestart,
}: {
  manifest: ExperienceRuntimeManifest;
  controller: ExperienceRuntimeController;
  locale: string;
  copy: ExperiencePlayerCopy;
  coverUrl?: string;
  frameProfile: ExperiencePlayerFrameProfile;
  loadTheme: ExperienceThemeLoader;
  renderWorldModel?: (props: ExperienceWorldModelRendererProps) => ReactNode;
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
  // Gesture outcomes parked until the scene clock reaches their safe branch
  // frame. Branch routing must not cut mid-pose: the interaction resolves the
  // instant the input lands, but the cut waits for `branchAtMs` so the outgoing
  // clip plays its resolve beat first. Cleared when the scene changes — parked
  // events belong to the scene that emitted them.
  const parkedGestureEventsRef = useRef<ExperienceRuntimeEvent[]>([]);
  const playbackHandlesRef = useRef(new Map<string, ExperienceMediaPlaybackHandle>());
  const playbackEnabledRef = useRef(false);
  // True while a timeline-control press-hold window is open, unresolved, and
  // not held — the host must keep the scene media paused so playback position
  // equals charge progress. Lifted from the spatial layer, which owns press
  // state.
  const [timelineHoldGate, setTimelineHoldGate] = useState(false);
  const orientation = usePlaybackOrientation(manifest, frameProfile);
  useNextScenePreload(manifest, runtimeState.currentSceneId, orientation);
  // The cover is the only art that exists before any clip has played, so it is
  // what the loading and title screen should stand on — otherwise the viewer
  // waits on a black rectangle. Absent cover simply falls back to that.
  const coverUri =
    coverUrl ??
    (manifest.metadata.coverAssetId
      ? resolveImageUri(manifest.assets, manifest.metadata.coverAssetId, orientation)
      : undefined);
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
      result.effects.forEach((effect) => {
        if (effect.kind !== "renderer.command") return;
        const handle = playbackHandlesRef.current.get(effect.instanceId);
        if (!handle) return;
        if (effect.commandType === "play") {
          void handle.play().catch((error: unknown) => setRuntimeError(runtimeErrorMessage(error)));
          return;
        }
        if (effect.commandType === "pause") {
          handle.pause();
          return;
        }
        if (effect.commandType === "seek") {
          const timeMs = effect.payload.timeMs;
          if (typeof timeMs === "number") handle.seek(timeMs / 1_000);
        }
      });
      let latestSceneId: string | null = null;
      const sceneChangeEffects = result.effects.filter(
        (effect): effect is Extract<typeof effect, { kind: "scene.changed" }> => {
          if (effect.kind !== "scene.changed") return false;
          latestSceneId = effect.toSceneId;
          return true;
        }
      );
      setOpenRendererIds((current) => {
        let next = new Set(current);
        result.effects.forEach((effect) => {
          if (effect.kind === "scene.changed") {
            next = new Set();
          }
          if (effect.kind === "renderer.command" && effect.commandType === "open") {
            next.add(effect.instanceId);
          }
        });
        return next;
      });
      // Scene resets must NOT depend on state-updater side effects: React 18
      // defers `setState(updater)` evaluation to render time when the batch
      // already holds an update, so counters bumped inside the updater read
      // as zero here. A missed reset left the incoming scene holding the
      // outgoing scene's final clock, resolving interaction windows that
      // never opened (the charge scene skipping straight to its fail branch).
      if (sceneChangeEffects.length > 0) {
        setSceneEpoch((value) => value + sceneChangeEffects.length);
        setSceneTimeMs(0);
        parkedGestureEventsRef.current = [];
        timelineCursorRef.current = createExperienceTimelineCursor(
          latestSceneId ?? result.state.currentSceneId
        );
        debugTrace(`scene -> ${latestSceneId ?? result.state.currentSceneId}`);
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
        // A late input is normal, not a fault. `<video>` fires `ended` on its own
        // schedule, so one can land after the scene it belonged to is gone or
        // after the experience finished; a queued rAF frame can do the same. The
        // runtime is right to refuse it — but ending the viewer's session over it
        // turns an ordinary race into "试玩无法继续". Discard and carry on.
        if (isDiscardableLateInput(error)) return false;
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
    (rendererInstanceId: string | null, positionMs: number) => {
      const currentState = controller.state();
      const activeNode = findGraphNode(manifest, currentState.currentSceneId);
      if (!activeNode || activeNode.kind !== "scene") return;
      // Media time reports are attributed to the renderer that produced them.
      // A video element that is mid-unmount after a scene change still fires
      // one last timeupdate with the OUTGOING scene's final position; accepting
      // it would teleport the incoming scene's clock past its interaction
      // windows and resolve gestures that never opened (the charge scene
      // skipping straight to its fail branch). Host-owned reports (the fixed
      // rAF clock) pass null and are always accepted.
      if (!timelineReportDrivesScene(activeNode.clock, rendererInstanceId)) {
        debugTrace(
          `reject report ${rendererInstanceId ?? "host"} @${Math.round(positionMs)} in ${activeNode.sceneId}`
        );
        return;
      }
      debugTrace(
        `clock ${activeNode.sceneId} @${Math.round(positionMs)} from ${rendererInstanceId ?? "host"}`
      );
      setSceneTimeMs(positionMs);
      const advanced = advanceExperienceTimeline(activeNode, timelineCursorRef.current, positionMs);
      timelineCursorRef.current = advanced.cursor;
      if (advanced.events.length > 0) run(() => controller.dispatch(advanced.events));
      flushParkedGestureEvents(positionMs);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, manifest, run]
  );

  /**
   * Releases parked gesture outcomes whose safe branch frame has arrived.
   * Returns the events that should dispatch now; callers that only inspect
   * (tests) can call it read-only via `peekParkedGestureEvents`.
   */
  const flushParkedGestureEvents = useCallback(
    (positionMs: number) => {
      if (parkedGestureEventsRef.current.length === 0) return;
      const due = parkedGestureEventsRef.current.filter(
        (event) => positionMs >= parkedEventBranchAtMs(manifest, event)
      );
      if (due.length === 0) return;
      parkedGestureEventsRef.current = parkedGestureEventsRef.current.filter(
        (event) => !due.includes(event)
      );
      run(() => controller.dispatch(due));
    },
    [controller, manifest, run]
  );

  const emitRuntimeEvents = useCallback(
    (events: readonly ExperienceRuntimeEvent[]) => {
      const parked = events.filter(
        (event) =>
          event.type.startsWith("gesture.") &&
          timelineCursorRef.current.positionMs < parkedEventBranchAtMs(manifest, event) - 1e-6
      );
      if (parked.length === 0) {
        run(() => controller.dispatch(events));
        return;
      }
      const immediate = events.filter((event) => !parked.includes(event));
      parkedGestureEventsRef.current.push(...parked);
      if (immediate.length > 0) run(() => controller.dispatch(immediate));
    },
    [controller, manifest, run]
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
      advanceTimeline(null, elapsed);
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

  // Timeline-control charge gating: while a press-hold window is open,
  // unresolved, and not held, the media must not advance — playback position
  // is the charge progress. The moment the gate lifts (press, resolution, or
  // idle timeout), playback resumes so the clip can run its resolve beat to
  // the safe branch frame. Film scenes carry exactly one clock-driving video,
  // so gating every registered handle is equivalent to gating the clock.
  useEffect(() => {
    if (!started) return;
    if (timelineHoldGate) {
      playbackHandlesRef.current.forEach((handle) => handle.pause());
      return;
    }
    if (!playbackEnabledRef.current) return;
    playbackHandlesRef.current.forEach((handle) => {
      void handle.play().catch(() => undefined);
    });
  }, [started, timelineHoldGate]);

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
            onTimelineTimeMs={(timeMs) => advanceTimeline(renderer.instanceId, timeMs)}
            onOutcome={emitOutcome}
            onRuntimeError={setRuntimeError}
            onPlaybackHandle={registerPlaybackHandle}
            onSoundBlocked={handleSoundBlocked}
            renderWorldModel={renderWorldModel}
          />
        ))
      ) : (
        <div className="absolute inset-0 bg-black" />
      )}

      {soundBlocked && started && !endingId && !runtimeError && hasVideoRenderer ? (
        // Renderer overlays stack on the manifest's own `renderer.layer` as a raw
        // zIndex — a choice overlay compiles to 100 — so a Tailwind z-* on
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
          key={scene.sceneId}
          manifest={manifest}
          scene={scene}
          runtimeState={runtimeState}
          sceneTimeMs={sceneTimeMs}
          locale={playbackLocale}
          orientation={orientation}
          onEvents={emitRuntimeEvents}
          onRuntimeError={setRuntimeError}
          onTimelineHoldGateChange={setTimelineHoldGate}
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
          {coverUri ? (
            <img
              src={coverUri}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 size-full object-cover opacity-40"
            />
          ) : null}
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
  renderWorldModel,
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
  renderWorldModel?: (props: ExperienceWorldModelRendererProps) => ReactNode;
}) {
  if (renderer.rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID) {
    // A video scene with nothing to play is a preview Build of a work whose
    // footage is not attached yet. It stands in for the shot and then finishes
    // on the SAME outcome a real clip produces, so every exit downstream — auto,
    // choice, ending — keeps working untouched.
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
  if (renderer.rendererId === EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID) {
    return (
      <CoreWorldModelRenderer
        renderer={renderer}
        active={active}
        renderWorldModel={renderWorldModel}
        onCompleted={() => onOutcome(renderer.instanceId, "world-completed", {})}
        onRuntimeError={onRuntimeError}
      />
    );
  }
  if (renderer.rendererId === EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID) return null;
  return null;
}

function CoreWorldModelRenderer({
  renderer,
  active,
  renderWorldModel,
  onCompleted,
  onRuntimeError,
}: {
  renderer: ExperienceRendererInstance;
  active: boolean;
  renderWorldModel?: (props: ExperienceWorldModelRendererProps) => ReactNode;
  onCompleted: () => void;
  onRuntimeError: (message: string) => void;
}) {
  const reportedErrorRef = useRef<string | null>(null);
  const parsed = ExperienceCoreWorldModelRendererConfigSchema.safeParse(renderer.config);
  const errorMessage = !parsed.success
    ? parsed.error.issues.map((issue) => issue.message).join("; ")
    : !renderWorldModel
      ? "World model runtime host is unavailable."
      : null;

  useEffect(() => {
    if (!errorMessage || reportedErrorRef.current === errorMessage) return;
    reportedErrorRef.current = errorMessage;
    onRuntimeError(errorMessage);
  }, [errorMessage, onRuntimeError]);

  if (!parsed.success || !renderWorldModel) return null;

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-black"
      style={{ zIndex: renderer.layer }}
      data-experience-renderer="core.world-model"
    >
      {renderWorldModel({
        config: parsed.data,
        active,
        onCompleted,
        onError: (error) => onRuntimeError(runtimeErrorMessage(error)),
      })}
    </div>
  );
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

interface CoreVideoCompletionTimer {
  readonly id: number;
  readonly rendererInstanceId: string;
}

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
/** How often a still reports elapsed time, matching a video's timeupdate rate. */
const STILL_CLOCK_TICK_MS = 250;

/**
 * A still's screen time. The sequence expresses it as the clip's held
 * duration, which the compiler always emits for a still; the fallback only
 * covers a hand-authored manifest that held a frame indefinitely.
 */
function stillDurationMs(clip: { endBehavior: { behavior: string; durationMs?: number } }): number {
  return clip.endBehavior.behavior === "hold-last-frame" && clip.endBehavior.durationMs
    ? clip.endBehavior.durationMs
    : EMPTY_SEQUENCE_HOLD_MS;
}

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
  const completionTimerRef = useRef<CoreVideoCompletionTimer | null>(null);
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

  const clearCompletionTimer = useCallback((rendererInstanceId?: string) => {
    const timer = completionTimerRef.current;
    if (!timer || (rendererInstanceId && timer.rendererInstanceId !== rendererInstanceId)) return;
    window.clearTimeout(timer.id);
    completionTimerRef.current = null;
  }, []);

  // The core-video slot is intentionally reused between scenes so WebKit keeps
  // the media element that received the user's audible-playback permission.
  // Scene-owned resources must nevertheless be reset BEFORE a new child can
  // register its playback handle: passive child effects run before passive
  // parent effects, which previously let an opening still schedule its timer
  // and then had this reset clear that brand-new timer. A layout effect runs the
  // reset before any passive handle registration, while timer ownership makes a
  // late cleanup from the old scene unable to touch the new scene's timer.
  useLayoutEffect(() => {
    completedRendererIdRef.current = null;
    missingAssetRef.current = null;
    clearCompletionTimer();
    return () => clearCompletionTimer(renderer.instanceId);
  }, [clearCompletionTimer, renderer.instanceId]);

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
  const scheduleCompletion = (durationMs: number) => {
    clearCompletionTimer();
    const rendererInstanceId = renderer.instanceId;
    const id = window.setTimeout(() => {
      const timer = completionTimerRef.current;
      if (!timer || timer.id !== id || timer.rendererInstanceId !== rendererInstanceId) return;
      completionTimerRef.current = null;
      advanceSequence();
    }, durationMs);
    completionTimerRef.current = { id, rendererInstanceId };
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
        scheduleCompletion(behavior.durationMs);
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
  const stillImage = Boolean(media.variant.mediaType?.toLowerCase().startsWith("image/"));
  const player = stillImage ? (
    <ExperienceStillSegment
      uri={media.variant.uri}
      title={copy.videoLabel(renderer.instanceId)}
      fit={config.fit === "native" ? "contain" : config.fit}
      durationMs={stillDurationMs(clip)}
      timelineOffsetMs={timelineOffsetMs}
      playbackIdentity={playbackIdentity}
      onDisplayed={handleEnd}
      onTimelineTimeMs={onTimelineTimeMs}
      onPlaybackHandle={registerPlaybackHandle}
    />
  ) : (
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

/**
 * A storyboard still on the sequence timeline, played through the same
 * playback handle a video clip uses.
 *
 * A still has no element that plays itself, so it is governed like footage
 * instead of like an image: it declares itself displayed only when the host
 * calls play() — never on image load, which happens behind the title screen —
 * and from then on reports elapsed time so the scene clock keeps advancing and
 * time-anchored interactions stay live. Its screen time is the clip's
 * `hold-last-frame` duration, still owned by the sequence above.
 */
function ExperienceStillSegment({
  uri,
  title,
  fit,
  durationMs,
  timelineOffsetMs,
  playbackIdentity,
  onDisplayed,
  onTimelineTimeMs,
  onPlaybackHandle,
}: {
  uri: string;
  title: string;
  fit: "cover" | "contain";
  durationMs: number;
  timelineOffsetMs: number;
  playbackIdentity: string;
  onDisplayed: () => void;
  onTimelineTimeMs: (timeMs: number) => void;
  onPlaybackHandle: (handle: ExperienceMediaPlaybackHandle | null) => void;
}) {
  const displayedRef = useRef(false);
  const elapsedMsRef = useRef(0);
  const runningSinceRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const onDisplayedRef = useRef(onDisplayed);
  onDisplayedRef.current = onDisplayed;
  const onTimelineTimeMsRef = useRef(onTimelineTimeMs);
  onTimelineTimeMsRef.current = onTimelineTimeMs;

  const stopTicking = useCallback(() => {
    if (tickRef.current === null) return;
    window.clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  // The clock outlives handle registration: the sequence deregisters the
  // handle the moment this clip enters its terminal hold, which is exactly
  // when the still is on screen and the scene clock must keep running.
  useEffect(() => {
    displayedRef.current = false;
    elapsedMsRef.current = 0;
    runningSinceRef.current = null;
    return () => {
      stopTicking();
    };
  }, [playbackIdentity, stopTicking]);

  useEffect(() => {
    const elapsed = () =>
      elapsedMsRef.current +
      (runningSinceRef.current === null ? 0 : performance.now() - runningSinceRef.current);
    const handle: ExperienceMediaPlaybackHandle = {
      playbackIdentity,
      play: async () => {
        if (runningSinceRef.current === null) {
          runningSinceRef.current = performance.now();
          stopTicking();
          tickRef.current = window.setInterval(() => {
            const now = Math.min(elapsed(), durationMs);
            onTimelineTimeMsRef.current(timelineOffsetMs + now);
            if (now >= durationMs) stopTicking();
          }, STILL_CLOCK_TICK_MS);
        }
        if (displayedRef.current) return;
        displayedRef.current = true;
        onTimelineTimeMsRef.current(timelineOffsetMs);
        onDisplayedRef.current();
      },
      pause: () => {
        if (runningSinceRef.current === null) return;
        elapsedMsRef.current = elapsed();
        runningSinceRef.current = null;
        stopTicking();
      },
      seek: (seconds) => {
        const target = Math.max(0, Math.min(seconds * 1_000, durationMs));
        elapsedMsRef.current = target;
        if (runningSinceRef.current !== null) runningSinceRef.current = performance.now();
        onTimelineTimeMsRef.current(timelineOffsetMs + target);
      },
      // A still carries no audio track, so muting is a no-op rather than an
      // error — the host mutes every registered handle uniformly.
      setMuted: () => undefined,
    };
    onPlaybackHandle(handle);
    return () => onPlaybackHandle(null);
  }, [durationMs, onPlaybackHandle, playbackIdentity, stopTicking, timelineOffsetMs]);

  return (
    <img src={uri} alt={title} className="absolute inset-0 size-full" style={{ objectFit: fit }} />
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
      className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black via-black/88 to-transparent px-4 pt-24 pb-12 sm:px-8 sm:pb-16"
      style={{ zIndex: renderer.layer }}
    >
      <p
        id={promptId}
        className="mx-auto max-w-2xl text-center text-[15px] leading-6 font-semibold text-balance text-white sm:text-base sm:leading-7"
      >
        {localize(config.prompt, locale, manifest.localization.defaultLocale)}
      </p>
      {choices.length > 0 ? (
        <div className="mx-auto mt-5 grid max-w-2xl gap-2.5 sm:grid-cols-2">
          {choices.map((choice, index) => (
            <button
              key={choice.choiceId}
              type="button"
              onClick={() => onSelect(choice.choiceId)}
              className={classNames(
                // Frosted glass over arbitrary footage: one flat fill and one
                // hairline, so the card reads on a bright frame and a black
                // one without decorating the shot.
                "min-h-13 rounded-2xl px-4 py-3.5 text-left text-sm leading-5 font-semibold text-white sm:text-[15px]",
                "bg-white/[0.10] ring-1 ring-inset ring-white/10 backdrop-blur-2xl",
                "transition-colors duration-200 hover:bg-white/[0.17] hover:ring-white/16",
                "focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none",
                // An odd final choice spans the row rather than leaving a gap.
                choices.length % 2 === 1 && index === choices.length - 1
                  ? "sm:col-span-2"
                  : undefined
              )}
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

/**
 * A media time report may only drive a scene whose clock that renderer owns.
 * Renderer clocks name their video instance; host-owned reports (the fixed
 * rAF clock) pass null and are always accepted. The guard exists for the
 * dying-video race: after a scene change the outgoing element can still fire
 * one last timeupdate carrying the old scene's final position.
 */
export function timelineReportDrivesScene(
  clock: ExperienceScene["clock"],
  rendererInstanceId: string | null
): boolean {
  if (clock.kind !== "renderer") return true;
  return clock.rendererInstanceId === rendererInstanceId;
}

/**
 * Opt-in playtest diagnostics. Enabled only with ?debug=trace; appends
 * runtime milestones to a fixed overlay so automation (and humans) can read
 * the exact event order behind scene/gesture bugs. The flag is resolved once
 * per window because the trace sites sit on hot paths (media timeupdates).
 */
let debugTraceEnabled: boolean | null = null;

export function debugTrace(line: string): void {
  if (typeof window === "undefined") return;
  if (debugTraceEnabled === null) {
    debugTraceEnabled = new URLSearchParams(window.location.search).get("debug") === "trace";
  }
  if (!debugTraceEnabled) return;
  const record = window as typeof window & { __fizzTrace?: string[] };
  record.__fizzTrace = record.__fizzTrace ?? [];
  record.__fizzTrace.push(`${Date.now() % 100000} ${line}`);
  let host = document.getElementById("fizz-debug-trace");
  if (!host) {
    host = document.createElement("div");
    host.id = "fizz-debug-trace";
    host.setAttribute("aria-label", "runtime trace");
    host.style.cssText =
      "position:fixed;left:0;bottom:0;z-index:2147483647;max-height:40vh;overflow:auto;font:10px/1.35 monospace;background:rgba(0,0,0,.82);color:#9fe8b5;padding:6px 8px;white-space:pre;pointer-events:none;max-width:60vw";
    document.body.appendChild(host);
  }
  host.textContent = record.__fizzTrace.slice(-30).join("\n");
}

/**
 * Resolves when a gesture outcome event may actually route. The safe branch
 * frame defaults to the interaction window end, so interactions authored
 * before `branchAtMs` existed keep cutting exactly where they used to.
 */
function parkedEventBranchAtMs(
  manifest: ExperienceRuntimeManifest,
  event: ExperienceRuntimeEvent
): number {
  if (!event.sourceId) return 0;
  const gesture = manifest.graph.nodes
    .filter(
      (node): node is Extract<ExperienceGraphNode, { kind: "scene" }> => node.kind === "scene"
    )
    .flatMap((node) => node.gestures)
    .find((candidate) => candidate.gestureId === event.sourceId);
  return gesture?.branchAtMs ?? gesture?.activeWindow?.endMs ?? 0;
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

/**
 * Warms the clips reachable from the current scene without delaying playback.
 *
 * An interactive film has multiple possible "next" clips. Loading the entire
 * story before Start creates a delay proportional to the size of the graph and
 * downloads branches the viewer may never enter. One-hop preloading keeps the
 * current decision's targets warm while the current clip is playing. A failed
 * warm-up never blocks the experience; the real media element remains the
 * authority and reports an error only if that scene is actually entered.
 */
function useNextScenePreload(
  manifest: ExperienceRuntimeManifest,
  sceneId: string,
  orientation: ExperienceOrientation
): void {
  const uris = useMemo(
    () => resolveNextSceneVideoUris(manifest, sceneId, orientation),
    [manifest, orientation, sceneId]
  );
  useEffect(() => {
    if (uris.length === 0) return;
    const elements: HTMLVideoElement[] = [];
    uris.forEach((uri) => {
      const element = document.createElement("video");
      element.preload = "auto";
      element.muted = true;
      element.playsInline = true;
      element.src = uri;
      element.load();
      elements.push(element);
    });
    return () => {
      elements.forEach((element) => {
        element.removeAttribute("src");
        element.load();
      });
    };
  }, [uris]);
}

export function resolveNextSceneVideoUris(
  manifest: ExperienceRuntimeManifest,
  sceneId: string,
  orientation: ExperienceOrientation
): string[] {
  const current = findGraphNode(manifest, sceneId);
  if (!current || current.kind !== "scene") return [];
  const targetSceneIds = new Set(
    current.eventBindings.flatMap((binding) =>
      binding.routes.flatMap((route) =>
        route.actions.flatMap((action) =>
          action.kind === "scene.goto" && action.sceneId !== sceneId ? [action.sceneId] : []
        )
      )
    )
  );
  const wanted = new Set<string>();
  targetSceneIds.forEach((targetSceneId) => {
    const target = findGraphNode(manifest, targetSceneId);
    if (!target || target.kind !== "scene") return;
    target.renderers.forEach((renderer) => {
      if (renderer.rendererId !== EXPERIENCE_CORE_VIDEO_RENDERER_ID) return;
      const parsed = ExperienceCoreVideoRendererConfigSchema.safeParse(renderer.config);
      if (!parsed.success) return;
      parsed.data.sequence.forEach((clip) => {
        const media = resolveVideoMedia(manifest.assets, clip.assetId, orientation);
        if (media) wanted.add(media.variant.uri);
      });
    });
  });
  return [...wanted];
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
    // A still carries no media duration — its screen time is the held
    // duration on the clip. Reading only the variant would under-count it and
    // shift every later clip's interaction window earlier.
    if (media?.variant.mediaType?.toLowerCase().startsWith("image/")) {
      return total + stillDurationMs(clip);
    }
    return total + (media?.variant.durationMs ?? 0);
  }, 0);
}

function runtimeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unknown experience runtime error";
}

/**
 * Runtime invariants that only mean "this input arrived too late to matter".
 *
 * Matched on the invariant `code` rather than the class, so a player bundled
 * against a differently-resolved copy of the engine still recognises them.
 */
const DISCARDABLE_INPUT_CODES = new Set(["RUNTIME_NOT_STARTED"]);

function isDiscardableLateInput(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "ExperienceRuntimeInvariantError") {
    return false;
  }
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && DISCARDABLE_INPUT_CODES.has(code);
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
