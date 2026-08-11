import { useEffect, useEffectEvent, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import type { VideoContentFit } from "expo-video";

import {
  ExperienceCoreVideoRendererConfigSchema,
  type ExperienceRendererInstance,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";

import type { ExperiencePlayerCopy } from "./experience-player-copy";
import { resolvePlaybackUri } from "./experience-media-cache";
import {
  resolveVideoMedia,
  sequenceTimelineOffsetMs,
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
    signal: AbortSignal;
  }
): Promise<void> {
  player.loop = options.isLooping;
  const playable = await resolvePlaybackUri(options.sourceUri, options.signal);
  if (options.signal.aborted) return;
  await player.replaceAsync(playable);
  if (options.signal.aborted) return;
  if (options.clipStartTime !== undefined) {
    player.currentTime = options.clipStartTime;
  }
  if (options.shouldAutoplay) {
    player.play();
  }
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
  const isLooping = terminalMode?.kind === "loop";
  const clipStartTime = terminalMode?.kind === "loop" ? terminalMode.clipStartTime : undefined;
  const shouldAutoplay = config.autoplay && terminalMode?.kind !== "held";
  const durationMs = media?.variant.durationMs;
  const sequenceLength = config.sequence.length;

  const player = useVideoPlayer(null, (instance) => {
    instance.timeUpdateEventInterval = 0.25;
    instance.loop = false;
  });

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

  const reportPlaybackError = useEffectEvent((message: string) => {
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
    if (!sourceUri) return;
    const abort = new AbortController();
    void loadAndPlayClip(player, {
      sourceUri,
      isLooping,
      clipStartTime,
      shouldAutoplay,
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
    playbackIdentity,
    player,
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
          <VideoView
            style={StyleSheet.absoluteFill}
            player={player}
            contentFit="contain"
            nativeControls={false}
          />
        </View>
      </View>
    );
  }

  return (
    <VideoView
      style={StyleSheet.absoluteFill}
      player={player}
      contentFit={contentFit}
      nativeControls={false}
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
