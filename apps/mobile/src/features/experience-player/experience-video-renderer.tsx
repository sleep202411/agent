import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import type { VideoContentFit } from "expo-video";

import {
  ExperienceCoreVideoRendererConfigSchema,
  type ExperienceRendererInstance,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";

import { useGatedScreenActive } from "@/hooks/use-app-active";

import type { ExperiencePlayerCopy } from "./experience-player-copy";
import { resolvePlaybackUri } from "./experience-media-cache";
import {
  invalidatePlayableMediaUrl,
  isStillVideoVariant,
  resolveVideoMedia,
  sequenceTimelineOffsetMs,
  stillClipDurationMs,
  EXPERIENCE_PLAY_ORIENTATION,
} from "./experience-media";

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

const EMPTY_SEQUENCE_HOLD_MS = 6_000;
/** How often a still reports elapsed time, matching a video's timeupdate rate. */
const STILL_CLOCK_TICK_MS = 250;

/**
 * Imperative expo-video control lives outside the component so React Compiler
 * does not treat mutations of the hook-returned player as render-time
 * immutability violations. VideoPlayer is a mutable native host by design.
 */
async function loadAndPlayClip(
  player: {
    loop: boolean;
    currentTime: number;
    replaceAsync: (uri: string) => Promise<void>;
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
  const playable = await resolvePlaybackUri(options.sourceUri, options.signal);
  if (options.signal.aborted) return;
  options.onPlayableResolved(playable);
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

function EmptyVideoSequencePlaceholder({ label }: { label: string }) {
  return (
    <View style={styles.emptySequence}>
      <Text style={styles.emptySequenceLabel}>{label}</Text>
    </View>
  );
}

export function ExperienceVideoRenderer({
  manifest,
  renderer,
  copy,
  onTimelineTimeMs,
  onCompleted,
  onRuntimeError,
}: {
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  copy: ExperiencePlayerCopy;
  onTimelineTimeMs: (timeMs: number) => void;
  onCompleted: () => void;
  onRuntimeError: (message: string) => void;
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
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedRendererIdRef = useRef<string | null>(null);
  const missingAssetRef = useRef<string | null>(null);
  /** Resume playback when the screen is presentable again if we paused for it. */
  const resumeWhenPresentingRef = useRef(false);
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

  useEffect(() => {
    if (isStill) {
      if (player.playing) {
        try {
          player.pause();
        } catch {
          // Player already released.
        }
      }
      return;
    }
    if (!presenting) {
      if (player.playing) {
        resumeWhenPresentingRef.current = true;
        player.pause();
      }
      return;
    }
    if (!resumeWhenPresentingRef.current) return;
    resumeWhenPresentingRef.current = false;
    player.play();
  }, [isStill, player, presenting]);

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
        player.pause();
      } catch {
        // Player already released — nothing left to silence.
      }
    };
  }, [player]);

  useEffect(() => {
    completedRendererIdRef.current = null;
    missingAssetRef.current = null;
    if (completionTimerRef.current !== null) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    return () => {
      if (completionTimerRef.current !== null) clearTimeout(completionTimerRef.current);
    };
  }, [renderer.instanceId]);

  useEffect(() => {
    const missingAssetKey = `${renderer.instanceId}:${assetId}`;
    if (media || !assetId || missingAssetRef.current === missingAssetKey) return;
    missingAssetRef.current = missingAssetKey;
    onRuntimeError(copy.mediaError(assetId));
  }, [assetId, copy, media, onRuntimeError, renderer.instanceId]);

  const completeRenderer = useEffectEvent(() => {
    if (completedRendererIdRef.current === renderer.instanceId) return;
    completedRendererIdRef.current = renderer.instanceId;
    onCompleted();
  });

  const advanceSequence = useEffectEvent(() => {
    if (sequenceIndex + 1 < sequenceLength) {
      setPlaybackState({
        rendererInstanceId: renderer.instanceId,
        sequenceIndex: sequenceIndex + 1,
        terminalMode: null,
      });
      return;
    }
    completeRenderer();
  });

  const handleEnd = useEffectEvent(() => {
    if (!clip || terminalMode?.kind === "loop") return;
    const behavior = clip.endBehavior;
    if (behavior.behavior === "advance") {
      advanceSequence();
      return;
    }
    if (behavior.behavior === "hold-last-frame") {
      setPlaybackState({
        rendererInstanceId: renderer.instanceId,
        sequenceIndex,
        terminalMode: { kind: "held" },
      });
      if (behavior.durationMs !== undefined) {
        completionTimerRef.current = setTimeout(() => advanceSequence(), behavior.durationMs);
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
  });

  const reportTimeline = useEffectEvent((currentTime: number) => {
    onTimelineTimeMs(timelineOffsetMs + Math.round(currentTime * 1_000));
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

  // Empty sequence: hold, then complete — kept in an effect so completion can
  // go through useEffectEvent (not callable during render).
  useEffect(() => {
    if (sequenceLength !== 0) return;
    const timer = setTimeout(() => completeRenderer(), EMPTY_SEQUENCE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [sequenceLength]);

  useEffect(() => {
    if (!sourceUri || isStill) {
      if (isStill && player.playing) {
        try {
          player.pause();
        } catch {
          // Player already released.
        }
      }
      return;
    }
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
  ]);

  useEffect(() => {
    const endSubscription = player.addListener("playToEnd", () => handleEnd());
    const timeSubscription = player.addListener("timeUpdate", ({ currentTime }) => {
      reportTimeline(currentTime);
    });
    const statusSubscription = player.addListener("statusChange", ({ status, error }) => {
      if (status === "error") {
        reportPlaybackError(error?.message?.trim() || copy.mediaError(assetId ?? "unknown"));
      }
    });
    return () => {
      endSubscription.remove();
      timeSubscription.remove();
      statusSubscription.remove();
    };
  }, [assetId, copy, player]);

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
      shouldPlay={shouldAutoplay}
      presenting={presenting}
      onDisplayed={handleEnd}
      onTimelineTimeMs={onTimelineTimeMs}
      onLoadError={() => onRuntimeError(copy.mediaError(assetId))}
    />
  ) : (
    <VideoView
      style={StyleSheet.absoluteFill}
      player={player}
      contentFit={contentFit}
      nativeControls={false}
    />
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

/**
 * A storyboard still on the sequence timeline. A still has no element that
 * plays itself, so it is governed like footage: it declares itself displayed
 * only when the scene is presenting and the sequence asked it to play — never
 * on image load, which would run the hold clock before the viewer has started
 * — and from then on reports elapsed time so time-anchored interactions stay
 * live. Screen time is the clip's `hold-last-frame` duration, still owned by
 * the sequence above.
 */
function ExperienceStillSegment({
  uri,
  fit,
  durationMs,
  timelineOffsetMs,
  playbackIdentity,
  shouldPlay,
  presenting,
  onDisplayed,
  onTimelineTimeMs,
  onLoadError,
}: {
  uri: string;
  fit: VideoContentFit;
  durationMs: number;
  timelineOffsetMs: number;
  playbackIdentity: string;
  shouldPlay: boolean;
  presenting: boolean;
  onDisplayed: () => void;
  onTimelineTimeMs: (timeMs: number) => void;
  onLoadError: () => void;
}) {
  const displayedRef = useRef(false);
  const elapsedMsRef = useRef(0);
  const runningSinceRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [playableUri, setPlayableUri] = useState<string | null>(null);
  const onDisplayedRef = useRef(onDisplayed);
  onDisplayedRef.current = onDisplayed;
  const onTimelineTimeMsRef = useRef(onTimelineTimeMs);
  onTimelineTimeMsRef.current = onTimelineTimeMs;
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;

  const stopTicking = () => {
    if (tickRef.current === null) return;
    clearInterval(tickRef.current);
    tickRef.current = null;
  };

  const elapsed = () =>
    elapsedMsRef.current +
    (runningSinceRef.current === null ? 0 : performance.now() - runningSinceRef.current);

  const startTicking = () => {
    if (tickRef.current !== null) return;
    tickRef.current = setInterval(() => {
      const now = Math.min(elapsed(), durationMs);
      onTimelineTimeMsRef.current(timelineOffsetMs + now);
      if (now >= durationMs) {
        elapsedMsRef.current = durationMs;
        runningSinceRef.current = null;
        stopTicking();
      }
    }, STILL_CLOCK_TICK_MS);
  };

  useEffect(() => {
    displayedRef.current = false;
    elapsedMsRef.current = 0;
    runningSinceRef.current = null;
    setPlayableUri(null);
    const abort = new AbortController();
    void resolvePlaybackUri(uri, abort.signal)
      .then((resolved) => {
        if (!abort.signal.aborted) setPlayableUri(resolved);
      })
      .catch(() => {
        if (!abort.signal.aborted) onLoadErrorRef.current();
      });
    return () => {
      abort.abort();
      stopTicking();
    };
  }, [playbackIdentity, uri]);

  useEffect(() => {
    if (!shouldPlay || !presenting || !playableUri || displayedRef.current) return;
    displayedRef.current = true;
    runningSinceRef.current = performance.now();
    onTimelineTimeMsRef.current(timelineOffsetMs);
    startTicking();
    onDisplayedRef.current();
  }, [playableUri, presenting, shouldPlay, timelineOffsetMs]);

  useEffect(() => {
    if (!displayedRef.current) return;
    if (!presenting) {
      if (runningSinceRef.current === null) return;
      elapsedMsRef.current = elapsed();
      runningSinceRef.current = null;
      stopTicking();
      return;
    }
    if (runningSinceRef.current !== null || elapsedMsRef.current >= durationMs) return;
    runningSinceRef.current = performance.now();
    startTicking();
  }, [durationMs, presenting]);

  if (!playableUri) return null;

  return (
    <Image
      source={{ uri: playableUri }}
      style={StyleSheet.absoluteFill}
      contentFit={fit === "contain" ? "contain" : "cover"}
      onError={() => onLoadErrorRef.current()}
    />
  );
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
