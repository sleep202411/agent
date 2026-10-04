"use client";
import { usePlaySessionReporter } from "./use-play-session-reporter";
import { useExperienceTransportVisibility } from "./use-experience-transport-visibility";

import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DOMAttributes,
  type MouseEvent,
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
  type ExperienceAccessRequirement,
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
  type ExperienceJourney,
  type ExperienceJourneyWatchedMedia,
} from "@repo/shared/experience-runtime";
import {
  EXPERIENCE_CORE_RENDERER_ADAPTERS,
  ExperienceAccessRequiredError,
  advanceExperienceTimeline,
  createExperienceTimelineCursor,
  evaluateExperienceCondition,
  initializeExperienceRuntime,
  isExperienceRendererVisible,
  isExperienceGestureAvailable,
  type ExperienceEventQueueResult,
  type ExperienceRuntimeController,
  type ExperienceRuntimeEvent,
  type ExperienceRuntimeState,
  type ExperienceTimelineCursor,
  type PlaySessionReporter,
} from "@repo/experience-engine";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconLock,
  IconPlayerPlay,
  IconRefresh,
  IconRoute,
} from "@tabler/icons-react";
import { classNames } from "./class-names";
import {
  loadExperienceTheme as defaultLoadExperienceTheme,
  type ExperienceThemeLoader,
} from "./experience-theme-loader";
import type { ExperiencePlayerCopy } from "./experience-player-copy";
import { createExperienceRuntime } from "./experience-runtime-host";
import { buildMediaEndpoint } from "./experience-build-media-uri";
import {
  ExperienceFrameRotationContext,
  shouldRotateFrame,
  useLandscapePresentation,
} from "./experience-landscape-presentation";
import {
  ExperienceMediaPlayer,
  isAutoplayPolicyRefusal,
  type ExperienceMediaPlaybackHandle,
} from "./experience-media-player";
import { warmExperienceMedia } from "./experience-media-warm";
import {
  ExperiencePlaybackDelivery,
  ExperiencePlaybackDeliveryContext,
  type ExperienceDeclaredSource,
} from "./experience-playback-delivery";
import {
  nextExperienceViewerPause,
  resolveExperiencePlaybackHolds,
  type ExperiencePlaybackGates,
  type ExperienceViewerPauseReason,
} from "./experience-playback-holds";
import {
  ExperienceFrameControls,
  ExperiencePausedScrim,
  nearAvailableExperienceGesture,
} from "./experience-playback-controls";
import { resolveExperiencePlaybackRejection } from "./experience-playback-rejection";
import { PRIMARY_BUTTON } from "./experience-player-styles";
import { ExperienceSpatialLayer } from "./experience-spatial-layer";
import { ExperienceStoryClock, ExperienceStoryClockContext } from "./experience-story-clock";
import { useExperienceAudioHost } from "./use-experience-audio-host";
import { ExperiencePlaybackTransportControls } from "./experience-transport-controls";
import {
  clampWatchedSeek,
  scenePlaybackSignature,
  mediaPlaybackSignature,
  shouldAdvancePlaybackTimeline,
  validateExperiencePlaybackCheckpoint,
  type ExperiencePlaybackCheckpoint,
  type ExperienceMediaCheckpoint,
  type ExperienceCheckpointReason,
  type ExperiencePlaybackRate,
} from "./experience-playback-checkpoint";
import { ExperienceJourneyMap } from "./experience-journey-map";
import {
  createExperienceJourney,
  validateExperienceJourney,
  recordExperienceJourney,
  projectExperienceJourneyGraph,
  createExperienceJourneyAnchor,
  restoreExperienceJourneyAnchor,
  experienceJourneyEndingNodeId,
  getExperienceJourneyReplayAccess,
  getExperienceJourneyActiveAccess,
  rewindExperienceJourney,
} from "./experience-journey-model";

export type ExperiencePlayerFrameProfile = "auto" | ExperienceOrientation;

export interface ExperienceWorldModelRendererProps {
  config: ExperienceCoreWorldModelRendererConfig;
  active: boolean;
  /**
   * The story is held — the viewer paused it, an access flow is open, it is
   * over — and the stream holds with it. Ignore input while it is.
   */
  paused: boolean;
  onCompleted: () => void;
  /**
   * Pass the error as raised, never its message: a `NotAllowedError` — the
   * stream's element refused to play without a tap — pauses the story for one
   * instead of failing it. Anything else is shown to the viewer verbatim.
   */
  onError: (error: unknown) => void;
  /**
   * Hand over the element the stream plays on, and null when it goes. The
   * player plays it inside the viewer's taps, which is what lets a browser that
   * refuses to play without one (WebKit, Low Power Mode) play it at all, and it
   * plays and pauses it with the story.
   */
  onMediaElement: (element: HTMLVideoElement | null) => void;
}

export interface ExperiencePlayerAccess {
  canAccess: (requirement: ExperienceAccessRequirement) => boolean;
  /** Refresh durable entitlements before showing a purchase prompt. Never debits. */
  checkAccess?: (requirement: ExperienceAccessRequirement) => Promise<boolean>;
  requestAccess: (requirement: ExperienceAccessRequirement) => Promise<boolean>;
  formatPrice: (amount: number) => string;
  /** Private authoring hosts may extract a frame from media they can already read. */
  renderPreview?: (media: { videoUri?: string; posterUri?: string }) => ReactNode;
}

export interface ExperienceAccessCheckpoint {
  state: ExperienceRuntimeState;
  events: ExperienceRuntimeEvent[];
  playback?: ExperiencePlaybackCheckpoint;
  journey?: ExperienceJourney;
}

export interface ExperiencePlayerProps {
  /** Where a host returning from a purchase resumes. The first run only. */
  accessCheckpoint?: ExperienceAccessCheckpoint;
  /**
   * Private authoring hosts only: every run — the first, and every restart —
   * starts at this scene instead of the story's entry. It must name a scene of
   * the runtime. A purchase being resumed (`accessCheckpoint`) still wins on
   * the first run.
   */
  startSceneId?: string;
  onAccessCheckpoint?: (checkpoint: ExperienceAccessCheckpoint) => void;
  access?: ExperiencePlayerAccess;
  /** Only private authoring hosts may bypass payment for playtests. */
  previewAccess?: boolean;
  runtime: unknown;
  locale: string;
  copy: ExperiencePlayerCopy;
  coverUrl?: string;
  randomSeed?: string;
  frameProfile?: ExperiencePlayerFrameProfile;
  loadTheme?: ExperienceThemeLoader;
  renderWorldModel?: (props: ExperienceWorldModelRendererProps) => ReactNode;
  /** Authoring hosts may observe session state without changing playback. */
  onStateChange?: (state: ExperienceRuntimeState) => void;
  /** A consistent engine/presentation checkpoint, emitted only after Start. */
  onCheckpoint?: (
    checkpoint: ExperienceAccessCheckpoint,
    reason: ExperienceCheckpointReason
  ) => void;
  /** Host save feedback is arranged below the corner controls, including in fullscreen. */
  playbackStatus?: ReactNode;
  /** Keep the instance stable: the runtime is created with it, so a new one starts a new run. */
  playSessionReporter?: PlaySessionReporter;
  endingExtra?: (sessionId: string | null) => ReactNode;
  /**
   * Negotiate `/playback` for build clips and play HLS when the server offers
   * it. Enable only where the server transcodes (web on the cn cell). Read once
   * per mounted player.
   */
  adaptivePlayback?: boolean;
}

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
  access,
  previewAccess = false,
  accessCheckpoint,
  startSceneId,
  onAccessCheckpoint,
  onStateChange,
  onCheckpoint,
  playbackStatus,
  playSessionReporter,
  endingExtra,
  adaptivePlayback,
}: ExperiencePlayerProps) {
  const sessionReporter = usePlaySessionReporter(playSessionReporter);
  // Outlives "play again" (the runtime below is re-keyed per run), so a replay
  // starts from the answers and warmed openings the first run already has.
  const [delivery] = useState(
    () => new ExperiencePlaybackDelivery({ adaptive: adaptivePlayback === true })
  );
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
      // Where this run starts: the purchase it comes back from, on the first
      // run only; otherwise the authoring host's chosen scene, on every run.
      const entryCheckpoint =
        restartEpoch === 0 && accessCheckpoint
          ? accessCheckpoint
          : startSceneId
            ? sceneEntryCheckpoint(parsed.data, startSceneId, randomSeed)
            : undefined;
      if (entryCheckpoint?.playback) {
        validateExperiencePlaybackCheckpoint(
          parsed.data,
          entryCheckpoint.state.currentSceneId,
          entryCheckpoint.playback
        );
      }
      if (entryCheckpoint?.journey) validateExperienceJourney(parsed.data, entryCheckpoint.journey);
      return {
        ok: true as const,
        manifest: parsed.data,
        entryCheckpoint,
        controller: createExperienceRuntime(parsed.data, {
          rendererAdapters: EXPERIENCE_CORE_RENDERER_ADAPTERS,
          randomSeed,
          canAccess: access?.canAccess,
          previewAccess,
          restore: entryCheckpoint?.state,
          playSessionReporter: sessionReporter,
        }),
      };
    } catch (error) {
      return {
        ok: false as const,
        issues: [{ path: [], message: runtimeErrorMessage(error) }],
      };
    }
  }, [
    access,
    accessCheckpoint,
    previewAccess,
    randomSeed,
    restartEpoch,
    runtime,
    sessionReporter,
    startSceneId,
  ]);

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
    <ExperiencePlaybackDeliveryContext.Provider value={delivery}>
      <ActiveExperienceRuntimePlayer
        key={`${prepared.manifest.buildId}:${randomSeed}:${restartEpoch}`}
        access={access}
        previewAccess={previewAccess}
        entryCheckpoint={prepared.entryCheckpoint}
        onAccessCheckpoint={onAccessCheckpoint}
        onStateChange={onStateChange}
        onCheckpoint={onCheckpoint}
        playbackStatus={playbackStatus}
        manifest={prepared.manifest}
        controller={prepared.controller}
        delivery={delivery}
        locale={locale}
        copy={copy}
        coverUrl={coverUrl}
        frameProfile={frameProfile}
        loadTheme={loadTheme}
        renderWorldModel={renderWorldModel}
        endingExtra={endingExtra}
        onRestart={() => {
          setRandomSeed(globalThis.crypto.randomUUID());
          setRestartEpoch((value) => value + 1);
        }}
      />
    </ExperiencePlaybackDeliveryContext.Provider>
  );
}

function ActiveExperienceRuntimePlayer({
  manifest,
  controller,
  delivery,
  locale,
  copy,
  coverUrl,
  frameProfile,
  loadTheme,
  renderWorldModel,
  onRestart,
  access,
  previewAccess,
  entryCheckpoint,
  onAccessCheckpoint,
  onStateChange,
  onCheckpoint,
  playbackStatus,
  endingExtra,
}: {
  /** Where the run enters, in place of the story's entry: its state is already restored. */
  entryCheckpoint?: ExperienceAccessCheckpoint;
  onAccessCheckpoint?: (checkpoint: ExperienceAccessCheckpoint) => void;
  onStateChange?: (state: ExperienceRuntimeState) => void;
  onCheckpoint?: (
    checkpoint: ExperienceAccessCheckpoint,
    reason: ExperienceCheckpointReason
  ) => void;
  playbackStatus?: ReactNode;
  endingExtra?: (sessionId: string | null) => ReactNode;
  access?: ExperiencePlayerAccess;
  previewAccess: boolean;
  manifest: ExperienceRuntimeManifest;
  controller: ExperienceRuntimeController;
  delivery: ExperiencePlaybackDelivery;
  locale: string;
  copy: ExperiencePlayerCopy;
  coverUrl?: string;
  frameProfile: ExperiencePlayerFrameProfile;
  loadTheme: ExperienceThemeLoader;
  renderWorldModel?: (props: ExperienceWorldModelRendererProps) => ReactNode;
  onRestart: () => void;
}) {
  const completedPlaySessionId = useSyncExternalStore(
    controller.subscribePlaySessionReport,
    controller.getCompletedPlaySessionId,
    controller.getCompletedPlaySessionId
  );
  const reportError = useSyncExternalStore(
    controller.subscribePlaySessionReport,
    controller.getPlaySessionReportError,
    controller.getPlaySessionReportError
  );
  const [runtimeState, setRuntimeState] = useState(() => controller.state());
  const [initialJourney] = useState(() =>
    entryCheckpoint?.journey
      ? validateExperienceJourney(manifest, entryCheckpoint.journey)
      : createExperienceJourney(manifest)
  );
  const journeyRef = useRef(initialJourney);
  const [journeyForMap, setJourneyForMap] = useState(initialJourney);
  const [journeyMapOpen, setJourneyMapOpen] = useState(false);
  const journeyMapOpenRef = useRef(false);
  const journeyWasPlayingRef = useRef(false);
  const journeyMapCornerButtonRef = useRef<HTMLButtonElement | null>(null);
  const journeyMapTransportButtonRef = useRef<HTMLButtonElement | null>(null);
  const journeyMapOriginRef = useRef<"corner" | "transport">("corner");
  const restoreJourneyFocusRef = useRef(false);
  useLayoutEffect(() => {
    if (!journeyMapOpen && restoreJourneyFocusRef.current) {
      restoreJourneyFocusRef.current = false;
      const origin =
        journeyMapOriginRef.current === "transport"
          ? journeyMapTransportButtonRef.current
          : journeyMapCornerButtonRef.current;
      (origin ?? journeyMapCornerButtonRef.current)?.focus({ preventScroll: true });
    }
  });
  const [journeyReplayPending, setJourneyReplayPending] = useState(false);
  const journeyReplayPendingRef = useRef(false);
  const [journeyReplayError, setJourneyReplayError] = useState<string | null>(null);
  const [journeyMapSuspended, setJourneyMapSuspended] = useState(false);
  useEffect(() => {
    onStateChange?.(runtimeState);
  }, [onStateChange, runtimeState]);
  const [initialPlayback] = useState(() => entryCheckpoint?.playback);
  const [restoredPresentation, setRestoredPresentation] = useState(() => ({
    epoch: 0,
    playback: initialPlayback,
  }));
  const [openRendererIds, setOpenRendererIds] = useState<ReadonlySet<string>>(
    () => new Set(initialPlayback?.openRendererIds)
  );
  const openRendererIdsRef = useRef(openRendererIds);
  const settledGestureIdsRef = useRef<string[]>(initialPlayback?.settledGestureIds ?? []);
  const [settledGestureIds, setSettledGestureIds] = useState(settledGestureIdsRef.current);
  const mediaCheckpointsRef = useRef(
    new Map(initialPlayback?.media.map((media) => [media.rendererInstanceId, media]))
  );
  const [mediaProgress, setMediaProgress] = useState<ExperienceMediaCheckpoint | null>(
    initialPlayback?.media[0] ?? null
  );
  const [playbackRate, setPlaybackRate] = useState<ExperiencePlaybackRate>(
    initialPlayback?.rate ?? 1
  );
  const playbackRateRef = useRef(playbackRate);
  const effectivePlaybackRateRef = useRef<number>(playbackRate);
  const pendingCheckpointEventsRef = useRef(entryCheckpoint?.events ?? []);
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [sceneTimeMs, setSceneTimeMs] = useState(initialPlayback?.sceneTimeMs ?? 0);
  const scenePositionRef = useRef(sceneTimeMs);
  const [decodedContentSize, setDecodedContentSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [theme, setTheme] = useState<ExperienceThemeConfig | null>(null);
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false);
  const onCheckpointRef = useRef(onCheckpoint);
  onCheckpointRef.current = onCheckpoint;
  const [starting, setStarting] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const accessPendingRef = useRef(false);
  const [accessPending, setAccessPending] = useState(false);
  const [retryAccess, setRetryAccess] = useState<(() => void) | null>(null);
  const [nodeGate, setNodeGate] = useState<ExperienceGraphNode | null>(null);
  const aliveRef = useRef(true);
  useLayoutEffect(() => {
    // StrictMode replays child passive registrations before parent passive
    // effects. Publish ownership during layout so ready handles are accepted.
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  // Playback always asks for sound. This flips only when a browser actually
  // refuses audible playback, and it stays flipped for the rest of the session
  // so later clips do not each re-run the same rejected attempt. Turning sound
  // on is the user's call, never a decision read off the media's metadata.
  const [soundBlocked, setSoundBlocked] = useState(false);
  const timelineCursorRef = useRef<ExperienceTimelineCursor>(
    initialPlayback?.cursor ?? createExperienceTimelineCursor(runtimeState.currentSceneId)
  );
  // Gesture outcomes parked until the scene clock reaches their safe branch
  // frame. Branch routing must not cut mid-pose: the interaction resolves the
  // instant the input lands, but the cut waits for `branchAtMs` so the outgoing
  // clip plays its resolve beat first. Cleared when the scene changes — parked
  // events belong to the scene that emitted them.
  const parkedGestureEventsRef = useRef<ExperienceRuntimeEvent[]>(
    initialPlayback?.parkedEvents ?? []
  );
  const playbackHandlesRef = useRef(new Map<string, ExperienceMediaPlaybackHandle>());
  const playbackHandleEpochsRef = useRef(new Map<string, number>());
  // The renderers whose media is on an element and playable — the render-time
  // mirror of `playbackHandlesRef`, which is what lets Start wait for the entry
  // clip instead of pressing play on nothing.
  const [stagedHandleIds, setStagedHandleIds] = useState<ReadonlySet<string>>(() => new Set());
  const playbackEnabledRef = useRef(initialPlayback?.playbackEnabled ?? false);
  const fixedClockEndedRef = useRef(initialPlayback?.fixedClockEnded ?? false);
  // True while a timeline-control press-hold window is open, unresolved, and
  // not held — the host must keep the scene media paused so playback position
  // equals charge progress. Lifted from the spatial layer, which owns press
  // state.
  const [timelineHoldGate, setTimelineHoldGate] = useState(false);
  // The viewer's pause: a state of its own, combined with the gates around it,
  // never worked out from them. The ref holds the same value as of now, for
  // code that runs between renders.
  const [viewerPause, setViewerPause] = useState<ExperienceViewerPauseReason | null>(null);
  const viewerPauseRef = useRef<ExperienceViewerPauseReason | null>(null);
  // The resume, for listeners added once (the OS media controls); it changes
  // with the sound and the presentation it restores.
  const resumeStoryRef = useRef<(source: "gesture" | "system") => void>(() => undefined);
  // Focus a pause takes from the story — the story layer turns inert — and the
  // resume gives back; the paused frame a refusal moves focus to; and whether
  // that frame had focus as the resume took it away, which the toggle takes
  // over when there is nothing to give back.
  const storyLayerRef = useRef<HTMLDivElement | null>(null);
  const focusBeforePauseRef = useRef<HTMLElement | null>(null);
  const pausedFrameRef = useRef<HTMLButtonElement | null>(null);
  const pausedFrameFocusedRef = useRef(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  // Story time for everything that moves the story without media (see
  // ExperienceStoryClock). It stands still whenever the story is held — before
  // Start, through a pause or an access flow, after the end — so nothing
  // scheduled behind the title card spends time the viewer never saw.
  const [storyClock] = useState(() => new ExperienceStoryClock({ paused: true }));
  const playbackLocale = resolvePlaybackLocale(manifest, locale);
  const {
    unlock: unlockAudio,
    suspend: suspendAudio,
    applyEffects: applyAudioEffects,
    checkpoint: checkpointAudio,
    restore: restoreAudio,
  } = useExperienceAudioHost(manifest, playbackLocale, setRuntimeError);
  const buildCheckpoint = useCallback(
    (events = pendingCheckpointEventsRef.current): ExperienceAccessCheckpoint => {
      const state = controller.state();
      const node = findGraphNode(manifest, state.currentSceneId);
      const audio = checkpointAudio();
      const playback: ExperiencePlaybackCheckpoint | undefined =
        node?.kind === "scene"
          ? {
              version: 1,
              sceneId: node.sceneId,
              sceneSignature: scenePlaybackSignature(node),
              sceneTimeMs: scenePositionRef.current,
              fixedClockEnded: fixedClockEndedRef.current,
              cursor: structuredClone(timelineCursorRef.current),
              openRendererIds: [...openRendererIdsRef.current],
              settledGestureIds: [...settledGestureIdsRef.current],
              parkedEvents: structuredClone(parkedGestureEventsRef.current),
              media: structuredClone([...mediaCheckpointsRef.current.values()]),
              playbackEnabled: playbackEnabledRef.current,
              rate: playbackRateRef.current,
              ...(audio ? { audio } : {}),
            }
          : undefined;
      return {
        state,
        events: structuredClone(events),
        ...(playback ? { playback } : {}),
        journey: journeyRef.current,
      };
    },
    [controller, manifest, checkpointAudio]
  );
  const buildCheckpointRef = useRef(buildCheckpoint);
  buildCheckpointRef.current = buildCheckpoint;
  const lastProgressPublishedRef = useRef(0);
  const checkpointQueuedRef = useRef<ExperienceCheckpointReason | null>(null);
  const publishCheckpoint = useCallback((reason: ExperienceCheckpointReason) => {
    if (!startedRef.current || !onCheckpointRef.current) return;
    if (reason === "progress" && performance.now() - lastProgressPublishedRef.current < 250) return;
    if (checkpointQueuedRef.current) {
      if (reason !== "progress") checkpointQueuedRef.current = reason;
      return;
    }
    checkpointQueuedRef.current = reason;
    queueMicrotask(() => {
      const queued = checkpointQueuedRef.current;
      checkpointQueuedRef.current = null;
      if (!queued || !aliveRef.current || !startedRef.current) return;
      lastProgressPublishedRef.current = performance.now();
      onCheckpointRef.current?.(buildCheckpointRef.current(), queued);
    });
  }, []);
  // What holds playback, decided once per render by one rule. Code between
  // renders decides with the same rule, from the gates of the last commit and
  // the two that change ahead of a render — the viewer pause and the access
  // check — read from their refs.
  const playbackGates: ExperiencePlaybackGates = {
    started,
    ended: Boolean(runtimeState.completedEndingId),
    failed: runtimeError !== null,
    viewerPause,
    accessPending,
    retryAccess: retryAccess !== null,
    nodeGate: nodeGate !== null,
    chargeGate: timelineHoldGate,
    journeyMap: journeyMapOpen,
  };
  const holds = resolveExperiencePlaybackHolds(playbackGates);
  const committedGatesRef = useRef(playbackGates);
  useLayoutEffect(() => {
    committedGatesRef.current = playbackGates;
  });
  const holdsNow = useCallback(
    () =>
      resolveExperiencePlaybackHolds({
        ...committedGatesRef.current,
        viewerPause: viewerPauseRef.current,
        accessPending: accessPendingRef.current,
        journeyMap: journeyMapOpenRef.current,
      }),
    []
  );
  // Counts scene entries, so an outcome held through a pause can tell whether
  // the scene it belongs to is still the one on stage.
  const sceneEntryRef = useRef(0);
  const orientation = usePlaybackOrientation(manifest, frameProfile);
  const canAccess = useCallback(
    (requirement: ExperienceAccessRequirement) =>
      previewAccess || Boolean(access?.canAccess(requirement)),
    [access, previewAccess]
  );
  const shellRef = useRef<HTMLDivElement | null>(null);
  const {
    phone,
    portrait,
    locked: landscapeLocked,
    fullscreen,
    enter: enterLandscape,
    exit: exitLandscape,
  } = useLandscapePresentation();
  // The cover is the only art that exists before any clip has played, so it is
  // what the loading and title screen should stand on — otherwise the viewer
  // waits on a black rectangle. Absent cover simply falls back to that.
  const coverUri =
    coverUrl ??
    (manifest.metadata.coverAssetId
      ? resolveImageUri(manifest.assets, manifest.metadata.coverAssetId, orientation)
      : undefined);
  const experienceProfile = manifest.metadata.experienceProfile ?? "cinematic";

  // Pauses the story for the viewer (see nextExperienceViewerPause for which
  // reason wins). Everything it holds is held here, synchronously, ahead of the
  // render: the timers freeze and input in progress is dropped now, before the
  // story layer turns inert, and the clips stop on this frame. The hold effects
  // below then find nothing left to do.
  const pauseStory = useCallback(
    (reason: ExperienceViewerPauseReason) => {
      const current = viewerPauseRef.current;
      const next = nextExperienceViewerPause(current, { type: "pause", reason }, holdsNow());
      if (next === current) return;
      // Taken before the story layer turns inert, which drops it. A refusal
      // that replaces a pause keeps what the first pause took.
      if (current === null) focusBeforePauseRef.current = focusedWithin(storyLayerRef.current);
      viewerPauseRef.current = next;
      storyClock.pause();
      playbackHandlesRef.current.forEach((handle) => handle.pause());
      void suspendAudio().catch((error: unknown) => setRuntimeError(runtimeErrorMessage(error)));
      debugTrace(`pause ${next}`);
      setViewerPause(next);
      publishCheckpoint("pause");
    },
    [holdsNow, storyClock, suspendAudio, publishCheckpoint]
  );

  // Web Audio refuses to start without a tap the way media does, and that is
  // the same pause, not a failure. Anything else is shown verbatim.
  const reportAudioError = useCallback(
    (error: unknown) => {
      if (isAutoplayPolicyRefusal(error)) pauseStory("refused");
      else setRuntimeError(runtimeErrorMessage(error));
    },
    [pauseStory]
  );
  const refusePlayback = useCallback(() => pauseStory("refused"), [pauseStory]);

  // Whether code running between renders may start media now: the story asked
  // for playback and nothing holds it.
  const mayPlayNow = useCallback(
    () => playbackEnabledRef.current && !holdsNow().mediaHeld,
    [holdsNow]
  );

  // The one place a play the player starts is made and classified: on
  // registration, on the story's `play` command, and whenever a hold lifts —
  // Start included. A refusal pauses the story for a tap; only a real failure
  // stops the clip and tells the viewer.
  const playHandle = useCallback(
    (instanceId: string, handle: ExperienceMediaPlaybackHandle) => {
      void handle.play().catch((error: unknown) => {
        // The reasoning and the ordering live with the verdict, next to its tests.
        const verdict = resolveExperiencePlaybackRejection(
          playbackHandlesRef.current.get(instanceId),
          handle,
          error
        );
        debugTrace(`play ${instanceId} ${verdict}`);
        if (verdict === "stale-handle" || verdict === "routine-interruption") return;
        if (verdict === "refused") {
          pauseStory("refused");
          return;
        }
        handle.pause();
        // Web Audio follows through the failure's hold.
        setRuntimeError(runtimeErrorMessage(error));
      });
    },
    [pauseStory]
  );

  const applyResult = useCallback(
    (result: ExperienceEventQueueResult) => {
      setRuntimeState(result.state);
      pendingCheckpointEventsRef.current = [];
      applyAudioEffects(result.effects);
      // The story is over: there is nothing to resume, and Web Audio — which a
      // pause holds — has the ending's cues to play.
      if (result.state.completedEndingId && viewerPauseRef.current !== null) {
        viewerPauseRef.current = null;
        setViewerPause(null);
      }
      result.effects.forEach((effect) => {
        if (effect.kind === "scene.changed") {
          playbackEnabledRef.current = true;
          return;
        }
        if (effect.kind !== "renderer.command") return;
        const handle = playbackHandlesRef.current.get(effect.instanceId);
        if (effect.commandType === "play") {
          playbackEnabledRef.current = true;
          if (handle && mayPlayNow()) playHandle(effect.instanceId, handle);
          return;
        }
        if (effect.commandType === "pause") {
          playbackEnabledRef.current = false;
          handle?.pause();
          return;
        }
        if (handle && effect.commandType === "seek") {
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
      {
        let next = new Set(openRendererIdsRef.current);
        result.effects.forEach((effect) => {
          if (effect.kind === "scene.changed") {
            next = new Set();
          }
          if (effect.kind === "renderer.command" && effect.commandType === "open") {
            next.add(effect.instanceId);
          }
          if (effect.kind === "renderer.command" && effect.commandType === "close")
            next.delete(effect.instanceId);
        });
        openRendererIdsRef.current = next;
        setOpenRendererIds(next);
      }
      // Scene resets must NOT depend on state-updater side effects: React 18
      // defers `setState(updater)` evaluation to render time when the batch
      // already holds an update, so counters bumped inside the updater read
      // as zero here. A missed reset left the incoming scene holding the
      // outgoing scene's final clock, resolving interaction windows that
      // never opened (the charge scene skipping straight to its fail branch).
      if (sceneChangeEffects.length > 0) {
        setSceneEpoch((value) => value + sceneChangeEffects.length);
        sceneEntryRef.current += sceneChangeEffects.length;
        setSceneTimeMs(0);
        scenePositionRef.current = 0;
        fixedClockEndedRef.current = false;
        settledGestureIdsRef.current = [];
        setSettledGestureIds([]);
        mediaCheckpointsRef.current.clear();
        setMediaProgress(null);
        parkedGestureEventsRef.current = [];
        timelineCursorRef.current = createExperienceTimelineCursor(
          latestSceneId ?? result.state.currentSceneId
        );
        debugTrace(`scene -> ${latestSceneId ?? result.state.currentSceneId}`);
      }
      const enteredNode = findGraphNode(manifest, result.state.currentSceneId);
      const freshEntry = sceneChangeEffects.length > 0 || (!startedRef.current && !entryCheckpoint);
      const anchor =
        freshEntry &&
        enteredNode?.kind === "scene" &&
        enteredNode.renderers.length > 0 &&
        !result.state.completedEndingId
          ? createExperienceJourneyAnchor(manifest, buildCheckpointRef.current())
          : undefined;
      journeyRef.current = recordExperienceJourney(manifest, journeyRef.current, {
        sceneId: result.state.currentSceneId,
        effects: result.effects,
        ...(anchor ? { anchor } : {}),
      });
      publishCheckpoint("transition");
    },
    [applyAudioEffects, mayPlayNow, playHandle, publishCheckpoint, manifest, entryCheckpoint]
  );

  const run = useCallback(
    async (operation: () => ExperienceEventQueueResult, cancellable = false) => {
      if (accessPendingRef.current) return false;
      const attempt = async (): Promise<boolean> => {
        try {
          applyResult(operation());
          setRetryAccess(null);
          return true;
        } catch (error) {
          if (error instanceof ExperienceAccessRequiredError && access) {
            accessPendingRef.current = true;
            setAccessPending(true);
            playbackHandlesRef.current.forEach((handle) => handle.pause());
            pendingCheckpointEventsRef.current = error.events;
            onAccessCheckpoint?.(buildCheckpointRef.current(error.events));
            publishCheckpoint("access");
            try {
              await suspendAudio();
              const alreadyOwned = access.checkAccess
                ? await access.checkAccess(error.requirement)
                : access.canAccess(error.requirement);
              if (!aliveRef.current) return false;
              let allowed = alreadyOwned;
              if (!alreadyOwned) {
                const lockedNode = manifest.graph.nodes.find(
                  (node) => node.access?.key === error.requirement.key
                );
                // The player owns the protected first-frame backdrop; the host
                // owns one confirmation with price, balance and failure handling.
                setNodeGate(lockedNode ?? null);
                // That confirmation renders outside the player, and a fullscreen
                // player hides everything outside it — give the screen back first.
                exitLandscape();
                allowed = await access.requestAccess(error.requirement);
              }
              if (!aliveRef.current) return false;
              if (allowed) {
                if (!access.canAccess(error.requirement))
                  throw new Error("The unlock could not be verified.");
                setNodeGate(null);
                return await attempt();
              }
              if (!cancellable)
                setRetryAccess(() => () => {
                  if (accessPendingRef.current) return;
                  setRuntimeError(null);
                  void attempt();
                });
              return false;
            } catch (failure) {
              if (aliveRef.current) {
                setRuntimeError(runtimeErrorMessage(failure));
                if (!cancellable)
                  setRetryAccess(() => () => {
                    if (accessPendingRef.current) return;
                    setRuntimeError(null);
                    void attempt();
                  });
              }
              return false;
            } finally {
              if (aliveRef.current) {
                accessPendingRef.current = false;
                setAccessPending(false);
                setNodeGate(null);
              }
            }
          }
          if (isDiscardableLateInput(error)) return false;
          setRuntimeError(runtimeErrorMessage(error));
          return false;
        }
      };
      return attempt();
    },
    [
      access,
      applyResult,
      exitLandscape,
      manifest,
      onAccessCheckpoint,
      suspendAudio,
      publishCheckpoint,
    ]
  );

  useEffect(() => {
    const abortController = new AbortController();
    void Promise.resolve()
      .then(() => {
        abortController.signal.throwIfAborted();
        return loadTheme(manifest, abortController.signal);
      })
      .then((loadedTheme) => {
        if (!abortController.signal.aborted) setTheme(loadedTheme);
      })
      .catch((error: unknown) => {
        if (!abortController.signal.aborted) setRuntimeError(runtimeErrorMessage(error));
      });
    return () => abortController.abort();
  }, [loadTheme, manifest]);

  const currentNode = findGraphNode(manifest, runtimeState.currentSceneId);
  const entryRequirements = [
    ...getExperienceJourneyActiveAccess(manifest, journeyRef.current),
    ...(currentNode?.access ? [currentNode.access] : []),
  ];
  const entryLocked =
    !previewAccess && entryRequirements.some((requirement) => !access?.canAccess(requirement));
  const scene = !entryLocked && currentNode?.kind === "scene" ? currentNode : null;
  const interactionActive =
    Boolean(
      scene?.gestures.some(
        (gesture) =>
          !settledGestureIds.includes(gesture.gestureId) &&
          isExperienceGestureAvailable(gesture, runtimeState, sceneTimeMs)
      )
    ) ||
    parkedGestureEventsRef.current.length > 0 ||
    timelineHoldGate;
  const approachingInteraction = Boolean(
    scene?.gestures.some(
      (gesture) =>
        !settledGestureIds.includes(gesture.gestureId) &&
        gesture.activeWindow &&
        gesture.activeWindow.startMs <= sceneTimeMs + 1_000 &&
        gesture.activeWindow.endMs >= sceneTimeMs
    )
  );
  // Interactive input keeps its authored duration, even if footage was accelerated.
  const effectivePlaybackRate = interactionActive || approachingInteraction ? 1 : playbackRate;
  effectivePlaybackRateRef.current = effectivePlaybackRate;
  useLayoutEffect(() => {
    storyClock.setRate(effectivePlaybackRate);
    playbackHandlesRef.current.forEach((handle) => handle.setPlaybackRate(effectivePlaybackRate));
  }, [effectivePlaybackRate, storyClock]);
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
  const hasWorldModelRenderer = rendererSlots.some(
    ({ renderer }) => renderer.rendererId === EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID
  );
  const hasTextRenderer = rendererSlots.some(
    ({ renderer }) => renderer.rendererId === EXPERIENCE_CORE_TEXT_RENDERER_ID
  );
  const transportAvailable = Boolean(
    holds.pauseUi &&
    mediaProgress &&
    !hasWorldModelRenderer &&
    !interactionActive &&
    playbackEnabledRef.current &&
    (!mediaProgress.terminalMode || mediaProgress.isStill) &&
    !mediaProgress.completed
  );
  const transportChrome = useExperienceTransportVisibility({
    available: transportAvailable,
    paused: viewerPause !== null,
  });
  const consumeTransportWakeTap = transportChrome.consumeWakeTap;
  // What the frame's controls offer. The toggle shows wherever the scene has
  // time to stop — footage, a fixed clock, a world stream, sound — and while
  // the story is paused; a silent text or decision beat has nothing to pause.
  // Space toggles the film wherever the toggle shows, save over a world stream,
  // which takes Space for a move of its own. A text scene keeps Space for its
  // own scrolling while it has focus, which it takes as it opens, so the toggle
  // does not offer Space as its shortcut there.
  const sceneHasTime =
    hasVideoRenderer ||
    scene?.clock.kind === "fixed" ||
    hasWorldModelRenderer ||
    Boolean(manifest.audio);
  const toggleVisible = viewerPause !== null || sceneHasTime;
  const spaceToggles = holds.pauseUi && toggleVisible && !hasWorldModelRenderer;
  const sceneHasTimeRef = useRef(sceneHasTime);
  useLayoutEffect(() => {
    sceneHasTimeRef.current = sceneHasTime;
  });
  // A page put away — a tab switched, the phone locked, the app left — pauses
  // a film that has time to lose, and coming back leaves it paused: the viewer
  // resumes it. A silent beat loses nothing and is left as it is.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && sceneHasTimeRef.current) pauseStory("hidden");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [pauseStory]);
  // Nor does a scene with time open behind a page already put away and play
  // there: Start settles after its tap, and a purchase made at a beat with
  // nothing to lose settles after the page may have gone. Checked as each scene
  // opens, before any of its clips is offered to play.
  useLayoutEffect(() => {
    if (started && sceneHasTime && document.visibilityState === "hidden") pauseStory("hidden");
  }, [pauseStory, sceneEpoch, sceneHasTime, started]);
  // Start plays the entry clip inside the click, so it waits until that clip is
  // on an element. Before then Start would press play on nothing — and the
  // negotiation and buffering this covers are exactly the wait it shows.
  const entryMediaPending =
    !started &&
    rendererSlots.some(({ renderer }) => {
      const saved =
        sceneEpoch === 0
          ? initialPlayback?.media.find((media) => media.rendererInstanceId === renderer.instanceId)
          : undefined;
      if (saved?.terminalMode?.kind === "held" || saved?.completed) return false;
      return playsMediaOnStart(renderer) && !stagedHandleIds.has(renderer.instanceId);
    });
  // A landscape film is turned for a phone: by the browser where it lets the
  // player take the screen, otherwise by drawing the frame sideways while the
  // phone is upright. Reading scenes keep their responsive stage either way.
  const landscapeFilm = experienceProfile === "cinematic" && orientation === "landscape";
  const frameRotated = shouldRotateFrame({
    landscapeFilm: stageProfile === "cinematic" && orientation === "landscape",
    phone,
    portrait,
    locked: landscapeLocked,
  });
  useEffect(() => {
    if (endingId) exitLandscape();
  }, [endingId, exitLandscape]);
  useMediaLookAhead({
    manifest,
    sceneId: runtimeState.currentSceneId,
    orientation,
    canAccess,
    delivery,
    // Nothing warms behind the title card: the entry clip buffers on its own
    // element, and the bandwidth belongs to it until the viewer commits.
    enabled: started && !endingId && !runtimeError,
  });

  const emitOutcome = useCallback(
    (
      instanceId: string,
      outcomeType: string,
      payload: Record<string, never> | { choiceId: string }
    ) => {
      const dispatch = () =>
        void run(
          () => controller.emitRendererOutcome({ instanceId, outcomeType, payload }),
          outcomeType === "choice-selected"
        );
      if (viewerPauseRef.current === null) {
        dispatch();
        return;
      }
      // A renderer can still finish while the viewer has the story paused: an
      // `ended` its element had already queued, a world session closing. The
      // outcome waits on the story clock, so the story moves on when the viewer
      // resumes — not behind the pause, into an ending or a paywall that would
      // take the screen. One whose scene was left meanwhile is dropped.
      const entry = sceneEntryRef.current;
      storyClock.setTimeout(() => {
        if (aliveRef.current && sceneEntryRef.current === entry) dispatch();
      }, 0);
    },
    [controller, run, storyClock]
  );

  const advanceTimeline = useCallback(
    (rendererInstanceId: string | null, positionMs: number) => {
      if (!startedRef.current) return;
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
      scenePositionRef.current = positionMs;
      if (shouldAdvancePlaybackTimeline(timelineCursorRef.current, positionMs)) {
        const advanced = advanceExperienceTimeline(
          activeNode,
          timelineCursorRef.current,
          positionMs
        );
        timelineCursorRef.current = advanced.cursor;
        if (advanced.events.length > 0) run(() => controller.dispatch(advanced.events));
      }
      flushParkedGestureEvents(positionMs);
      publishCheckpoint("progress");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, manifest, run, publishCheckpoint]
  );

  /** Releases parked gesture outcomes whose safe branch frame has arrived. */
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

  // The holds, brought to their steady state. Three effects: story time, Web
  // Audio, and the clips. A pause and a resume do the same work earlier and
  // synchronously, so running these again changes nothing.
  useLayoutEffect(() => {
    if (holds.storyHeld) storyClock.pause();
    else storyClock.resume();
  }, [holds.storyHeld, storyClock]);

  // A `fixed` scene clock is the only clock the experience itself owns. A
  // `renderer` clock is driven by its media's currentTime, and `none` never
  // advances — so a scene that must last a known duration without any media to
  // time it (a placeholder for footage that is not attached yet, a text beat)
  // has nothing to move it along until this runs.
  //
  // Position is fed through the same `advanceTimeline` the media path uses, so
  // timeline cues fire identically whether the clock came from a video or from
  // here. `scene.clock-ended` is emitted exactly once per scene entry. The
  // origin belongs to the entry, not to the effect: an effect that runs again
  // mid-scene carries on from the clock's position instead of restarting it.
  const clockScene = scene?.clock.kind === "fixed" ? scene : null;
  const clockDurationMs = clockScene?.clock.kind === "fixed" ? clockScene.clock.durationMs : null;
  const fixedClockEntryRef = useRef<{ key: string; origin: number; ended: boolean } | null>(null);
  useEffect(() => {
    if (!clockScene || clockDurationMs === null || !started) return;
    const key = `${clockScene.sceneId}:${sceneEpoch}`;
    const entry =
      fixedClockEntryRef.current?.key === key
        ? fixedClockEntryRef.current
        : {
            key,
            origin: storyClock.now() - scenePositionRef.current,
            ended: fixedClockEndedRef.current,
          };
    fixedClockEntryRef.current = entry;
    let frame = 0;
    const tick = (storyNow: number) => {
      const elapsed = Math.min(storyNow - entry.origin, clockDurationMs);
      advanceTimeline(null, elapsed);
      if (elapsed < clockDurationMs) {
        frame = storyClock.requestFrame(tick);
        return;
      }
      if (entry.ended) return;
      entry.ended = true;
      fixedClockEndedRef.current = true;
      emitRuntimeEvents([{ type: "scene.clock-ended", sourceId: clockScene.sceneId }]);
    };
    frame = storyClock.requestFrame(tick);
    return () => storyClock.cancelFrame(frame);
  }, [
    advanceTimeline,
    clockDurationMs,
    clockScene,
    emitRuntimeEvents,
    sceneEpoch,
    started,
    storyClock,
  ]);

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

  // Web Audio follows its hold. This is also what resumes it after an access
  // flow, which suspends it for the dialog.
  useEffect(() => {
    if (!started) return;
    void (holds.audioHeld ? suspendAudio() : unlockAudio()).catch(reportAudioError);
  }, [holds.audioHeld, reportAudioError, started, suspendAudio, unlockAudio]);

  // The clips follow theirs. Among what holds them is the timeline-control
  // charge: while a press-hold window is open, unresolved, and not held, the
  // media must not advance — playback position is the charge progress. When
  // a hold lifts (a press, a resolution, an idle timeout, the end of an access
  // flow, Start), every clip that has not ended plays through `playHandle`, so
  // a refusal there pauses the story like any other. A clip that has ended is
  // left alone: playing it again would start it over — the clip under a
  // declined paid choice, replayed. Film scenes carry exactly one
  // clock-driving video, so gating every registered handle is equivalent to
  // gating the clock. Decided by the holds as of now, which a pause made in
  // this commit's layout effects (a scene opening behind a hidden page) is
  // already part of.
  useEffect(() => {
    if (!started) return;
    if (holdsNow().mediaHeld) {
      playbackHandlesRef.current.forEach((handle) => handle.pause());
      return;
    }
    // The story's own `pause` command still wins.
    if (!playbackEnabledRef.current) return;
    playbackHandlesRef.current.forEach((handle, instanceId) => {
      if (!handle.ended()) playHandle(instanceId, handle);
    });
  }, [holds.mediaHeld, holdsNow, playHandle, started]);

  // The OS media controls — the lock screen, headphones, Control Center — play
  // and pause the story, never just the clip under it, and cannot seek it. Each
  // Vidstack player takes the session for itself as it connects and clears it
  // as it goes, so the player takes it back whenever media is staged; with
  // none staged there is nothing for the controls to act on.
  const claimMediaSession = useCallback(() => {
    setMediaSessionHandlers({
      play: () => resumeStoryRef.current("system"),
      pause: () => pauseStory("user"),
    });
  }, [pauseStory]);
  useEffect(() => () => setMediaSessionHandlers(null), []);

  const registerPlaybackHandle = useCallback(
    (instanceId: string, handle: ExperienceMediaPlaybackHandle | null) => {
      setStagedHandleIds((current) => {
        if (current.has(instanceId) === (handle !== null)) return current;
        const next = new Set(current);
        if (handle) next.add(instanceId);
        else next.delete(instanceId);
        return next;
      });
      if (!handle) {
        playbackHandlesRef.current.delete(instanceId);
        return;
      }
      playbackHandlesRef.current.set(instanceId, handle);
      handle.setPlaybackRate(effectivePlaybackRateRef.current);
      claimMediaSession();
      // Held clips wait for their hold to lift, the charge gate's included.
      if (mayPlayNow()) playHandle(instanceId, handle);
    },
    [claimMediaSession, mayPlayNow, playHandle]
  );

  // A clip stopped from outside while it was playing: the system (a call,
  // headphones out) or the OS media controls. The story pauses with it rather
  // than running its clock and windows on under a frozen picture.
  const handlePlaybackInterrupted = useCallback(
    (instanceId: string) => {
      if (!playbackHandlesRef.current.has(instanceId)) return;
      // iOS lets one audible element play at a time: starting one pauses the
      // other. That is the player's own play, and another of its clips is
      // playing; a system interruption stops them all.
      for (const [otherId, handle] of playbackHandlesRef.current) {
        const element = otherId === instanceId ? null : handle.element();
        if (element && !element.paused) return;
      }
      pauseStory(document.visibilityState === "hidden" ? "hidden" : "user");
    },
    [pauseStory]
  );

  // Plays every staged clip inside the user activation that calls this: that
  // play() is what WebKit grants an element on, and Low Power Mode refuses any
  // play() a tap did not start. Each play is classified by the one that
  // follows through `playHandle`; this one only unlocks, so its outcome is
  // only traced. A clip the story holds is paused again at once: granted, not
  // started. One at its end is left alone — played, it would start over.
  const unlockMedia = useCallback((keepPlaying: boolean) => {
    playbackHandlesRef.current.forEach((handle, instanceId) => {
      const playing = handle.playInGesture();
      if (!playing) return;
      playing.then(
        () => debugTrace(`unlock ${instanceId}`),
        (error: unknown) => debugTrace(`unlock ${instanceId} ${describeRejection(error)}`)
      );
      if (!keepPlaying) handle.pause();
    });
  }, []);

  // Resumes the story for the viewer, inside their tap or key press, in an
  // order that matters: the clips are played first and synchronously — that
  // play is what WebKit grants an element on — then Web Audio, whose resume()
  // runs before unlock()'s first await; the state follows last. The hold
  // effects then catch up, and each clip is played again through `playHandle`,
  // so a tap that still cannot play is a refusal once more, not a dialog.
  const resumeStory = useCallback(
    (source: "gesture" | "system") => {
      const current = viewerPauseRef.current;
      const next = nextExperienceViewerPause(current, { type: "resume", source }, holdsNow());
      if (next === current) return;
      // The paused frame goes with the pause; focus on it would fall to the page.
      pausedFrameFocusedRef.current =
        pausedFrameRef.current !== null && document.activeElement === pausedFrameRef.current;
      // A refusal is what muted the clip, on its way to failing: the tap that
      // recovers it may play it with sound. Sound the viewer left off stays off.
      if (current === "refused" && soundBlocked) enableSound();
      // Held by the story's own pause command, or by an open charge: unlocked
      // for the tap, but not started.
      unlockMedia(playbackEnabledRef.current && !committedGatesRef.current.chargeGate);
      void unlockAudio().catch(reportAudioError);
      // A phone that lost the screen — the viewer left fullscreen, an access
      // dialog gave it back — takes it again with the tap. The OS controls are
      // no tap on the film, and do not.
      if (source === "gesture" && phone && landscapeFilm) enterLandscape(shellRef.current);
      viewerPauseRef.current = null;
      storyClock.resume();
      debugTrace(`resume ${source}`);
      setViewerPause(null);
    },
    [
      enableSound,
      enterLandscape,
      holdsNow,
      landscapeFilm,
      phone,
      reportAudioError,
      soundBlocked,
      storyClock,
      unlockAudio,
      unlockMedia,
    ]
  );
  useLayoutEffect(() => {
    resumeStoryRef.current = resumeStory;
  });

  // The toggle, the paused frame's tap and Space all come here.
  const togglePause = useCallback(() => {
    if (viewerPauseRef.current === null) pauseStory("user");
    else resumeStoryRef.current("gesture");
  }, [pauseStory]);

  // A tap on the picture pauses the film: the same pause the frame's toggle
  // stands for, offered wherever the toggle is — the story running, a scene
  // with time to stop, no access flow in the way. Only a missed tap is one: a
  // choice, a hotspot or a control under the finger answered it and keeps it,
  // and a tap that merely grazed a hotspot's edge is left for another try at
  // it rather than freezing the film it missed. A world stream takes its taps
  // for its own moves, as it takes Space; the pause stays with its toggle.
  const pauseOnStageTap = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (viewerPauseRef.current !== null) return;
      if (!holds.pauseUi || !toggleVisible || hasWorldModelRenderer) return;
      const target = event.target as Element | null;
      if (
        target?.closest("button, a, input, textarea, select, [data-experience-gesture-available]")
      ) {
        return;
      }
      if (nearAvailableExperienceGesture(event.currentTarget, event.clientX, event.clientY)) return;
      if (consumeTransportWakeTap()) return;
      pauseStory("user");
    },
    [hasWorldModelRenderer, holds.pauseUi, pauseStory, toggleVisible, consumeTransportWakeTap]
  );

  // Space, from the page or the player: a key press is a user activation, so
  // it resumes as a tap does. Listened to on the document, after React's own
  // handlers, so a control that takes Space for itself has already said so.
  useEffect(() => {
    if (!spaceToggles) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPlaybackToggleKey(event, shellRef.current)) return;
      event.preventDefault();
      togglePause();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [spaceToggles, togglePause]);

  // Focus follows the pause. A refusal asks for one tap, so the paused frame
  // takes focus — unless the viewer is busy elsewhere on the page, in a host
  // composer or dialog. A resume gives focus back where the pause took it from,
  // if that is still on the page and nothing else has taken it since; with
  // nothing to give back, focus the paused frame held moves to the toggle that
  // stands for it, rather than falling to the page. The frame's controls never
  // take focus from a pointer, so a pause made with one still finds it where
  // the viewer had it.
  useEffect(() => {
    if (viewerPause === "refused") {
      if (focusIsFree(shellRef.current)) pausedFrameRef.current?.focus({ preventScroll: true });
      return;
    }
    if (viewerPause !== null) return;
    const target = focusBeforePauseRef.current;
    const pausedFrameFocused = pausedFrameFocusedRef.current;
    focusBeforePauseRef.current = null;
    pausedFrameFocusedRef.current = false;
    if (!holds.running || !focusIsFree(shellRef.current)) return;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else if (pausedFrameFocused) toggleRef.current?.focus({ preventScroll: true });
  }, [holds.running, viewerPause]);

  const begin = () => {
    if (started || starting || !theme || entryMediaPending) return;
    playbackEnabledRef.current = initialPlayback?.playbackEnabled ?? true;
    // Inside the click, before anything is awaited. The entry clip is not
    // paused again here: that pause would be delivered as its own task and land
    // after the real play() started.
    if (!entryLocked && (!initialPlayback || initialPlayback.playbackEnabled)) unlockMedia(true);
    // Fullscreen and the orientation lock need this click's activation too.
    // Not awaited: the film starts alongside, and a refusal only means the
    // frame is drawn sideways instead (see shouldRotateFrame).
    if (phone && landscapeFilm) enterLandscape(shellRef.current);
    // AudioContext.resume() runs before unlock()'s first await, so inside it too.
    void unlockAudio().catch(reportAudioError);
    setStarting(true);
    let entryAudioRestored = false;
    void run(() => {
      // A save can carry state obtained behind an earlier gate, even when the
      // current scene is public. Validate that branch before exposing it.
      for (const requirement of entryRequirements) {
        if (!canAccess(requirement)) {
          const error = new ExperienceAccessRequiredError(requirement);
          error.events = entryCheckpoint?.events ?? [];
          throw error;
        }
      }
      if (!entryAudioRestored && initialPlayback?.audio) {
        restoreAudio(initialPlayback.audio);
        entryAudioRestored = true;
      }
      return entryCheckpoint ? controller.dispatch(entryCheckpoint.events) : controller.start();
    })
      .then((entered) => {
        if (!entered) {
          playbackHandlesRef.current.forEach((handle) => handle.pause());
          return;
        }
        // The clip hold lifts with this, and its effect plays the entry clip
        // through `playHandle`: a refusal is a pause and a tap, not a dialog.
        startedRef.current = true;
        setStarted(true);
        publishCheckpoint("transition");
      })
      .finally(() => setStarting(false));
  };

  const isCurrentPresentation = useCallback(
    () =>
      aliveRef.current &&
      sceneEntryRef.current === sceneEpoch &&
      controller.state().currentSceneId === runtimeState.currentSceneId,
    [controller, runtimeState.currentSceneId, sceneEpoch]
  );
  const emitCurrentOutcome = useCallback(
    (...args: Parameters<typeof emitOutcome>) => {
      if (isCurrentPresentation()) emitOutcome(...args);
    },
    [isCurrentPresentation, emitOutcome]
  );
  const reportCurrentRuntimeError = useCallback(
    (error: string) => {
      if (isCurrentPresentation()) setRuntimeError(error);
    },
    [isCurrentPresentation]
  );
  const registerCurrentPlaybackHandle = useCallback(
    (instanceId: string, handle: ExperienceMediaPlaybackHandle | null) => {
      if (handle) {
        if (!isCurrentPresentation()) return;
        playbackHandleEpochsRef.current.set(instanceId, sceneEpoch);
      } else {
        // A delayed cleanup from an earlier entry cannot unregister the
        // replacement element with the same renderer identifier.
        if (playbackHandleEpochsRef.current.get(instanceId) !== sceneEpoch) return;
        playbackHandleEpochsRef.current.delete(instanceId);
      }
      registerPlaybackHandle(instanceId, handle);
    },
    [isCurrentPresentation, registerPlaybackHandle, sceneEpoch]
  );
  const interruptCurrentPlayback = useCallback(
    (instanceId: string) => {
      if (isCurrentPresentation()) handlePlaybackInterrupted(instanceId);
    },
    [isCurrentPresentation, handlePlaybackInterrupted]
  );
  const refuseCurrentPlayback = useCallback(() => {
    if (isCurrentPresentation()) refusePlayback();
  }, [isCurrentPresentation, refusePlayback]);
  const blockCurrentSound = useCallback(() => {
    if (isCurrentPresentation()) handleSoundBlocked();
  }, [isCurrentPresentation, handleSoundBlocked]);
  const measureCurrentContent = useCallback(
    (size: { width: number; height: number }) => {
      if (isCurrentPresentation()) setDecodedContentSize(size);
    },
    [isCurrentPresentation]
  );

  const renderSlot = ({ renderer, key }: (typeof rendererSlots)[number]) => (
    <CoreRenderer
      key={key}
      manifest={manifest}
      renderer={renderer}
      entryKey={`${runtimeState.currentSceneId}:${sceneEpoch}`}
      runtimeState={runtimeState}
      formatPrice={access?.formatPrice}
      active={started}
      paused={holds.storyHeld}
      open={openRendererIds.has(renderer.instanceId)}
      locale={playbackLocale}
      orientation={orientation}
      copy={copy}
      muted={soundBlocked}
      initialPlayback={
        sceneEpoch === restoredPresentation.epoch &&
        restoredPresentation.playback?.sceneId === runtimeState.currentSceneId
          ? restoredPresentation.playback.media.find(
              (media) => media.rendererInstanceId === renderer.instanceId
            )
          : undefined
      }
      watchedMedia={journeyRef.current.watchedMedia.filter(
        (media) => media.sceneId === runtimeState.currentSceneId
      )}
      playbackRate={effectivePlaybackRate}
      watchedAssetIds={runtimeState.watchedAssetIds}
      onPlaybackProgress={(progress) => {
        if (
          sceneEntryRef.current !== sceneEpoch ||
          controller.state().currentSceneId !== runtimeState.currentSceneId
        )
          return;
        mediaCheckpointsRef.current.set(renderer.instanceId, progress);
        if (startedRef.current)
          journeyRef.current = recordExperienceJourney(manifest, journeyRef.current, {
            watchedMedia: [
              {
                sceneId: runtimeState.currentSceneId,
                rendererInstanceId: renderer.instanceId,
                sequenceIndex: progress.sequenceIndex,
                assetId: progress.assetId,
                mediaSignature: progress.mediaSignature,
                watchedUntilMs: progress.watchedUntilMs,
              },
            ],
          });
        // Only the scene's driving clip owns the progress controls.
        if (
          scene?.clock.kind !== "renderer" ||
          scene.clock.rendererInstanceId === renderer.instanceId
        )
          setMediaProgress(progress);
        publishCheckpoint("progress");
      }}
      onTimelineTimeMs={(timeMs) => {
        if (
          sceneEntryRef.current === sceneEpoch &&
          controller.state().currentSceneId === runtimeState.currentSceneId
        ) {
          advanceTimeline(renderer.instanceId, timeMs);
        }
      }}
      onOutcome={emitCurrentOutcome}
      onRuntimeError={reportCurrentRuntimeError}
      onPlaybackHandle={registerCurrentPlaybackHandle}
      onPlaybackInterrupted={interruptCurrentPlayback}
      onPlaybackRefused={refuseCurrentPlayback}
      onSoundBlocked={blockCurrentSound}
      onContentSize={measureCurrentContent}
      renderWorldModel={renderWorldModel}
    />
  );

  const gatePreview = nodeGate ? resolveLockedScenePreview(manifest, nodeGate, orientation) : null;
  const transportBlocked =
    interactionActive ||
    !playbackEnabledRef.current ||
    Boolean((mediaProgress?.terminalMode && !mediaProgress.isStill) || mediaProgress?.completed) ||
    (holds.mediaHeld && viewerPause === null);
  const seekWatchedPosition = (targetMs: number) => {
    if (transportBlocked || !mediaProgress || !startedRef.current || accessPendingRef.current)
      return;
    const progress = mediaCheckpointsRef.current.get(mediaProgress.rendererInstanceId);
    const handle = playbackHandlesRef.current.get(mediaProgress.rendererInstanceId);
    if (!progress || !handle || (progress.terminalMode && !progress.isStill) || progress.completed)
      return;
    const target = clampWatchedSeek(targetMs, progress.durationMs, progress.watchedUntilMs);
    const sceneTarget = Math.max(0, scenePositionRef.current - progress.positionMs + target);
    // A still-unresolved window cannot be jumped over, even after rewinding.
    if (
      target > progress.positionMs &&
      scene?.gestures.some(
        (gesture) =>
          !settledGestureIdsRef.current.includes(gesture.gestureId) &&
          gesture.activeWindow &&
          scenePositionRef.current < gesture.activeWindow.startMs &&
          sceneTarget >= gesture.activeWindow.startMs
      )
    )
      return;
    const next = { ...progress, positionMs: target };
    mediaCheckpointsRef.current.set(progress.rendererInstanceId, next);
    setMediaProgress(next);
    handle.seek(target / 1_000);
    if (
      scene?.clock.kind === "renderer" &&
      scene.clock.rendererInstanceId === progress.rendererInstanceId
    ) {
      advanceTimeline(progress.rendererInstanceId, sceneTarget);
    }
    publishCheckpoint("seek");
  };

  const mapAvailable = started && !runtimeError && !accessPending && !retryAccess && !nodeGate;
  const mapNodeDetails = useMemo(() => {
    const details: Record<string, { title?: string; thumbnailUrl?: string }> = {};
    for (const sceneId of journeyForMap.visitedNodeIds) {
      const node = findGraphNode(manifest, sceneId);
      if (node?.kind !== "scene") continue;
      const textRenderer = node.renderers.find(
        (renderer) => renderer.rendererId === EXPERIENCE_CORE_TEXT_RENDERER_ID
      );
      const textConfig = ExperienceCoreTextRendererConfigSchema.safeParse(textRenderer?.config);
      const choiceRenderer = node.renderers.find(
        (renderer) => renderer.rendererId === EXPERIENCE_CORE_CHOICE_RENDERER_ID
      );
      const choiceConfig = ExperienceCoreChoiceRendererConfigSchema.safeParse(
        choiceRenderer?.config
      );
      const title =
        textConfig.success && textConfig.data.title
          ? localize(textConfig.data.title, playbackLocale, manifest.localization.defaultLocale)
          : choiceConfig.success && choiceConfig.data.prompt
            ? localize(
                choiceConfig.data.prompt,
                playbackLocale,
                manifest.localization.defaultLocale
              )
            : undefined;
      const videoRenderer = node.renderers.find(
        (renderer) => renderer.rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID
      );
      const videoConfig = ExperienceCoreVideoRendererConfigSchema.safeParse(videoRenderer?.config);
      const posterAssetId = videoConfig.success
        ? (videoConfig.data.posterAssetId ?? videoConfig.data.sequence[0]?.posterAssetId)
        : undefined;
      const thumbnailUrl = posterAssetId
        ? resolveImageUri(manifest.assets, posterAssetId, orientation)
        : undefined;
      details[sceneId] = { ...(title ? { title } : {}), ...(thumbnailUrl ? { thumbnailUrl } : {}) };
    }
    for (const edge of journeyForMap.traversedEdges) {
      if (!("toEndingId" in edge)) continue;
      const ending = manifest.endings.find((candidate) => candidate.endingId === edge.toEndingId);
      if (ending)
        details[experienceJourneyEndingNodeId(ending.endingId)] = {
          title: localize(ending.title, playbackLocale, manifest.localization.defaultLocale),
        };
    }
    return details;
  }, [journeyForMap, manifest, orientation, playbackLocale]);
  const openJourneyMap = (origin: "corner" | "transport") => {
    if (!mapAvailable || journeyMapOpenRef.current) return;
    journeyMapOriginRef.current = origin;
    journeyWasPlayingRef.current = viewerPauseRef.current === null && !holdsNow().storyHeld;
    pauseStory("user");
    journeyMapOpenRef.current = true;
    setJourneyMapOpen(true);
    setJourneyForMap(journeyRef.current);
    setJourneyReplayError(null);
  };
  const closeJourneyMap = () => {
    if (journeyReplayPendingRef.current) return;
    journeyMapOpenRef.current = false;
    setJourneyMapOpen(false);
    if (journeyWasPlayingRef.current) resumeStory("gesture");
    restoreJourneyFocusRef.current = true;
  };
  const replayJourneyScene = async (sceneId: string) => {
    if (journeyReplayPendingRef.current || accessPendingRef.current) return;
    journeyReplayPendingRef.current = true;
    setJourneyReplayPending(true);
    setJourneyReplayError(null);
    try {
      const node = findGraphNode(manifest, sceneId);
      if (!node || node.kind !== "scene") throw new Error("The selected scene is unavailable.");
      // Exploration never grants access. Ask the current entitlement service
      // before replacing any engine or presentation state.
      for (const requirement of getExperienceJourneyReplayAccess(
        manifest,
        journeyRef.current,
        sceneId
      )) {
        if (previewAccess) continue;
        if (!access) throw new ExperienceAccessRequiredError(requirement);
        const allowed = access.checkAccess
          ? await access.checkAccess(requirement)
          : access.canAccess(requirement);
        if (!aliveRef.current) return;
        if (!allowed) {
          onAccessCheckpoint?.(buildCheckpointRef.current());
          exitLandscape();
          // The host's purchase dialog owns focus until it settles. Keep the
          // story held, but unmount this dialog's independent focus trap.
          setJourneyMapSuspended(true);
          if (!(await access.requestAccess(requirement))) return;
        }
        if (!aliveRef.current) return;
      }
      const checkpoint = restoreExperienceJourneyAnchor(manifest, journeyRef.current, sceneId, {
        canAccess,
        watchedAssetIds: controller.state().watchedAssetIds,
      });
      const state = controller.restore(checkpoint.state);
      journeyRef.current = rewindExperienceJourney(journeyRef.current, sceneId);
      // Entry anchors are already settled; dispatching scene.entered again
      // would apply state changes and awards twice.
      playbackHandlesRef.current.forEach((handle) => handle.pause());
      restoreAudio(checkpoint.playback?.audio);
      pendingCheckpointEventsRef.current = checkpoint.events;
      scenePositionRef.current = checkpoint.playback?.sceneTimeMs ?? 0;
      setSceneTimeMs(scenePositionRef.current);
      fixedClockEndedRef.current = checkpoint.playback?.fixedClockEnded ?? false;
      timelineCursorRef.current =
        checkpoint.playback?.cursor ?? createExperienceTimelineCursor(sceneId);
      openRendererIdsRef.current = new Set(checkpoint.playback?.openRendererIds);
      setOpenRendererIds(openRendererIdsRef.current);
      settledGestureIdsRef.current = checkpoint.playback?.settledGestureIds ?? [];
      setSettledGestureIds(settledGestureIdsRef.current);
      parkedGestureEventsRef.current = checkpoint.playback?.parkedEvents ?? [];
      mediaCheckpointsRef.current = new Map(
        checkpoint.playback?.media.map((media) => [media.rendererInstanceId, media])
      );
      setMediaProgress(checkpoint.playback?.media[0] ?? null);
      playbackEnabledRef.current = checkpoint.playback?.playbackEnabled ?? true;
      setTimelineHoldGate(false);
      setRetryAccess(null);
      setRuntimeError(null);
      const nextEpoch = ++sceneEntryRef.current;
      setRestoredPresentation({ epoch: nextEpoch, playback: checkpoint.playback });
      setSceneEpoch(nextEpoch);
      setRuntimeState(state);
      journeyMapOpenRef.current = false;
      setJourneyMapOpen(false);
      viewerPauseRef.current = null;
      setViewerPause(null);
      storyClock.resume();
      void unlockAudio().catch(reportAudioError);
      publishCheckpoint("transition");
      restoreJourneyFocusRef.current = true;
    } catch (error) {
      if (aliveRef.current) setJourneyReplayError(runtimeErrorMessage(error));
    } finally {
      journeyReplayPendingRef.current = false;
      if (aliveRef.current) setJourneyReplayPending(false);
      if (aliveRef.current) setJourneyMapSuspended(false);
    }
  };
  const mapButton = mapAvailable ? (
    <button
      type="button"
      ref={journeyMapTransportButtonRef}
      data-experience-journey-map-trigger="transport"
      aria-label={copy.journeyMap.open}
      title={copy.journeyMap.open}
      aria-haspopup="dialog"
      onClick={() => openJourneyMap("transport")}
      className="pointer-events-auto grid size-11 shrink-0 place-items-center rounded-full text-white/90 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <IconRoute className="size-5" aria-hidden="true" />
    </button>
  ) : null;
  const cornerMapButton =
    mapAvailable && !journeyMapOpen ? (
      <button
        type="button"
        ref={journeyMapCornerButtonRef}
        data-experience-journey-map-trigger="corner"
        aria-label={copy.journeyMap.open}
        aria-haspopup="dialog"
        onClick={() => openJourneyMap("corner")}
        className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full bg-black/65 px-4 text-sm font-semibold text-white shadow-lg ring-1 ring-white/15 outline-none backdrop-blur-md transition-colors hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none"
      >
        <IconRoute className="size-5 shrink-0 text-[#E52227]" aria-hidden="true" />
        {copy.journeyMap.open}
      </button>
    ) : null;

  return (
    <PlayerFrame
      shellRef={shellRef}
      orientation={orientation}
      experienceProfile={experienceProfile}
      stageProfile={stageProfile}
      rotated={frameRotated}
      fullscreen={fullscreen}
      copy={copy}
      style={theme ? themeStyle(theme) : undefined}
      onStageTap={pauseOnStageTap}
      activityHandlers={{
        onPointerMove: transportChrome.onPointerMove,
        onPointerDownCapture: transportChrome.onPointerDown,
        onKeyDownCapture: transportChrome.onKeyDownCapture,
      }}
      cornerControls={
        <>
          {cornerMapButton}
          {playbackStatus}
        </>
      }
      stage={
        <ExperienceStoryClockContext.Provider value={storyClock}>
          {/* The story itself. Always rendered and never re-keyed, so a pause
              keeps the spatial layer — and the gestures it has already settled —
              as it is; while paused it takes no input at all. No z-index:
              renderer layers still stack in the stage's own context, and `cq*`
              units still resolve against the stage. */}
          <div
            ref={storyLayerRef}
            data-experience-story-layer=""
            data-experience-paused={viewerPause ?? undefined}
            inert={viewerPause !== null}
            className="absolute inset-0"
            style={
              {
                "--experience-choice-control-clearance":
                  transportAvailable && mediaProgress ? "52px" : "0px",
              } as CSSProperties
            }
          >
            {scene ? (
              rendererSlots
                .filter(
                  ({ renderer }) => renderer.rendererId !== EXPERIENCE_CORE_CHOICE_RENDERER_ID
                )
                .map(renderSlot)
            ) : (
              <div className="absolute inset-0 bg-black" />
            )}
            {scene && started && !endingId && !accessPending && !retryAccess ? (
              <ExperienceSpatialLayer
                key={`${scene.sceneId}:${sceneEpoch}`}
                manifest={manifest}
                scene={scene}
                runtimeState={runtimeState}
                sceneTimeMs={sceneTimeMs}
                locale={playbackLocale}
                viewerLocale={locale}
                orientation={orientation}
                decodedContentSize={decodedContentSize}
                onEvents={emitRuntimeEvents}
                onRuntimeError={setRuntimeError}
                onTimelineHoldGateChange={setTimelineHoldGate}
                initialSettledGestureIds={
                  sceneEpoch === restoredPresentation.epoch
                    ? restoredPresentation.playback?.settledGestureIds
                    : undefined
                }
                onSettledGestureIdsChange={(ids) => {
                  settledGestureIdsRef.current = [...ids];
                  setSettledGestureIds([...ids]);
                  publishCheckpoint("transition");
                }}
              />
            ) : null}
            {/* Choices belong to the picture: they sit in the film frame, turn
                with it when it is drawn sideways, and scale with it. */}
            {!endingId && !runtimeError && !nodeGate
              ? rendererSlots
                  .filter(
                    ({ renderer }) => renderer.rendererId === EXPERIENCE_CORE_CHOICE_RENDERER_ID
                  )
                  .map(renderSlot)
              : null}
          </div>
          {/* The pause is part of the picture: the paused frame and the controls
              sit in the film frame and turn with it. Neither shows over an
              access flow, the locked-scene gate, the ending or a failure.
              The frame keeps no pause toggle of its own where the picture
              offers one — a missed tap pauses, Space pauses — only over a
              world stream, which takes its taps and its Space for moves, does
              the toggle stand in the frame's corner. */}
          {holds.pauseUi && viewerPause !== null ? (
            <ExperiencePausedScrim
              ref={pausedFrameRef}
              copy={copy.playback}
              reason={viewerPause}
              onResume={() => resumeStory("gesture")}
            />
          ) : null}
          {holds.pauseUi ? (
            <ExperienceFrameControls
              toggleRef={toggleRef}
              copy={copy}
              paused={viewerPause !== null}
              worldStream={hasWorldModelRenderer}
              unmuteVisible={soundBlocked && hasVideoRenderer && viewerPause === null}
              keyShortcut={spaceToggles && !hasTextRenderer}
              onToggle={togglePause}
              onUnmute={enableSound}
            />
          ) : null}
          {transportAvailable && mediaProgress ? (
            <div
              data-experience-controls-visible={transportChrome.visible ? "true" : "false"}
              onFocusCapture={transportChrome.onFocusCapture}
              onBlurCapture={transportChrome.onBlurCapture}
              onPointerEnter={transportChrome.onPointerEnter}
              onPointerLeave={transportChrome.onPointerLeave}
              className={classNames(
                "absolute right-0 bottom-0 left-0 transition-opacity duration-200 motion-reduce:transition-none",
                transportChrome.visible
                  ? "opacity-100"
                  : "pointer-events-none opacity-0 [&_*]:pointer-events-none"
              )}
              style={{ zIndex: EXPERIENCE_RENDERER_MAX_LAYER + 2 }}
            >
              <ExperiencePlaybackTransportControls
                copy={copy.playback.transport}
                positionMs={mediaProgress.positionMs}
                durationMs={mediaProgress.durationMs}
                seekLimitMs={mediaProgress.watchedUntilMs}
                rate={effectivePlaybackRate}
                disabled={transportBlocked}
                disabledReason={copy.playback.transport.interactionBlocked}
                onSeek={seekWatchedPosition}
                onRate={(rate) => {
                  if (transportBlocked || ![1, 1.25, 1.5, 2].includes(rate)) return;
                  playbackRateRef.current = rate as ExperiencePlaybackRate;
                  setPlaybackRate(rate as ExperiencePlaybackRate);
                  const effective = approachingInteraction ? 1 : rate;
                  effectivePlaybackRateRef.current = effective;
                  storyClock.setRate(effective);
                  playbackHandlesRef.current.forEach((handle) => handle.setPlaybackRate(effective));
                  publishCheckpoint("pause");
                }}
                trailingControls={mapAvailable ? mapButton : null}
              />
            </div>
          ) : null}
        </ExperienceStoryClockContext.Provider>
      }
    >
      {journeyMapOpen && !journeyMapSuspended ? (
        <div
          className="pointer-events-auto absolute inset-0"
          style={{ zIndex: EXPERIENCE_RENDERER_MAX_LAYER + 30 }}
        >
          <ExperienceJourneyMap
            graph={projectExperienceJourneyGraph(manifest, journeyForMap)}
            nodeDetails={mapNodeDetails}
            currentSceneId={
              runtimeState.completedEndingId
                ? experienceJourneyEndingNodeId(runtimeState.completedEndingId)
                : runtimeState.currentSceneId
            }
            copy={copy.journeyMap}
            onClose={closeJourneyMap}
            onReplay={(sceneId) => {
              void replayJourneyScene(sceneId);
            }}
            replayPending={journeyReplayPending}
            error={journeyReplayError ?? undefined}
          />
        </div>
      ) : null}
      {nodeGate ? (
        <div
          className="pointer-events-auto absolute inset-0 grid place-items-center bg-black p-6 text-center"
          style={{ zIndex: EXPERIENCE_RENDERER_MAX_LAYER + 3 }}
        >
          <div className="absolute inset-0 overflow-hidden" aria-hidden>
            <div
              className="absolute inset-0"
              style={{ filter: "blur(12px)", transform: "scale(1.05)" }}
            >
              {gatePreview && access?.renderPreview ? (
                access.renderPreview(gatePreview)
              ) : gatePreview?.posterUri ? (
                <img
                  src={gatePreview.posterUri}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                />
              ) : null}
            </div>
          </div>
          <div className="absolute inset-0 bg-black/50" />
        </div>
      ) : null}
      {retryAccess && started && !nodeGate ? (
        <div
          className="pointer-events-auto absolute inset-0 grid place-items-center bg-black/60"
          style={{ zIndex: EXPERIENCE_RENDERER_MAX_LAYER + 2 }}
        >
          <button type="button" className={PRIMARY_BUTTON} onClick={retryAccess}>
            {copy.continue}
          </button>
        </div>
      ) : null}
      {accessPending && !nodeGate ? (
        <div
          className="pointer-events-auto absolute inset-0 bg-black/40"
          style={{ zIndex: EXPERIENCE_RENDERER_MAX_LAYER + 2 }}
        />
      ) : null}

      {!started && !runtimeError && !nodeGate ? (
        <div
          className={classNames(
            "pointer-events-auto absolute inset-0 z-40 grid place-items-center p-6 text-center",
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
              disabled={!theme || starting || entryMediaPending}
              onClick={begin}
            >
              <IconPlayerPlay className="size-4 fill-current" />
              {starting ? copy.starting : entryMediaPending ? copy.loadingMedia : copy.start}
            </button>
          </div>
        </div>
      ) : null}

      {endingId && !runtimeError ? (
        <div
          role="dialog"
          aria-modal="true"
          className="pointer-events-auto absolute inset-0 z-50 grid place-items-center bg-black/78 p-6 text-center backdrop-blur-md"
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
            {reportError ? (
              <div role="alert" className="mt-4 text-sm text-white/80">
                <p>{reportError}</p>
                <button
                  type="button"
                  className={`${PRIMARY_BUTTON} mt-3`}
                  onClick={controller.retryPlaySessionReport}
                >
                  {copy.retryReport ?? copy.restart}
                </button>
              </div>
            ) : null}
            {endingExtra ? (
              <div className="mt-6 w-full text-left">{endingExtra(completedPlaySessionId)}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {runtimeError ? (
        <div
          role="alertdialog"
          aria-modal="true"
          className="pointer-events-auto absolute inset-0 z-[60] grid place-items-center bg-black/84 p-6 text-center backdrop-blur-md"
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
  entryKey,
  runtimeState,
  active,
  paused,
  open,
  locale,
  orientation,
  copy,
  muted,
  initialPlayback,
  playbackRate,
  onPlaybackProgress,
  watchedAssetIds,
  watchedMedia,
  onTimelineTimeMs,
  onOutcome,
  onRuntimeError,
  onPlaybackHandle,
  onPlaybackInterrupted,
  onPlaybackRefused,
  onSoundBlocked,
  onContentSize,
  renderWorldModel,
  formatPrice,
}: {
  formatPrice?: (amount: number) => string;
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  /** The current scene entry: its id and epoch, so a re-entry is a new entry. */
  entryKey: string;
  runtimeState: ExperienceRuntimeState;
  active: boolean;
  /** Story time stands still: the viewer paused, an access flow is open, the story is over. */
  paused: boolean;
  open: boolean;
  locale: string;
  orientation: ExperienceOrientation;
  copy: ExperiencePlayerCopy;
  muted: boolean;
  initialPlayback?: ExperienceMediaCheckpoint;
  playbackRate: number;
  onPlaybackProgress: (checkpoint: ExperienceMediaCheckpoint) => void;
  watchedAssetIds: readonly string[];
  watchedMedia: readonly ExperienceJourneyWatchedMedia[];
  onTimelineTimeMs: (timeMs: number) => void;
  onOutcome: (
    instanceId: string,
    outcomeType: string,
    payload: Record<string, never> | { choiceId: string }
  ) => void;
  onRuntimeError: (message: string) => void;
  onPlaybackHandle: (instanceId: string, handle: ExperienceMediaPlaybackHandle | null) => void;
  /** The renderer's clip was paused from outside while it played. */
  onPlaybackInterrupted: (instanceId: string) => void;
  /** The browser refused to play the renderer's media without a tap. */
  onPlaybackRefused: () => void;
  onSoundBlocked: () => void;
  onContentSize: (size: { width: number; height: number }) => void;
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
          entryKey={entryKey}
          onCompleted={() => onOutcome(renderer.instanceId, "media-ended", {})}
        />
      );
    }
    return (
      <CoreVideoRenderer
        manifest={manifest}
        renderer={renderer}
        entryKey={entryKey}
        orientation={orientation}
        copy={copy}
        muted={muted}
        initialPlayback={initialPlayback}
        playbackRate={playbackRate}
        onPlaybackProgress={onPlaybackProgress}
        watchedAssetIds={watchedAssetIds}
        watchedMedia={watchedMedia}
        onTimelineTimeMs={onTimelineTimeMs}
        onCompleted={() => onOutcome(renderer.instanceId, "media-ended", {})}
        onRuntimeError={onRuntimeError}
        onPlaybackHandle={onPlaybackHandle}
        onPlaybackInterrupted={() => onPlaybackInterrupted(renderer.instanceId)}
        onPlaybackRefused={onPlaybackRefused}
        onSoundBlocked={onSoundBlocked}
        onContentSize={onContentSize}
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
        formatPrice={formatPrice}
        onSelect={(choiceId) => onOutcome(renderer.instanceId, "choice-selected", { choiceId })}
      />
    );
  }
  if (renderer.rendererId === EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID) {
    return (
      <CoreWorldModelRenderer
        renderer={renderer}
        active={active}
        paused={paused}
        renderWorldModel={renderWorldModel}
        onCompleted={() => onOutcome(renderer.instanceId, "world-completed", {})}
        onRuntimeError={onRuntimeError}
        onPlaybackHandle={onPlaybackHandle}
        onPlaybackRefused={onPlaybackRefused}
      />
    );
  }
  if (renderer.rendererId === EXPERIENCE_CORE_CHARGE_FEEDBACK_RENDERER_ID) return null;
  return null;
}

function CoreWorldModelRenderer({
  renderer,
  active,
  paused,
  renderWorldModel,
  onCompleted,
  onRuntimeError,
  onPlaybackHandle,
  onPlaybackRefused,
}: {
  renderer: ExperienceRendererInstance;
  active: boolean;
  paused: boolean;
  renderWorldModel?: (props: ExperienceWorldModelRendererProps) => ReactNode;
  onCompleted: () => void;
  onRuntimeError: (message: string) => void;
  onPlaybackHandle: (instanceId: string, handle: ExperienceMediaPlaybackHandle | null) => void;
  onPlaybackRefused: () => void;
}) {
  const reportedErrorRef = useRef<string | null>(null);
  // The stream plays on an element of its own, which is played and held like a
  // clip's: inside the viewer's taps, and with the story.
  const handOverElement = useCallback(
    (element: HTMLVideoElement | null) =>
      onPlaybackHandle(
        renderer.instanceId,
        element ? liveStreamPlaybackHandle(renderer.instanceId, element) : null
      ),
    [onPlaybackHandle, renderer.instanceId]
  );
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
        paused,
        onCompleted,
        // The stream's element refusing to play without a tap takes the same
        // refused path as a clip's: a pause, never the failure dialog.
        onError: (error) =>
          isAutoplayPolicyRefusal(error)
            ? onPlaybackRefused()
            : onRuntimeError(runtimeErrorMessage(error)),
        onMediaElement: handOverElement,
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
  entryKey: string;
  rendererInstanceId: string;
  sequenceIndex: number;
  terminalMode: CoreVideoTerminalMode;
  checkpoint?: ExperienceMediaCheckpoint;
};

interface CoreVideoCompletionTimer {
  readonly id: number;
  readonly rendererInstanceId: string;
  readonly identity: string;
  readonly dueAt: number;
  readonly progressTimerId: number;
}

function initialCoreVideoPlaybackState(
  entryKey: string,
  rendererInstanceId: string,
  checkpoint?: ExperienceMediaCheckpoint
): CoreVideoPlaybackState {
  const saved = checkpoint?.rendererInstanceId === rendererInstanceId ? checkpoint : undefined;
  return {
    entryKey,
    rendererInstanceId,
    sequenceIndex: saved?.sequenceIndex ?? 0,
    terminalMode: saved?.terminalMode ?? null,
    checkpoint: saved,
  };
}

function isEmptyVideoSequence(renderer: ExperienceRendererInstance): boolean {
  const parsed = ExperienceCoreVideoRendererConfigSchema.safeParse(renderer.config);
  return parsed.success && parsed.data.sequence.length === 0;
}

/**
 * Whether Start plays media on this renderer: an autoplaying video renderer
 * with footage, which registers a playback handle once its first clip is on
 * an element. A placeholder for footage not attached yet has nothing to wait for.
 */
function playsMediaOnStart(renderer: ExperienceRendererInstance): boolean {
  if (renderer.rendererId !== EXPERIENCE_CORE_VIDEO_RENDERER_ID) return false;
  const parsed = ExperienceCoreVideoRendererConfigSchema.safeParse(renderer.config);
  return parsed.success && parsed.data.autoplay && parsed.data.sequence.length > 0;
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
  entryKey,
  onCompleted,
}: {
  label: string;
  entryKey: string;
  onCompleted: () => void;
}) {
  const storyClock = useContext(ExperienceStoryClockContext);
  // The beat belongs to the scene entry: the host hands over a new callback on
  // every render, and following it would start the beat over each time.
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;
  useEffect(() => {
    const timer = storyClock.setTimeout(() => onCompletedRef.current(), EMPTY_SEQUENCE_HOLD_MS);
    return () => storyClock.clearTimer(timer);
  }, [entryKey, storyClock]);
  return (
    <div className="absolute inset-0 grid place-items-center bg-black">
      <p className="text-sm font-semibold tracking-wide text-white/45">{label}</p>
    </div>
  );
}

function CoreVideoRenderer({
  entryKey,
  initialPlayback,
  playbackRate,
  onPlaybackProgress,
  watchedAssetIds,
  watchedMedia,
  manifest,
  renderer,
  orientation,
  copy,
  muted,
  onTimelineTimeMs,
  onCompleted,
  onRuntimeError,
  onPlaybackHandle,
  onPlaybackInterrupted,
  onPlaybackRefused,
  onSoundBlocked,
  onContentSize,
}: {
  entryKey: string;
  initialPlayback?: ExperienceMediaCheckpoint;
  playbackRate: number;
  onPlaybackProgress: (checkpoint: ExperienceMediaCheckpoint) => void;
  watchedAssetIds: readonly string[];
  watchedMedia: readonly ExperienceJourneyWatchedMedia[];
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  orientation: ExperienceOrientation;
  copy: ExperiencePlayerCopy;
  muted: boolean;
  onTimelineTimeMs: (timeMs: number) => void;
  onCompleted: () => void;
  onRuntimeError: (message: string) => void;
  onPlaybackHandle: (instanceId: string, handle: ExperienceMediaPlaybackHandle | null) => void;
  onPlaybackInterrupted: () => void;
  onPlaybackRefused: () => void;
  onSoundBlocked: () => void;
  onContentSize: (size: { width: number; height: number }) => void;
}) {
  const config = ExperienceCoreVideoRendererConfigSchema.parse(renderer.config);
  const storyClock = useContext(ExperienceStoryClockContext);
  const [playbackState, setPlaybackState] = useState<CoreVideoPlaybackState>(() =>
    initialCoreVideoPlaybackState(entryKey, renderer.instanceId, initialPlayback)
  );
  const activePlaybackState =
    playbackState.entryKey === entryKey && playbackState.rendererInstanceId === renderer.instanceId
      ? playbackState
      : initialCoreVideoPlaybackState(entryKey, renderer.instanceId, initialPlayback);
  const { sequenceIndex, terminalMode } = activePlaybackState;
  const initiallyCompleted = activePlaybackState.checkpoint?.completed === true;
  const completionTimerRef = useRef<CoreVideoCompletionTimer | null>(null);
  const completedRendererIdRef = useRef<string | null>(null);
  const progressRef = useRef<{
    identity: string;
    checkpoint: ExperienceMediaCheckpoint;
    observedAt: number;
    observedPosition: number;
    seeking: boolean;
    sent: string | null;
  } | null>(null);
  const onPlaybackProgressRef = useRef(onPlaybackProgress);
  onPlaybackProgressRef.current = onPlaybackProgress;
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;
  const registeredHandleRef = useRef<{
    identity: string;
    handle: ExperienceMediaPlaybackHandle;
  } | null>(null);
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
      ? `${entryKey}:${renderer.instanceId}:${sequenceIndex}:loop:${assetId}:${terminalMode.clipStartTime ?? 0}`
      : `${entryKey}:${renderer.instanceId}:${sequenceIndex}:sequence:${assetId}`;
  const knownWatchedUntilMs = assetId
    ? (watchedMedia.find(
        (entry) =>
          entry.rendererInstanceId === renderer.instanceId &&
          entry.sequenceIndex === sequenceIndex &&
          entry.assetId === assetId &&
          entry.mediaSignature === mediaPlaybackSignature(manifest, assetId)
      )?.watchedUntilMs ?? 0)
    : 0;
  const emitProgress = useCallback(
    (identity: string) => {
      const progress = progressRef.current;
      if (!progress || progress.identity !== identity) return;
      const timer = completionTimerRef.current;
      if (timer?.identity === identity)
        progress.checkpoint.remainingHoldMs = Math.max(0, timer.dueAt - storyClock.now());
      const serialized = JSON.stringify(progress.checkpoint);
      if (progress.sent === serialized) return;
      progress.sent = serialized;
      onPlaybackProgressRef.current(structuredClone(progress.checkpoint));
    },
    [storyClock]
  );
  const recordPosition = useCallback(
    (positionMs: number, natural = true) => {
      const progress = progressRef.current;
      if (!progress || progress.identity !== playbackIdentity || !Number.isFinite(positionMs))
        return;
      const checkpoint = progress.checkpoint;
      if (checkpoint.durationMs <= 0) return;
      const next = Math.max(0, Math.min(positionMs, checkpoint.durationMs || positionMs));
      const now = storyClock.now();
      const delta = next - progress.observedPosition;
      // Only contiguous natural playback expands the seen range. A renderer
      // command may seek forward, but that jump never earns skip permission.
      if (
        natural &&
        !progress.seeking &&
        delta >= 0 &&
        progress.observedPosition <= checkpoint.watchedUntilMs + 1 &&
        delta <= Math.max(0, now - progress.observedAt) + 250
      ) {
        checkpoint.watchedUntilMs = Math.max(checkpoint.watchedUntilMs, next);
      }
      progress.seeking = false;
      progress.observedPosition = next;
      progress.observedAt = now;
      checkpoint.positionMs = next;
      emitProgress(playbackIdentity);
    },
    [emitProgress, playbackIdentity, storyClock]
  );
  const registerPlaybackHandle = useCallback(
    (handle: ExperienceMediaPlaybackHandle | null) => {
      if (!handle) {
        if (registeredHandleRef.current?.identity !== playbackIdentity) return;
        registeredHandleRef.current = null;
        onPlaybackHandle(renderer.instanceId, null);
        return;
      }
      if (progressRef.current?.identity !== playbackIdentity) return;
      if (
        !config.autoplay ||
        (terminalMode?.kind === "held" && !progressRef.current.checkpoint.isStill) ||
        progressRef.current.checkpoint.completed
      ) {
        registeredHandleRef.current = null;
        onPlaybackHandle(renderer.instanceId, null);
        return;
      }
      const registration = { identity: playbackIdentity, handle };
      registeredHandleRef.current = registration;
      const current = () =>
        registeredHandleRef.current === registration &&
        progressRef.current?.identity === playbackIdentity;
      onPlaybackHandle(renderer.instanceId, {
        ...handle,
        playInGesture: () => (current() ? handle.playInGesture() : null),
        play: () => (current() ? handle.play() : Promise.resolve()),
        pause: () => {
          if (current()) {
            handle.pause();
            emitProgress(playbackIdentity);
          }
        },
        seek: (seconds) => {
          if (!current() || !Number.isFinite(seconds) || seconds < 0) return;
          const checkpoint = progressRef.current!.checkpoint;
          const targetMs = Math.min(seconds * 1_000, checkpoint.durationMs);
          if (checkpoint.isStill && checkpoint.terminalMode?.kind === "held") {
            scheduleCompletionRef.current(Math.max(0, checkpoint.durationMs - targetMs));
          }
          recordPosition(targetMs, false);
          progressRef.current!.seeking = true;
          handle.seek(targetMs / 1_000);
        },
        setPlaybackRate: (rate) => {
          if (current()) handle.setPlaybackRate(rate);
        },
        setMuted: (next) => {
          if (current()) handle.setMuted(next);
        },
        ended: () => current() && handle.ended(),
        element: () => (current() ? handle.element() : null),
      });
    },
    [
      config.autoplay,
      emitProgress,
      onPlaybackHandle,
      playbackIdentity,
      recordPosition,
      renderer.instanceId,
      terminalMode?.kind,
    ]
  );

  const clearCompletionTimer = useCallback(
    (rendererInstanceId?: string) => {
      const timer = completionTimerRef.current;
      if (!timer || (rendererInstanceId && timer.rendererInstanceId !== rendererInstanceId)) return;
      storyClock.clearTimer(timer.id);
      storyClock.clearTimer(timer.progressTimerId);
      completionTimerRef.current = null;
    },
    [storyClock]
  );

  // The core-video slot is intentionally reused between scenes so WebKit keeps
  // the media element that received the user's audible-playback permission.
  // Scene-owned resources must nevertheless be reset BEFORE a new child can
  // register its playback handle: passive child effects run before passive
  // parent effects, which previously let an opening still schedule its timer
  // and then had this reset clear that brand-new timer. A layout effect runs the
  // reset before any passive handle registration, while timer ownership makes a
  // late cleanup from the old scene unable to touch the new scene's timer.
  useLayoutEffect(() => {
    completedRendererIdRef.current = initiallyCompleted
      ? `${entryKey}:${renderer.instanceId}`
      : null;
    missingAssetRef.current = null;
    clearCompletionTimer();
    return () => clearCompletionTimer(renderer.instanceId);
  }, [clearCompletionTimer, entryKey, initiallyCompleted, renderer.instanceId]);

  useLayoutEffect(() => {
    if (!assetId || progressRef.current?.identity === playbackIdentity) return;
    const saved = activePlaybackState.checkpoint;
    const isStill = Boolean(media?.variant.mediaType?.toLowerCase().startsWith("image/"));
    const durationMs =
      saved?.durationMs ?? (isStill ? stillDurationMs(clip!) : (media?.variant.durationMs ?? 0));
    const checkpoint: ExperienceMediaCheckpoint = {
      rendererInstanceId: renderer.instanceId,
      sequenceIndex,
      assetId,
      mediaSignature: mediaPlaybackSignature(manifest, assetId),
      positionMs:
        saved?.positionMs ??
        (terminalMode?.kind === "loop" ? (terminalMode.clipStartTime ?? 0) * 1_000 : 0),
      watchedUntilMs: watchedAssetIds.includes(assetId)
        ? durationMs
        : Math.min(durationMs, Math.max(saved?.watchedUntilMs ?? 0, knownWatchedUntilMs)),
      durationMs,
      isStill,
      terminalMode,
      remainingHoldMs: saved?.remainingHoldMs ?? null,
      completed: saved?.completed ?? false,
    };
    progressRef.current = {
      identity: playbackIdentity,
      checkpoint,
      observedAt: storyClock.now(),
      observedPosition: checkpoint.positionMs,
      seeking: false,
      sent: null,
    };
    emitProgress(playbackIdentity);
    // The snapshot initializes a source once. Callback/manifest object changes
    // must never move a running segment back to its saved position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackIdentity]);

  useEffect(
    () => storyClock.subscribe(() => emitProgress(playbackIdentity)),
    [emitProgress, playbackIdentity, storyClock]
  );

  useEffect(() => {
    const missingAssetKey = `${renderer.instanceId}:${assetId}`;
    if (media || !assetId || missingAssetRef.current === missingAssetKey) return;
    missingAssetRef.current = missingAssetKey;
    onRuntimeError(copy.mediaError(assetId));
  }, [assetId, copy, media, onRuntimeError, renderer.instanceId]);

  const completeRenderer = () => {
    const key = `${entryKey}:${renderer.instanceId}`;
    if (
      completedRendererIdRef.current === key ||
      progressRef.current?.identity !== playbackIdentity
    )
      return;
    completedRendererIdRef.current = key;
    progressRef.current.checkpoint.completed = true;
    emitProgress(playbackIdentity);
    onCompletedRef.current();
  };
  const advanceSequence = () => {
    if (sequenceIndex + 1 < config.sequence.length) {
      setPlaybackState({
        entryKey,
        rendererInstanceId: renderer.instanceId,
        sequenceIndex: sequenceIndex + 1,
        terminalMode: null,
      });
      return;
    }
    completeRenderer();
  };
  // Story time: a pause holds the frame on screen for exactly the time it had left.
  const scheduleCompletion = (durationMs: number) => {
    clearCompletionTimer();
    const rendererInstanceId = renderer.instanceId;
    const dueAt = storyClock.now() + durationMs;
    const id = storyClock.setTimeout(() => {
      const timer = completionTimerRef.current;
      if (!timer || timer.id !== id || timer.rendererInstanceId !== rendererInstanceId) return;
      completionTimerRef.current = null;
      storyClock.clearTimer(timer.progressTimerId);
      if (progressRef.current?.identity === playbackIdentity) {
        progressRef.current.checkpoint.remainingHoldMs = 0;
        emitProgress(playbackIdentity);
      }
      advanceSequence();
    }, durationMs);
    const progressTimerId = storyClock.setInterval(
      () => emitProgress(playbackIdentity),
      STILL_CLOCK_TICK_MS
    );
    completionTimerRef.current = {
      id,
      rendererInstanceId,
      identity: playbackIdentity,
      dueAt,
      progressTimerId,
    };
    emitProgress(playbackIdentity);
  };
  const scheduleCompletionRef = useRef(scheduleCompletion);
  scheduleCompletionRef.current = scheduleCompletion;
  useEffect(() => {
    const saved = activePlaybackState.checkpoint;
    if (terminalMode?.kind === "held" && saved?.remainingHoldMs != null && !saved.completed)
      scheduleCompletionRef.current(saved.remainingHoldMs);
    // Restore a terminal hold once per renderer entry, without repeating its end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryKey, renderer.instanceId]);
  const handleEnd = () => {
    if (
      !clip ||
      terminalMode !== null ||
      progressRef.current?.identity !== playbackIdentity ||
      progressRef.current.checkpoint.completed
    )
      return;
    const behavior = clip.endBehavior;
    if (behavior.behavior === "advance") return advanceSequence();
    if (behavior.behavior === "hold-last-frame") {
      setPlaybackState({
        entryKey,
        rendererInstanceId: renderer.instanceId,
        sequenceIndex,
        terminalMode: { kind: "held" },
        checkpoint: {
          ...progressRef.current.checkpoint,
          terminalMode: { kind: "held" },
          remainingHoldMs: behavior.durationMs ?? null,
        },
      });
      progressRef.current.checkpoint.terminalMode = { kind: "held" };
      if (behavior.durationMs !== undefined) {
        scheduleCompletion(behavior.durationMs);
      }
      return;
    }
    if (behavior.behavior === "loop") {
      setPlaybackState({
        entryKey,
        rendererInstanceId: renderer.instanceId,
        sequenceIndex,
        terminalMode: { kind: "loop", assetId: behavior.assetId },
      });
      return;
    }
    const durationSeconds = media?.variant.durationMs ? media.variant.durationMs / 1_000 : 0;
    setPlaybackState({
      entryKey,
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
  const initialPositionMs =
    progressRef.current?.identity === playbackIdentity
      ? progressRef.current.checkpoint.positionMs
      : activePlaybackState.checkpoint?.positionMs;
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
      initialPositionMs={initialPositionMs}
      resumeDisplayed={terminalMode?.kind === "held"}
      onPositionMs={recordPosition}
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
      initialTimeSeconds={initialPositionMs === undefined ? undefined : initialPositionMs / 1_000}
      playbackRate={playbackRate}
      clipStartTime={terminalMode?.kind === "loop" ? terminalMode.clipStartTime : undefined}
      poster={poster}
      fit={config.fit === "native" ? "contain" : config.fit}
      onEnd={handleEnd}
      onTimeUpdate={(seconds) => {
        recordPosition(Math.round(seconds * 1_000));
        onTimelineTimeMs(timelineOffsetMs + Math.round(seconds * 1_000));
      }}
      onDurationChange={(seconds) => {
        const progress = progressRef.current;
        if (progress?.identity !== playbackIdentity) return;
        progress.checkpoint.durationMs = Math.round(seconds * 1_000);
        progress.checkpoint.positionMs = Math.min(
          progress.checkpoint.positionMs,
          progress.checkpoint.durationMs
        );
        progress.checkpoint.watchedUntilMs = watchedAssetIds.includes(assetId)
          ? progress.checkpoint.durationMs
          : Math.min(
              Math.max(progress.checkpoint.watchedUntilMs, knownWatchedUntilMs),
              progress.checkpoint.durationMs
            );
        emitProgress(playbackIdentity);
      }}
      onPlaybackError={(message) => onRuntimeError(message?.trim() || copy.mediaError(assetId))}
      onPlaybackHandle={registerPlaybackHandle}
      onPlaybackInterrupted={onPlaybackInterrupted}
      onPlaybackRefused={onPlaybackRefused}
      onSoundBlocked={onSoundBlocked}
      onContentSize={onContentSize}
      playbackIdentity={playbackIdentity}
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
 * and from then on reports elapsed story time so the scene clock keeps
 * advancing and time-anchored interactions stay live. Its screen time is the
 * clip's `hold-last-frame` duration, still owned by the sequence above.
 */
function ExperienceStillSegment({
  uri,
  title,
  fit,
  durationMs,
  timelineOffsetMs,
  playbackIdentity,
  initialPositionMs = 0,
  resumeDisplayed = false,
  onPositionMs,
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
  initialPositionMs?: number;
  resumeDisplayed?: boolean;
  onPositionMs: (positionMs: number, natural?: boolean) => void;
  onDisplayed: () => void;
  onTimelineTimeMs: (timeMs: number) => void;
  onPlaybackHandle: (handle: ExperienceMediaPlaybackHandle | null) => void;
}) {
  const storyClock = useContext(ExperienceStoryClockContext);
  const displayedRef = useRef(false);
  const elapsedMsRef = useRef(0);
  const runningSinceRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const onDisplayedRef = useRef(onDisplayed);
  onDisplayedRef.current = onDisplayed;
  const onTimelineTimeMsRef = useRef(onTimelineTimeMs);
  onTimelineTimeMsRef.current = onTimelineTimeMs;
  const onPositionMsRef = useRef(onPositionMs);
  onPositionMsRef.current = onPositionMs;

  const stopTicking = useCallback(() => {
    if (tickRef.current === null) return;
    storyClock.clearTimer(tickRef.current);
    tickRef.current = null;
  }, [storyClock]);

  // The clock outlives handle registration: the sequence deregisters the
  // handle the moment this clip enters its terminal hold, which is exactly
  // when the still is on screen and the scene clock must keep running. Only
  // the story clock reaches it from then on, so it ticks on story time.
  useLayoutEffect(() => {
    displayedRef.current = resumeDisplayed;
    elapsedMsRef.current = Math.max(0, Math.min(initialPositionMs, durationMs));
    runningSinceRef.current = resumeDisplayed ? storyClock.now() : null;
    return () => {
      stopTicking();
    };
    // Initial resume state belongs to the source, never to a parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackIdentity, stopTicking]);

  const startTicking = useCallback(() => {
    stopTicking();
    tickRef.current = storyClock.setInterval(() => {
      const elapsed =
        elapsedMsRef.current +
        (runningSinceRef.current === null ? 0 : storyClock.now() - runningSinceRef.current);
      const now = Math.min(elapsed, durationMs);
      onPositionMsRef.current(now);
      onTimelineTimeMsRef.current(timelineOffsetMs + now);
      if (now >= durationMs) stopTicking();
    }, STILL_CLOCK_TICK_MS);
  }, [durationMs, stopTicking, storyClock, timelineOffsetMs]);
  useEffect(() => {
    if (displayedRef.current && runningSinceRef.current !== null) startTicking();
    return stopTicking;
  }, [playbackIdentity, startTicking, stopTicking]);
  useEffect(
    () =>
      storyClock.subscribe(() => {
        if (runningSinceRef.current === null) return;
        const now = Math.min(
          elapsedMsRef.current + storyClock.now() - runningSinceRef.current,
          durationMs
        );
        onPositionMsRef.current(now);
        onTimelineTimeMsRef.current(timelineOffsetMs + now);
      }),
    [durationMs, storyClock, timelineOffsetMs]
  );

  useEffect(() => {
    let disposed = false;
    const elapsed = () =>
      elapsedMsRef.current +
      (runningSinceRef.current === null ? 0 : storyClock.now() - runningSinceRef.current);
    const handle: ExperienceMediaPlaybackHandle = {
      playbackIdentity,
      // No element, so nothing for a tap to unlock — and nothing to start over:
      // a still played again picks its clock up where it stopped.
      playInGesture: () => null,
      ended: () => false,
      element: () => null,
      play: async () => {
        if (disposed) return;
        if (runningSinceRef.current === null) {
          runningSinceRef.current = storyClock.now();
          startTicking();
        }
        if (displayedRef.current) return;
        displayedRef.current = true;
        onPositionMsRef.current(elapsedMsRef.current);
        onTimelineTimeMsRef.current(timelineOffsetMs + elapsedMsRef.current);
        onDisplayedRef.current();
      },
      pause: () => {
        if (disposed || runningSinceRef.current === null) return;
        elapsedMsRef.current = elapsed();
        onPositionMsRef.current(Math.min(elapsedMsRef.current, durationMs));
        runningSinceRef.current = null;
        stopTicking();
      },
      seek: (seconds) => {
        if (disposed || !Number.isFinite(seconds) || seconds < 0) return;
        const target = Math.max(0, Math.min(seconds * 1_000, durationMs));
        elapsedMsRef.current = target;
        if (runningSinceRef.current !== null) runningSinceRef.current = storyClock.now();
        onPositionMsRef.current(target, false);
        onTimelineTimeMsRef.current(timelineOffsetMs + target);
      },
      // A still carries no audio track, so muting is a no-op rather than an
      // error — the host mutes every registered handle uniformly.
      setMuted: () => undefined,
      // The shared story clock drives still speed, including a terminal hold.
      setPlaybackRate: () => undefined,
    };
    onPlaybackHandle(handle);
    return () => {
      disposed = true;
      onPlaybackHandle(null);
    };
  }, [
    durationMs,
    onPlaybackHandle,
    playbackIdentity,
    startTicking,
    stopTicking,
    storyClock,
    timelineOffsetMs,
  ]);

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
  formatPrice,
}: {
  formatPrice?: (amount: number) => string;
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
  const promptText = config.prompt
    ? localize(config.prompt, locale, manifest.localization.defaultLocale).trim()
    : "";
  const choices = config.choices.filter(
    (choice) =>
      !choice.visibleWhen ||
      evaluateExperienceCondition(choice.visibleWhen, runtimeState, {
        type: "runtime.visibility",
      })
  );
  // Sized off the film frame, never the window: the stage is a size container,
  // so `cq*` units here are fractions of the picture the choices sit on. A phone
  // held sideways and a desktop monitor show the same composition, scaled.
  // `cqmin` is the frame's short side — its height for a landscape film — so a
  // portrait film keeps the same proportions; every clamp keeps the text legible
  // and the tap target at least 44px.
  return (
    <div
      role="group"
      aria-labelledby={promptText ? promptId : undefined}
      data-experience-choice-overlay=""
      className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-linear-to-t from-black/80 via-black/45 to-transparent px-[clamp(12px,3cqw,40px)] pt-[clamp(24px,10cqmin,96px)] pb-[max(clamp(10px,2.5cqmin,22px),var(--experience-choice-control-clearance,0px))]"
      style={{ zIndex: renderer.layer }}
    >
      <div className="pointer-events-auto w-full max-w-[86cqw]">
        {promptText ? (
          <p
            id={promptId}
            className="mb-[0.75em] text-center text-[length:clamp(12px,2cqmin,16px)] leading-[1.45] font-medium tracking-[0.04em] text-balance text-white/70"
          >
            {promptText}
          </p>
        ) : null}
        {choices.length > 0 ? (
          <div className="flex flex-row items-stretch justify-center gap-[clamp(8px,1.2cqw,16px)]">
            {choices.map((choice, index) => {
              const requirement = manifest.graph.nodes
                .flatMap((node) => node.eventBindings)
                .filter(
                  (binding) =>
                    binding.on.type === "renderer.outcome" &&
                    binding.on.sourceId === renderer.instanceId &&
                    binding.on.qualifierId === "choice-selected"
                )
                .flatMap((binding) => binding.routes)
                .find(
                  (route) =>
                    !route.when ||
                    evaluateExperienceCondition(route.when, runtimeState, {
                      type: "renderer.outcome",
                      sourceId: renderer.instanceId,
                      qualifierId: "choice-selected",
                      payload: { choiceId: choice.choiceId },
                    })
                )?.access;
              const price =
                requirement && formatPrice ? formatPrice(requirement.communityPointPrice) : null;
              return (
                <button
                  key={choice.choiceId}
                  type="button"
                  onClick={() => onSelect(choice.choiceId)}
                  className={classNames(
                    // Inner proportions are in `em` of the label, so the badge,
                    // the price and the corners scale with the clamped text.
                    "group flex min-h-[clamp(44px,7cqmin,56px)] min-w-0 max-w-[clamp(140px,40cqmin,420px)] flex-1 basis-0 items-center gap-[0.75em] rounded-[1.05em] border px-[clamp(10px,1.5cqw,20px)] py-[0.45em] text-left text-[length:clamp(13px,2.2cqmin,18px)] leading-[1.3] font-medium text-white",
                    "bg-white/10 shadow-[0_10px_32px_rgba(0,0,0,0.28)] backdrop-blur-xl",
                    "transition-[background-color,border-color,transform] duration-200",
                    "hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none active:scale-[0.99]",
                    price ? undefined : "border-white/15 hover:border-white/30"
                  )}
                  style={
                    price
                      ? {
                          borderColor:
                            "color-mix(in srgb, var(--brand-yellow, #ffd84d) 45%, transparent)",
                        }
                      : undefined
                  }
                  aria-label={
                    choice.accessibilityLabel
                      ? localize(
                          choice.accessibilityLabel,
                          locale,
                          manifest.localization.defaultLocale
                        )
                      : undefined
                  }
                >
                  <span className="grid size-[2.2em] shrink-0 place-items-center rounded-full border border-white/15 bg-white/10 text-[0.73em] leading-none font-semibold text-white/60 tabular-nums group-hover:border-white/30 group-hover:text-white">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 wrap-anywhere">
                    {localize(choice.label, locale, manifest.localization.defaultLocale)}
                  </span>
                  {price ? (
                    <span
                      className="flex max-w-[42%] shrink-0 items-center gap-[0.3em] text-[0.8em] leading-[1.3] font-medium tabular-nums"
                      style={{ color: "var(--brand-yellow, #ffd84d)" }}
                    >
                      <IconLock className="size-[1.15em] shrink-0" stroke={1.8} aria-hidden />
                      {price}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p
            role="alert"
            className="text-center text-[length:clamp(11px,2cqmin,16px)] text-white/52"
          >
            {copy.noVisibleChoices}
          </p>
        )}
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
 * Two layers. The film frame — media, spatial cues, choices, the paused frame
 * and the frame's controls — sits in a landscape viewport that turns as one
 * unit when the frame is drawn sideways (see shouldRotateFrame), so a phone held
 * sideways sees the picture and everything on it the same way up. System UI
 * that is not part of the picture — title card, access gates, ending, errors —
 * sits in the viewport overlay above it and never turns.
 *
 * The cinematic stage keeps the authored aspect ratio and fits inside that
 * landscape viewport (letterboxed), so the whole frame stays visible and fills
 * whichever side it can. It is also the size container the frame's own UI is
 * measured against (`container-name: experience-frame`). The narrative stage
 * is responsive instead, so long-form text owns the available reading
 * viewport. Renderer selection remains entirely manifest-driven in both
 * profiles; only the shell's measured box decides the fit, never the window.
 *
 * The stage also carries what the frame's controls need to keep clear of the
 * host's chrome (see ExperienceFrameControls): `--experience-frame-inset-top`,
 * the band above the picture, and — when the frame is turned, so its top runs
 * down the side of the screen, or the player has the screen to itself — a
 * `--experience-chrome-inset-top` of zero over whatever the host set.
 */
function PlayerFrame({
  shellRef,
  orientation,
  experienceProfile,
  stageProfile,
  rotated,
  fullscreen,
  copy,
  style,
  stage,
  onStageTap,
  activityHandlers,
  cornerControls,
  children,
}: {
  shellRef: React.RefObject<HTMLDivElement | null>;
  orientation: ExperienceOrientation;
  experienceProfile: ExperienceProfile;
  stageProfile: ExperienceProfile;
  /** Draw the frame sideways — decided by the device, see shouldRotateFrame. */
  rotated: boolean;
  /** The player holds the screen: no host chrome shows around it. */
  fullscreen: boolean;
  copy: ExperiencePlayerCopy;
  style?: CSSProperties;
  stage: React.ReactNode;
  /** A tap the picture did not answer pauses the film; see `pauseOnStageTap`. */
  onStageTap?: (event: MouseEvent<HTMLDivElement>) => void;
  activityHandlers?: Pick<
    DOMAttributes<HTMLDivElement>,
    "onPointerMove" | "onPointerDownCapture" | "onKeyDownCapture"
  >;
  cornerControls: ReactNode;
  children: React.ReactNode;
}) {
  const shellSize = useShellSize(shellRef);
  const cornerRef = useRef<HTMLDivElement>(null);
  const [cornerHeight, setCornerHeight] = useState(0);
  useLayoutEffect(() => {
    const element = cornerRef.current;
    if (!element) return;
    const measure = () => setCornerHeight(Math.ceil(element.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const aspect = STAGE_ASPECT[orientation];
  // Turned only once the shell has been measured, so the frame never spends a
  // paint rotated at the wrong size.
  const turned = rotated && shellSize !== null;
  let viewportStyle: CSSProperties = { width: "100%", height: "100%" };
  let stageStyle: CSSProperties = { width: "100%", height: "100%" };
  let frameInsetTop = 0;
  if (shellSize) {
    const viewportWidth = turned ? shellSize.height : shellSize.width;
    const viewportHeight = turned ? shellSize.width : shellSize.height;
    viewportStyle = { width: viewportWidth, height: viewportHeight };
    if (stageProfile === "cinematic") {
      const width = Math.min(viewportWidth, viewportHeight * aspect);
      const height = Math.round(width / aspect);
      stageStyle = { width: Math.round(width), height };
      if (!turned) frameInsetTop = Math.max(0, (viewportHeight - height) / 2);
    }
  }
  const chromeInsets: Record<`--${string}`, string> = {
    "--experience-frame-inset-top": `${frameInsetTop}px`,
    "--experience-player-corner-height":
      !turned && cornerHeight > 0 ? `calc(${cornerHeight}px + 1.5rem)` : "0px",
    ...(turned || fullscreen ? { "--experience-chrome-inset-top": "0px" } : {}),
  };
  return (
    <div
      ref={shellRef}
      role="region"
      aria-label={copy.regionLabel}
      // Keep the fitted stage from scrolling the shell when focus moves.
      style={{ ...style, overflow: "clip" }}
      data-experience-profile={experienceProfile}
      data-experience-stage-profile={stageProfile}
      className="relative isolate h-full min-h-[inherit] w-full bg-[var(--experience-color-background,#000)] text-[var(--experience-color-text,#fff)]"
      {...activityHandlers}
    >
      <div
        data-experience-landscape-viewport=""
        data-experience-frame-rotated={turned ? "" : undefined}
        className="absolute left-1/2 top-1/2 isolate z-0"
        style={{
          ...viewportStyle,
          transform: turned ? "translate(-50%, -50%) rotate(90deg)" : "translate(-50%, -50%)",
        }}
      >
        <div
          data-experience-media-stage=""
          className="absolute left-1/2 top-1/2 isolate"
          onClick={onStageTap}
          style={{
            ...stageStyle,
            ...chromeInsets,
            transform: "translate(-50%, -50%)",
            containerType: "size",
            containerName: "experience-frame",
          }}
        >
          <ExperienceFrameRotationContext.Provider value={turned}>
            {stage}
          </ExperienceFrameRotationContext.Provider>
        </div>
      </div>
      <div
        data-experience-viewport-overlay=""
        className="pointer-events-none absolute inset-0 isolate z-10"
        style={
          fullscreen ? ({ "--experience-chrome-inset-top": "0px" } as CSSProperties) : undefined
        }
      >
        <div
          ref={cornerRef}
          data-experience-corner-controls=""
          className="absolute right-[max(0.75rem,env(safe-area-inset-right))] flex max-w-[calc(100%_-_1.5rem)] flex-col items-end gap-2"
          style={{
            top: "calc(max(var(--experience-chrome-inset-top, 0px), env(safe-area-inset-top)) + 0.75rem)",
            zIndex: EXPERIENCE_RENDERER_MAX_LAYER + 5,
          }}
        >
          {cornerControls}
        </div>
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
  if (gesture?.holdFrame) return 0;
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
 * Warms what the viewer can reach next, one opening at a time, while the
 * current clip plays.
 *
 * An interactive film has several possible "next" clips, and loading them all
 * — or loading any before Start — spends the viewer's bandwidth on branches
 * they may never enter while the clip they did choose competes for it. So the
 * look-ahead runs only after Start, walks the plan strictly in order, fetches
 * only each clip's opening (see warmExperienceMedia), and skips anything
 * already on stage or already warm. A new scene replaces the plan and aborts
 * whatever was in flight. A failed warm-up is noted and passed over: the stage's
 * own element stays the authority, and reports an error only if that clip is
 * actually played.
 */
function useMediaLookAhead({
  manifest,
  sceneId,
  orientation,
  canAccess,
  delivery,
  enabled,
}: {
  manifest: ExperienceRuntimeManifest;
  sceneId: string;
  orientation: ExperienceOrientation;
  canAccess: (requirement: ExperienceAccessRequirement) => boolean;
  delivery: ExperiencePlaybackDelivery;
  enabled: boolean;
}): void {
  const plan = useMemo(
    () => resolveLookAheadVideoMedia(manifest, sceneId, orientation, canAccess),
    [canAccess, manifest, orientation, sceneId]
  );
  useEffect(() => {
    if (!enabled || plan.length === 0) return;
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      for (const media of plan) {
        if (signal.aborted) return;
        if (delivery.hasStagedOrWarmed(media.src)) {
          debugTrace(`look-ahead skipped ${media.src}`);
          continue;
        }
        try {
          await warmExperienceMedia(media, delivery, signal);
          delivery.markWarmed(media.src);
          debugTrace(`look-ahead warmed ${media.src}`);
        } catch {
          if (signal.aborted) {
            debugTrace(`look-ahead aborted ${media.src}`);
            return;
          }
          debugTrace(`look-ahead failed ${media.src}`);
        }
      }
    })();
    return () => controller.abort();
  }, [delivery, enabled, plan]);
}

/**
 * The clips worth warming from a scene, in the order they are likely needed:
 * the rest of the current scene's sequences first, then the opening clip of
 * every scene one `scene.goto` away. Routes and scenes the viewer cannot
 * access are skipped, as is a goto back into the current scene. Stills are not
 * media to warm, and each URI appears once. Routers and conditions are not
 * evaluated — the compiler emits plain gotos, and a wrong guess only costs one
 * opening.
 */
export function resolveLookAheadVideoMedia(
  manifest: ExperienceRuntimeManifest,
  sceneId: string,
  orientation: ExperienceOrientation,
  canAccess: (requirement: ExperienceAccessRequirement) => boolean = () => false
): ExperienceDeclaredSource[] {
  const current = findGraphNode(manifest, sceneId);
  if (!current || current.kind !== "scene") return [];
  const plan: ExperienceDeclaredSource[] = [];
  const planned = new Set<string>();
  const add = (assetId: string) => {
    const media = resolveVideoMedia(manifest.assets, assetId, orientation);
    if (!media) return;
    const type = media.variant.mediaType ?? null;
    if (type?.toLowerCase().startsWith("image/") || planned.has(media.variant.uri)) return;
    planned.add(media.variant.uri);
    plan.push({ src: media.variant.uri, type });
  };
  videoSequences(current).forEach((sequence) => sequence.forEach((clip) => add(clip.assetId)));
  current.eventBindings.forEach((binding) =>
    binding.routes.forEach((route) => {
      if (route.access && !canAccess(route.access)) return;
      route.actions.forEach((action) => {
        if (action.kind !== "scene.goto" || action.sceneId === sceneId) return;
        const target = findGraphNode(manifest, action.sceneId);
        if (!target || target.kind !== "scene") return;
        if (target.access && !canAccess(target.access)) return;
        videoSequences(target).forEach((sequence) => {
          const opening = sequence[0];
          if (opening) add(opening.assetId);
        });
      });
    })
  );
  return plan;
}

/** Each `core.video` renderer's sequence in a scene, in renderer order. */
function videoSequences(
  scene: Extract<ExperienceGraphNode, { kind: "scene" }>
): ExperienceCoreVideoRendererConfig["sequence"][] {
  return scene.renderers.flatMap((renderer) => {
    if (renderer.rendererId !== EXPERIENCE_CORE_VIDEO_RENDERER_ID) return [];
    const parsed = ExperienceCoreVideoRendererConfigSchema.safeParse(renderer.config);
    return parsed.success ? [parsed.data.sequence] : [];
  });
}

export function resolveLockedScenePreview(
  manifest: ExperienceRuntimeManifest,
  node: ExperienceGraphNode,
  orientation: ExperienceOrientation
): { videoUri?: string; posterUri?: string } {
  if (node.kind !== "scene") return {};
  const renderer = node.renderers.find(
    (item) => item.rendererId === EXPERIENCE_CORE_VIDEO_RENDERER_ID
  );
  const parsed = ExperienceCoreVideoRendererConfigSchema.safeParse(renderer?.config);
  if (!parsed.success) return {};
  const first = parsed.data.sequence[0];
  if (!first) return {};
  const videoUri = resolveVideoMedia(manifest.assets, first.assetId, orientation)?.variant.uri;
  // Frozen public media has a separate image-only endpoint. Never fetch the
  // protected video to produce an anonymous preview in the browser.
  const posterUri = videoUri ? (buildMediaEndpoint(videoUri, "poster") ?? undefined) : undefined;
  return { videoUri, posterUri };
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

/** A rejection as one trace line: its name, which is what classifies it, then its prose. */
function describeRejection(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const { name, message } = error as { name?: unknown; message?: unknown };
  return `${String(name)}: ${String(message)}`;
}

/**
 * A run that starts at `sceneId` instead of the story's entry: a fresh state
 * moved there, and the entry event `start()` would have dispatched for it.
 */
function sceneEntryCheckpoint(
  manifest: ExperienceRuntimeManifest,
  sceneId: string,
  randomSeed: string
): ExperienceAccessCheckpoint {
  return {
    state: { ...initializeExperienceRuntime(manifest, { randomSeed }), currentSceneId: sceneId },
    events: [{ type: "scene.entered", sourceId: sceneId, payload: {} }],
  };
}

/**
 * A live stream's element as a playback handle, so it is played and held like
 * a clip: inside the viewer's taps, and with the story. Live, it has nothing to
 * seek and never ends on the element.
 */
function liveStreamPlaybackHandle(
  identity: string,
  element: HTMLMediaElement
): ExperienceMediaPlaybackHandle {
  return {
    playbackIdentity: identity,
    playInGesture: () => element.play(),
    play: () => element.play(),
    pause: () => element.pause(),
    seek: () => undefined,
    setPlaybackRate: () => undefined,
    setMuted: (muted) => {
      element.muted = muted;
    },
    ended: () => false,
    element: () => element,
  };
}

/**
 * Points the OS media controls at the story, or clears them. Seeking is never
 * offered: the story's clip is not the viewer's to scrub. Each action is set on
 * its own, because a browser throws for one it does not support.
 */
function setMediaSessionHandlers(handlers: { play: () => void; pause: () => void } | null): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  const actions: [MediaSessionAction, MediaSessionActionHandler | null][] = [
    ["play", handlers?.play ?? null],
    ["pause", handlers?.pause ?? null],
    ["seekto", null],
    ["seekforward", null],
    ["seekbackward", null],
  ];
  for (const [action, handler] of actions) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // An action this browser does not support is one nothing can trigger.
    }
  }
}

/**
 * What takes Space for itself, and so never toggles the film: native and ARIA
 * controls activate on it — a focused choice is chosen, the toggle and the
 * paused frame are pressed, a press-hold hotspot is held — and a text scene
 * scrolls by it.
 */
const SPACE_KEEPERS = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "[contenteditable]",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role^="menuitem"]',
  '[role="option"]',
  '[role="tab"]',
  `[data-experience-renderer="${EXPERIENCE_CORE_TEXT_RENDERER_ID}"]`,
].join(", ");

/**
 * Whether a key press toggles the film: a bare Space nothing has taken yet,
 * pressed on the page itself or inside the player — never in host UI around
 * it, such as an authoring composer or a host dialog.
 */
function isPlaybackToggleKey(event: KeyboardEvent, shell: HTMLElement | null): boolean {
  if (event.key !== " " || event.repeat || event.isComposing || event.defaultPrevented) {
    return false;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const target = event.target;
  if (!shell || !(target instanceof Element)) return false;
  if (target !== document.body && !shell.contains(target)) return false;
  return target.closest(SPACE_KEEPERS) === null;
}

/** The element focused inside `container`, if focus is there. */
function focusedWithin(container: HTMLElement | null): HTMLElement | null {
  const focused = document.activeElement;
  return focused instanceof HTMLElement && container?.contains(focused) ? focused : null;
}

/**
 * Whether the player may move focus: it rests on nothing in particular (the
 * page itself), or is already inside the player. Focus in host UI around the
 * player — an authoring composer, a dialog — is the viewer's, and stays put.
 */
function focusIsFree(shell: HTMLElement | null): boolean {
  const focused = document.activeElement;
  return !focused || focused === document.body || Boolean(shell?.contains(focused));
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
