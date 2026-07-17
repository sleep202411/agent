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
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  ExperienceCoreCheckpointRendererConfigSchema,
  ExperienceCoreChoiceRendererConfigSchema,
  ExperienceCoreVideoRendererConfigSchema,
  ExperienceRuntimeManifestSchema,
  type ExperienceCoreVideoRendererConfig,
  type ExperienceGraphNode,
  type ExperienceImageAsset,
  type ExperienceLocalizedText,
  type ExperienceOrientation,
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
  const timelineCursorRef = useRef<ExperienceTimelineCursor>(
    createExperienceTimelineCursor(runtimeState.currentSceneId)
  );
  const playbackHandlesRef = useRef(new Map<string, ExperienceMediaPlaybackHandle>());
  const playbackEnabledRef = useRef(false);
  const orientation = usePlaybackOrientation(manifest, frameProfile);
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

  const registerPlaybackHandle = useCallback(
    (instanceId: string, handle: ExperienceMediaPlaybackHandle | null) => {
      if (!handle) {
        playbackHandlesRef.current.delete(instanceId);
        return;
      }
      playbackHandlesRef.current.set(instanceId, handle);
      if (playbackEnabledRef.current) {
        void handle.play().catch((error: unknown) => {
          handle.pause();
          void Promise.allSettled([suspendAudio()]).then(() => {
            setRuntimeError(runtimeErrorMessage(error));
          });
        });
      }
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
            open={openRendererIds.has(renderer.instanceId)}
            locale={playbackLocale}
            orientation={orientation}
            copy={copy}
            onTimelineTimeMs={advanceTimeline}
            onOutcome={emitOutcome}
            onRuntimeError={setRuntimeError}
            onPlaybackHandle={registerPlaybackHandle}
          />
        ))
      ) : (
        <div className="absolute inset-0 bg-black" />
      )}

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
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/68 p-6 text-center backdrop-blur-sm">
          <div className="max-w-lg">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-white/48 uppercase">
              {copy.interactiveFilm}
            </p>
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
  open,
  locale,
  orientation,
  copy,
  onTimelineTimeMs,
  onOutcome,
  onRuntimeError,
  onPlaybackHandle,
}: {
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  runtimeState: ExperienceRuntimeState;
  open: boolean;
  locale: string;
  orientation: ExperienceOrientation;
  copy: ExperiencePlayerCopy;
  onTimelineTimeMs: (timeMs: number) => void;
  onOutcome: (
    instanceId: string,
    outcomeType: string,
    payload: Record<string, never> | { choiceId: string }
  ) => void;
  onRuntimeError: (message: string) => void;
  onPlaybackHandle: (instanceId: string, handle: ExperienceMediaPlaybackHandle | null) => void;
}) {
  if (renderer.rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID) {
    return (
      <CoreVideoRenderer
        manifest={manifest}
        renderer={renderer}
        orientation={orientation}
        copy={copy}
        onTimelineTimeMs={onTimelineTimeMs}
        onCompleted={() => onOutcome(renderer.instanceId, "media-ended", {})}
        onRuntimeError={onRuntimeError}
        onPlaybackHandle={onPlaybackHandle}
      />
    );
  }
  if (renderer.rendererId === EXPERIENCE_CORE_CHOICE_RENDERER_ID) {
    return (
      <CoreChoiceRenderer
        manifest={manifest}
        renderer={renderer}
        runtimeState={runtimeState}
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
        open={open}
        copy={copy}
        onSelect={(actionId) => onOutcome(renderer.instanceId, actionId, {})}
      />
    );
  }
  if (renderer.rendererId === EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID) return null;
  return null;
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

function CoreVideoRenderer({
  manifest,
  renderer,
  orientation,
  copy,
  onTimelineTimeMs,
  onCompleted,
  onRuntimeError,
  onPlaybackHandle,
}: {
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  orientation: ExperienceOrientation;
  copy: ExperiencePlayerCopy;
  onTimelineTimeMs: (timeMs: number) => void;
  onCompleted: () => void;
  onRuntimeError: (message: string) => void;
  onPlaybackHandle: (instanceId: string, handle: ExperienceMediaPlaybackHandle | null) => void;
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
    const durationSeconds = media ? media.variant.durationMs / 1_000 : 0;
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
  return (
    <div className="absolute inset-0" style={{ zIndex: renderer.layer }}>
      <ExperienceMediaPlayer
        source={{ src: media.variant.uri, type: media.variant.mediaType }}
        title={copy.videoLabel(renderer.instanceId)}
        autoPlay={false}
        muted={media.asset.audioMode === "none"}
        loop={terminalMode?.kind === "loop"}
        durationSeconds={media.variant.durationMs / 1_000}
        clipStartTime={terminalMode?.kind === "loop" ? terminalMode.clipStartTime : undefined}
        poster={poster}
        fit={config.fit}
        onEnd={handleEnd}
        onTimeUpdate={(seconds) => onTimelineTimeMs(timelineOffsetMs + Math.round(seconds * 1_000))}
        onPlaybackError={(message) => onRuntimeError(message?.trim() || copy.mediaError(assetId))}
        onPlaybackHandle={registerPlaybackHandle}
        playbackIdentity={playbackIdentity}
        copy={copy.video}
      />
    </div>
  );
}

function CoreChoiceRenderer({
  manifest,
  renderer,
  runtimeState,
  open,
  locale,
  copy,
  onSelect,
}: {
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  runtimeState: ExperienceRuntimeState;
  open: boolean;
  locale: string;
  copy: ExperiencePlayerCopy;
  onSelect: (choiceId: string) => void;
}) {
  const promptId = useId();
  const config = ExperienceCoreChoiceRendererConfigSchema.parse(renderer.config);
  if (!config.initiallyOpen && !open) return null;
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
  open,
  copy,
  onSelect,
}: {
  renderer: ExperienceRendererInstance;
  open: boolean;
  copy: ExperiencePlayerCopy;
  onSelect: (actionId: string) => void;
}) {
  const titleId = useId();
  const config = ExperienceCoreCheckpointRendererConfigSchema.parse(renderer.config);
  if (!config.initiallyOpen && !open) return null;
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

function PlayerFrame({
  orientation,
  copy,
  style,
  children,
}: {
  orientation: ExperienceOrientation;
  copy: ExperiencePlayerCopy;
  style?: CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={copy.regionLabel}
      style={style}
      className={classNames(
        "relative mx-auto w-full overflow-hidden bg-[var(--experience-color-background,#000)] text-[var(--experience-color-text,#fff)]",
        orientation === "portrait" && "aspect-[9/16] max-h-[calc(100dvh-88px)] max-w-[520px]",
        orientation === "square" && "aspect-square max-h-[calc(100dvh-88px)] max-w-[900px]",
        orientation === "landscape" && "aspect-video max-h-[calc(100dvh-88px)] max-w-[1600px]"
      )}
    >
      {children}
    </div>
  );
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
