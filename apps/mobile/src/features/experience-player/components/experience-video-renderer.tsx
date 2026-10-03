import { usePausableTimeout } from "../hooks/use-pausable-timeout";
import { ExperienceStillSegment } from "./experience-still-segment";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView } from "./experience-video-platform";
import type { VideoContentFit, VideoSource } from "expo-video";

import {
  ExperienceCoreVideoRendererConfigSchema,
  type ExperienceRendererInstance,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";

import { useGatedScreenActive } from "@/hooks/use-app-active";

import { resolveExperienceVideoSource } from "../lib/experience-playback-delivery";
import {
  invalidatePlayableMediaUrl,
  isStillVideoVariant,
  resolveVideoMedia,
  sequenceTimelineOffsetMs,
  stillClipDurationMs,
  EXPERIENCE_PLAY_ORIENTATION,
} from "../lib/experience-media";
import type { ExperiencePlayerCopy } from "../lib/experience-player-copy";

type CoreVideoTerminalMode =
  | { kind: "held"; frameTimeSeconds: number }
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

const EMPTY_SEQUENCE_HOLD_MS = 6_000;
/** How often a still reports elapsed time, matching a video's timeupdate rate. */

/**
 * Imperative expo-video control lives outside the component so React Compiler
 * does not treat mutations of the hook-returned player as render-time
 * immutability violations. VideoPlayer is a mutable native host by design.
 */
async function loadAndPlayClip(
  player: {
    loop: boolean;
    currentTime: number;
    replaceAsync: (uri: VideoSource) => Promise<void>;
    play: () => void;
  },
  options: {
    sourceUri: string;
    isLooping: boolean;
    clipStartTime?: number;
    shouldAutoplay: boolean;
    /**
     * Read *after* the loads resolve, never snapshotted: the app can background
     * or the screen can be left during the URL resolve / `replaceAsync` round
     * trip, and starting playback then would run a clip nobody can see.
     */
    isPresenting: () => boolean;
    onDeferredAutoplay: () => void;
    onPlayableResolved: (playableUri: string) => void;
    signal: AbortSignal;
  }
): Promise<void> {
  player.loop = options.isLooping;
  const playable = await resolveExperienceVideoSource(options.sourceUri, options.signal);
  if (options.signal.aborted) return;
  options.onPlayableResolved(playable.uri);
  await player.replaceAsync(playable);
  if (options.signal.aborted) return;
  if (options.clipStartTime !== undefined) {
    player.currentTime = options.clipStartTime;
  }
  if (!options.shouldAutoplay) return;
  if (!options.isPresenting()) {
    options.onDeferredAutoplay();
    return;
  }
  player.play();
}

/** Native player properties are mutable host state, not React render state. */
function restoreHeldFrame(player: { currentTime: number }, seconds: number) {
  player.currentTime = seconds;
}

function EmptyVideoSequencePlaceholder({ label }: { label: string }) {
  return (
    <View style={styles.emptySequence}>
      <Text style={styles.emptySequenceLabel}>{label}</Text>
    </View>
  );
}

export type ExperienceMediaPlaybackHandle = {
  readonly playbackIdentity: string;
  play(options?: { userGesture?: boolean }): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
};

export function ExperienceVideoRenderer({
  manifest,
  renderer,
  copy,
  onTimelineTimeMs,
  onCompleted,
  onRuntimeError,
  onPlaybackHandle,
  onPlaybackRefused,
  onPlaybackInterrupted,
}: {
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  copy: ExperiencePlayerCopy;
  onTimelineTimeMs: (timeMs: number) => void;
  onCompleted: () => void;
  onRuntimeError: (message: string) => void;
  onPlaybackRefused?: () => void;
  onPlaybackInterrupted?: () => void;
  onPlaybackHandle?: (instanceId: string, handle: ExperienceMediaPlaybackHandle | null) => void;
}) {
  const config = ExperienceCoreVideoRendererConfigSchema.parse(renderer.config);
  const [playbackState, setPlaybackState] = useState<CoreVideoPlaybackState>(() =>
    initialCoreVideoPlaybackState(renderer.instanceId)
  );
  // Reset sequence when the renderer instance changes (same component, new scene).
  const [playbackRendererId, setPlaybackRendererId] = useState(renderer.instanceId);
  if (renderer.instanceId !== playbackRendererId) {
    setPlaybackRendererId(renderer.instanceId);
    setPlaybackState(initialCoreVideoPlaybackState(renderer.instanceId));
  }
  const { sequenceIndex, terminalMode } = playbackState;
  const completedRendererIdRef = useRef<string | null>(null);
  const missingAssetRef = useRef<string | null>(null);
  /** Resume playback when the screen is presentable again if we paused for it. */
  const resumeWhenPresentingRef = useRef(false);
  const expectedPauseRef = useRef(false);
  /** What the player was actually handed: local file or signed remote URL. */
  const playableUriRef = useRef<string | null>(null);
  const retriedIdentityRef = useRef<string | null>(null);
  /** Where a re-signed reload should pick the shot back up. */
  const resumeAtSecondsRef = useRef<number | null>(null);
  const [reloadEpoch, setReloadEpoch] = useState(0);

  const clip = config.sequence[sequenceIndex];
  const assetId = terminalMode?.kind === "loop" ? terminalMode.assetId : clip?.assetId;
  const media = assetId
    ? resolveVideoMedia(manifest.assets, assetId, EXPERIENCE_PLAY_ORIENTATION)
    : null;
  const timelineOffsetMs = sequenceTimelineOffsetMs(
    manifest.assets,
    config,
    sequenceIndex,
    EXPERIENCE_PLAY_ORIENTATION
  );
  const playbackIdentity =
    terminalMode?.kind === "loop"
      ? `${renderer.instanceId}:${sequenceIndex}:loop:${assetId}:${terminalMode.clipStartTime ?? 0}`
      : `${renderer.instanceId}:${sequenceIndex}:sequence:${assetId}`;
  const sourceUri = media?.variant.uri ?? null;
  const contentFit: VideoContentFit =
    config.fit === "contain" || config.fit === "native" ? "contain" : "cover";
  const isStill = isStillVideoVariant(media?.variant.mediaType);
  const isLooping = terminalMode?.kind === "loop";
  const clipStartTime = terminalMode?.kind === "loop" ? terminalMode.clipStartTime : undefined;
  const shouldAutoplay = config.autoplay && terminalMode?.kind !== "held";
  const durationMs = media?.variant.durationMs;
  const sequenceLength = config.sequence.length;

  const player = useVideoPlayer(null, (instance) => {
    instance.timeUpdateEventInterval = 0.25;
    instance.loop = false;
    instance.staysActiveInBackground = false;
  });

  const presenting = useGatedScreenActive();
  const presentingRef = useRef(presenting);
  useEffect(() => {
    presentingRef.current = presenting;
  }, [presenting]);

  /**
   * Silence the player before it is released. `useVideoPlayer` releases on
   * unmount, but iOS only tears the `AVPlayer` down once its last native
   * reference drops — until then the clip keeps feeding the audio session, so
   * leaving the page is audible for as long as that takes. The layout-effect
   * cleanup is deliberate: it runs ahead of the passive cleanup that releases
   * the player, which is the only window where `pause()` is still valid. Clearing
   * the presenting ref here closes the same window from the other side: a clip
   * load that resolves between this cleanup and the passive one would otherwise
   * still see "presenting" and call `play()` on a player nobody is watching.
   */
  useLayoutEffect(() => {
    return () => {
      presentingRef.current = false;
      try {
        expectedPauseRef.current = true;
        player.pause();
      } catch {
        // Player already released — nothing left to silence.
      }
    };
  }, [player]);

  useEffect(() => {
    completedRendererIdRef.current = null;
    missingAssetRef.current = null;
  }, [renderer.instanceId]);

  useEffect(() => {
    const missingAssetKey = `${renderer.instanceId}:${assetId}`;
    if (media || !assetId || missingAssetRef.current === missingAssetKey) return;
    missingAssetRef.current = missingAssetKey;
    onRuntimeError(copy.mediaError(assetId));
  }, [assetId, copy, media, onRuntimeError, renderer.instanceId]);

  const completeRenderer = useCallback(() => {
    if (completedRendererIdRef.current === renderer.instanceId) return;
    completedRendererIdRef.current = renderer.instanceId;
    onCompleted();
  }, [onCompleted, renderer.instanceId]);

  const advanceSequence = useCallback(() => {
    if (sequenceIndex + 1 < sequenceLength) {
      setPlaybackState({
        rendererInstanceId: renderer.instanceId,
        sequenceIndex: sequenceIndex + 1,
        terminalMode: null,
      });
      return;
    }
    completeRenderer();
  }, [completeRenderer, renderer.instanceId, sequenceIndex, sequenceLength, setPlaybackState]);

  const handleEnd = useCallback(() => {
    if (!clip || terminalMode?.kind === "loop" || terminalMode?.kind === "held") return;
    const behavior = clip.endBehavior;
    if (behavior.behavior === "advance") {
      advanceSequence();
      return;
    }
    if (behavior.behavior === "hold-last-frame") {
      setPlaybackState({
        rendererInstanceId: renderer.instanceId,
        sequenceIndex,
        terminalMode: { kind: "held", frameTimeSeconds: player.currentTime },
      });
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
    const durationSeconds = durationMs ? durationMs / 1_000 : 0;
    setPlaybackState({
      rendererInstanceId: renderer.instanceId,
      sequenceIndex,
      terminalMode: {
        kind: "loop",
        assetId: clip.assetId,
        clipStartTime: Math.max(0, durationSeconds - behavior.tailSeconds),
      },
    });
  }, [
    advanceSequence,
    clip,
    durationMs,
    player,
    renderer.instanceId,
    sequenceIndex,
    terminalMode?.kind,
    setPlaybackState,
  ]);

  const continuePlayback = useEffectEvent(() => {
    resumeWhenPresentingRef.current = false;
    if (terminalMode?.kind === "held") return;
    const seconds =
      Number.isFinite(player.duration) && player.duration > 0
        ? player.duration
        : durationMs
          ? durationMs / 1000
          : 0;
    if (!isLooping && seconds > 0 && player.currentTime >= seconds - 0.08) {
      handleEnd();
      return;
    }
    player.play();
  });

  useEffect(() => {
    if (isStill) {
      if (player.playing) {
        try {
          expectedPauseRef.current = true;
          player.pause();
        } catch {
          // Player already released.
        }
      }
      return;
    }
    if (!presenting || !shouldAutoplay) {
      if (player.playing) {
        resumeWhenPresentingRef.current = true;
        expectedPauseRef.current = true;
        player.pause();
      }
      return;
    }
    if (!resumeWhenPresentingRef.current) return;
    resumeWhenPresentingRef.current = false;
    continuePlayback();
  }, [isStill, player, presenting, shouldAutoplay]);

  // Video hold duration lives in an effect so a remount (React Strict Mode,
  // scene identity churn) reschedules it. Stills own the same beat on their
  // own clock — a parent timeout here was cleared on remount while the still
  // stayed on screen, which froze shots like 凝视车票.
  const videoHoldMs =
    !isStill && terminalMode?.kind === "held" && clip?.endBehavior.behavior === "hold-last-frame"
      ? clip.endBehavior.durationMs
      : undefined;
  usePausableTimeout({
    identity: `${renderer.instanceId}:${sequenceIndex}`,
    enabled: videoHoldMs !== undefined,
    running: presenting,
    durationMs: videoHoldMs ?? 0,
    onTimeout: advanceSequence,
  });

  const reportTimeline = useEffectEvent((currentTime: number) => {
    onTimelineTimeMs(timelineOffsetMs + Math.round(currentTime * 1_000));
    if (isStill || terminalMode?.kind === "loop" || terminalMode?.kind === "held") return;
    const totalSeconds =
      Number.isFinite(player.duration) && player.duration > 0
        ? player.duration
        : durationMs
          ? durationMs / 1_000
          : 0;
    // iOS expo-video sometimes never emits `playToEnd` on a finished clip.
    if (totalSeconds > 0 && currentTime >= totalSeconds - 0.08) handleEnd();
  });

  /**
   * A streamed clip plays through a signed URL that can die between resolve and
   * the player's next range request, which surfaces as a generic playback error.
   * Re-sign and reload once before blaming the film — locally cached clips have
   * no signature to refresh, so those fail straight through.
   */
  const reportPlaybackError = useEffectEvent((message: string) => {
    const streamedRemotely =
      playableUriRef.current !== null && !playableUriRef.current.startsWith("file://");
    if (streamedRemotely && retriedIdentityRef.current !== playbackIdentity && sourceUri) {
      retriedIdentityRef.current = playbackIdentity;
      resumeAtSecondsRef.current = player.currentTime;
      invalidatePlayableMediaUrl(sourceUri);
      setReloadEpoch((value) => value + 1);
      return;
    }
    onRuntimeError(message);
  });

  usePausableTimeout({
    identity: renderer.instanceId,
    enabled: sequenceLength === 0,
    running: presenting,
    durationMs: EMPTY_SEQUENCE_HOLD_MS,
    onTimeout: completeRenderer,
  });

  useEffect(() => {
    if (terminalMode?.kind === "held") return;
    if (!sourceUri || isStill) {
      if (isStill && player.playing) {
        try {
          expectedPauseRef.current = true;
          player.pause();
        } catch {
          // Player already released.
        }
      }
      return;
    }
    expectedPauseRef.current = true;
    const abort = new AbortController();
    resumeWhenPresentingRef.current = false;
    playableUriRef.current = null;
    const resumeAtSeconds = resumeAtSecondsRef.current;
    resumeAtSecondsRef.current = null;
    void loadAndPlayClip(player, {
      sourceUri,
      isLooping,
      clipStartTime: resumeAtSeconds ?? clipStartTime,
      shouldAutoplay,
      isPresenting: () => presentingRef.current,
      onDeferredAutoplay: () => {
        resumeWhenPresentingRef.current = true;
      },
      onPlayableResolved: (playableUri) => {
        playableUriRef.current = playableUri;
      },
      signal: abort.signal,
    }).catch((error: unknown) => {
      if (abort.signal.aborted) return;
      reportPlaybackError(
        error instanceof Error && error.message.trim()
          ? error.message
          : copy.mediaError(assetId ?? "unknown")
      );
    });
    return () => {
      abort.abort();
    };
  }, [
    assetId,
    clipStartTime,
    copy,
    isLooping,
    isStill,
    playbackIdentity,
    player,
    reloadEpoch,
    shouldAutoplay,
    sourceUri,
    terminalMode?.kind,
  ]);

  useEffect(() => {
    if (!onPlaybackHandle) return;
    if (isStill || !config.autoplay || terminalMode?.kind === "held") {
      onPlaybackHandle(renderer.instanceId, null);
      return () => onPlaybackHandle(renderer.instanceId, null);
    }
    const handle: ExperienceMediaPlaybackHandle = {
      playbackIdentity,
      play: async (options) => {
        if (!presentingRef.current && !options?.userGesture) {
          resumeWhenPresentingRef.current = true;
          return;
        }
        continuePlayback();
      },
      pause: () => {
        try {
          expectedPauseRef.current = true;
          player.pause();
        } catch {
          // Player already released.
        }
      },
      seek: (seconds) => {
        player.currentTime = Math.max(0, seconds);
      },
    };
    onPlaybackHandle(renderer.instanceId, handle);
    return () => onPlaybackHandle(renderer.instanceId, null);
  }, [
    config.autoplay,
    isStill,
    onPlaybackHandle,
    playbackIdentity,
    player,
    renderer.instanceId,
    terminalMode?.kind,
  ]);

  const handlePlaybackRefused = useEffectEvent(() => {
    resumeWhenPresentingRef.current = true;
    onPlaybackRefused?.();
  });
  const handlePlaybackInterruption = useEffectEvent(() => {
    if (
      !presentingRef.current ||
      isStill ||
      !shouldAutoplay ||
      player.playing ||
      player.status !== "readyToPlay"
    )
      return;
    // A native pause may arrive before playToEnd. Leave normal ending/loop
    // transitions to the existing completion path, including its iOS fallback.
    const duration = player.duration || (durationMs ? durationMs / 1000 : 0);
    if (duration > 0 && player.currentTime >= duration - 0.08) return;
    resumeWhenPresentingRef.current = true;
    onPlaybackInterrupted?.();
  });
  const handleNativePlay = useEffectEvent(() => {
    expectedPauseRef.current = false;
    // OS media controls can issue Play without React changing presentation.
    // Re-read the current clip state so held frames/stills cannot restart.
    if (!presentingRef.current || isStill || !shouldAutoplay) {
      expectedPauseRef.current = true;
      player.pause();
      if (terminalMode?.kind === "held") restoreHeldFrame(player, terminalMode.frameTimeSeconds);
    }
  });
  const handleNativeEnd = useEffectEvent(() => handleEnd());
  useEffect(() => {
    let interruptionTimer: ReturnType<typeof setTimeout> | undefined;
    const playingSubscription = player.addListener(
      "playingChange",
      ({ isPlaying, oldIsPlaying }) => {
        clearTimeout(interruptionTimer);
        if (isPlaying) {
          handleNativePlay();
          return;
        }
        if (expectedPauseRef.current) {
          expectedPauseRef.current = false;
          return;
        }
        if (oldIsPlaying !== true) return;
        // Allow an accompanying error/end event to settle before classifying a
        // system interruption; never turn a decoding failure into a Resume loop.
        interruptionTimer = setTimeout(() => handlePlaybackInterruption(), 0);
      }
    );
    const endSubscription = player.addListener("playToEnd", () => handleNativeEnd());
    const timeSubscription = player.addListener("timeUpdate", ({ currentTime }) => {
      reportTimeline(currentTime);
    });
    const statusSubscription = player.addListener("statusChange", ({ status, error }) => {
      if (status === "error") {
        // Browser policy rejection is recoverable through the existing Resume action.
        // Keep decoding/network failures on the normal error and signed-URL recovery path.
        if (error && "name" in error && error.name === "NotAllowedError" && onPlaybackRefused) {
          handlePlaybackRefused();
          return;
        }
        reportPlaybackError(error?.message?.trim() || copy.mediaError(assetId ?? "unknown"));
      }
    });
    return () => {
      clearTimeout(interruptionTimer);
      playingSubscription.remove();
      endSubscription.remove();
      timeSubscription.remove();
      statusSubscription.remove();
    };
  }, [assetId, copy, onPlaybackRefused, player]);

  if (sequenceLength === 0) {
    return <EmptyVideoSequencePlaceholder label={copy.emptySequence} />;
  }

  if (!clip || !assetId || !media || !sourceUri) return null;

  const visual = isStill ? (
    <ExperienceStillSegment
      uri={sourceUri}
      fit={contentFit}
      durationMs={stillClipDurationMs(clip)}
      timelineOffsetMs={timelineOffsetMs}
      playbackIdentity={playbackIdentity}
      presenting={presenting}
      onDisplayed={handleEnd}
      onHoldComplete={advanceSequence}
      onTimelineTimeMs={onTimelineTimeMs}
      onLoadError={() => onRuntimeError(copy.mediaError(assetId))}
    />
  ) : (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit={contentFit}
        nativeControls={false}
        // iOS 16+ Live Text / Visual Look Up. Default is on, so a ticket close-up
        // (or any readable frame) draws scan + gear chrome and can pause the clip.
        // H5 <video> has none of that — keep the cinematic stage equally clean.
        allowsVideoFrameAnalysis={false}
        showsTimecodes={false}
        fullscreenOptions={{ enable: false }}
      />
    </View>
  );

  if (config.fit === "native") {
    return (
      <View style={styles.nativeStage}>
        <View
          style={[
            styles.nativeFrame,
            media.variant.width && media.variant.height
              ? { aspectRatio: media.variant.width / media.variant.height }
              : null,
          ]}
        >
          {visual}
        </View>
      </View>
    );
  }

  return visual;
}

const styles = StyleSheet.create({
  emptySequence: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000",
  },
  emptySequenceLabel: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  nativeStage: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    backgroundColor: "#000000",
  },
  nativeFrame: {
    width: "100%",
    maxHeight: "100%",
    overflow: "hidden",
    borderRadius: 8,
    backgroundColor: "#000000",
  },
});
