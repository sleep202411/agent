import { ExperienceSubtitleLayer } from "./experience-subtitles";
import { ExperienceStillSegment } from "./experience-still-segment";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import type { VideoContentFit } from "expo-video";

import {
  ExperienceCoreVideoRendererConfigSchema,
  type ExperienceRendererInstance,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";

import { useGatedScreenActive } from "@/hooks/use-app-active";

import { ensureMediaCached, peekCachedMediaUri } from "../lib/experience-media-cache";
import {
  clipPlaybackEndSeconds,
  clipPlaybackReachedEnd,
  clipPlaybackStalled,
  invalidatePlayableMediaUrl,
  isStillVideoVariant,
  resolveClipPlaybackUri,
  resolvePlayableMediaUrl,
  resolveVideoMedia,
  sequenceTimelineOffsetMs,
  stillClipDurationMs,
  EXPERIENCE_PLAY_ORIENTATION,
} from "../lib/experience-media";
import type { ExperiencePlayerCopy } from "../lib/experience-player-copy";

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

/**
 * Open the clip now. A file already on disk is used as-is. Otherwise the player
 * receives the signed media URL immediately, the same bytes the web player
 * plays, and the download continues behind it.
 */
function openClip(sourceUri: string, signal: AbortSignal): Promise<string | null> {
  return resolveClipPlaybackUri(sourceUri, signal, {
    cached: peekCachedMediaUri,
    sign: resolvePlayableMediaUrl,
    warm: (uri) => {
      void ensureMediaCached(uri).catch(() => undefined);
    },
  });
}

function footageUri(
  manifest: ExperienceRuntimeManifest,
  assetId: string | undefined
): string | null {
  if (!assetId) return null;
  const resolved = resolveVideoMedia(manifest.assets, assetId, EXPERIENCE_PLAY_ORIENTATION);
  if (!resolved || isStillVideoVariant(resolved.variant.mediaType)) return null;
  return resolved.variant.uri;
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
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
};

/**
 * One native player per clip. Replacing the source on a single AVPlayer wedges
 * after a few cuts — the next file is accepted and then the playhead never moves.
 * The previous player stays up until this file is ready, then unmounts.
 */
function ExperienceClipPlayer({
  fileUri,
  active,
  isLooping,
  clipStartTime,
  shouldAutoplay,
  durationMs,
  presenting,
  contentFit,
  playbackIdentity,
  instanceId,
  onTime,
  onEnded,
  onError,
  onPlaybackHandle,
}: {
  fileUri: string;
  active: boolean;
  isLooping: boolean;
  clipStartTime?: number;
  shouldAutoplay: boolean;
  durationMs?: number;
  presenting: boolean;
  contentFit: VideoContentFit;
  playbackIdentity: string;
  instanceId: string;
  onTime: (currentTimeSeconds: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
  onPlaybackHandle?: (instanceId: string, handle: ExperienceMediaPlaybackHandle | null) => void;
}) {
  const player = useVideoPlayer(fileUri, (instance) => {
    instance.timeUpdateEventInterval = 0.25;
    instance.loop = isLooping;
    instance.staysActiveInBackground = false;
    if (clipStartTime !== undefined) instance.currentTime = clipStartTime;
  });
  const heldRef = useRef(!shouldAutoplay || !presenting || !active);
  const stallRef = useRef<{ time: number; since: number; moved: boolean } | null>(null);
  const endedRef = useRef(false);
  const presentingRef = useRef(presenting);
  presentingRef.current = presenting;

  const finish = useEffectEvent(() => {
    if (!active || endedRef.current || isLooping || !shouldAutoplay) return;
    endedRef.current = true;
    onEnded();
  });

  const watch = useEffectEvent(() => {
    if (!active || isLooping || !shouldAutoplay) {
      stallRef.current = null;
      return;
    }
    let currentTime = 0;
    let playerDuration = 0;
    try {
      currentTime = player.currentTime;
      playerDuration = player.duration;
    } catch {
      return;
    }
    const endSeconds = clipPlaybackEndSeconds(durationMs, playerDuration);
    if (clipPlaybackReachedEnd(currentTime, endSeconds)) {
      finish();
      return;
    }
    if (heldRef.current) {
      stallRef.current = null;
      return;
    }
    const now = Date.now();
    const stall = stallRef.current;
    const advanced = stall !== null && Math.abs(currentTime - stall.time) > 0.05;
    const jumpedBackward = stall !== null && currentTime + 0.05 < stall.time;
    if (!stall || advanced || jumpedBackward) {
      stallRef.current = {
        time: currentTime,
        since: now,
        moved: jumpedBackward ? currentTime > 0.05 : (stall?.moved ?? false) || currentTime > 0.05,
      };
      return;
    }
    if (
      clipPlaybackStalled({
        currentTimeSeconds: currentTime,
        anchoredTimeSeconds: stall.time,
        anchoredForMs: now - stall.since,
        endSeconds,
        moved: stall.moved,
        held: false,
      })
    ) {
      finish();
    }
  });

  const reportTime = useEffectEvent((currentTime: number) => {
    if (!active) return;
    onTime(currentTime);
    watch();
  });
  const reportNativeEnd = useEffectEvent(() => {
    if (active) finish();
  });
  const reportError = useEffectEvent((message: string) => {
    if (active) onError(message);
  });

  useLayoutEffect(() => {
    return () => {
      try {
        player.pause();
      } catch {
        // Player already released.
      }
    };
  }, [player]);

  useEffect(() => {
    if (!active || !presenting || !shouldAutoplay) {
      heldRef.current = true;
      stallRef.current = null;
      if (player.playing) {
        try {
          player.pause();
        } catch {
          // Player already released.
        }
      }
      return;
    }
    heldRef.current = false;
    try {
      player.play();
    } catch {
      // Player already released.
    }
  }, [active, player, presenting, shouldAutoplay]);

  useEffect(() => {
    if (!active || !presenting || !shouldAutoplay || isLooping) return;
    const timer = setInterval(() => watch(), 250);
    return () => clearInterval(timer);
  }, [active, isLooping, player, presenting, shouldAutoplay]);

  useEffect(() => {
    const endSubscription = player.addListener("playToEnd", () => reportNativeEnd());
    const timeSubscription = player.addListener("timeUpdate", ({ currentTime }) => {
      reportTime(currentTime);
    });
    const statusSubscription = player.addListener("statusChange", ({ status, error }) => {
      if (status === "error") reportError(error?.message?.trim() || "Playback failed");
    });
    return () => {
      endSubscription.remove();
      timeSubscription.remove();
      statusSubscription.remove();
    };
  }, [player]);

  useEffect(() => {
    if (!onPlaybackHandle) return;
    if (!active || !shouldAutoplay) {
      onPlaybackHandle(instanceId, null);
      return () => onPlaybackHandle(instanceId, null);
    }
    const handle: ExperienceMediaPlaybackHandle = {
      playbackIdentity,
      play: async () => {
        if (!presentingRef.current) {
          heldRef.current = true;
          return;
        }
        heldRef.current = false;
        player.play();
      },
      pause: () => {
        heldRef.current = true;
        stallRef.current = null;
        try {
          player.pause();
        } catch {
          // Player already released.
        }
      },
      seek: (seconds) => {
        const next = Math.max(0, seconds);
        player.currentTime = next;
        onTime(next);
      },
    };
    onPlaybackHandle(instanceId, handle);
    return () => onPlaybackHandle(instanceId, null);
  }, [active, instanceId, onPlaybackHandle, onTime, playbackIdentity, player, shouldAutoplay]);

  return (
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
}

export function ExperienceVideoRenderer({
  manifest,
  renderer,
  copy,
  onTimelineTimeMs,
  onCompleted,
  onRuntimeError,
  onPlaybackHandle,
}: {
  manifest: ExperienceRuntimeManifest;
  renderer: ExperienceRendererInstance;
  copy: ExperiencePlayerCopy;
  onTimelineTimeMs: (timeMs: number) => void;
  onCompleted: () => void;
  onRuntimeError: (message: string) => void;
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
  /** Playable address per clip identity. The current shot and the next one. */
  const [playable, setPlayable] = useState<Record<string, string>>({});
  const playableRef = useRef(playable);
  playableRef.current = playable;
  const [resolveGeneration, setResolveGeneration] = useState(0);
  const retriedClipRef = useRef<Set<string>>(new Set());

  const [subtitlePosition, setSubtitlePosition] = useState<{
    identity: string;
    positionMs: number;
  } | null>(null);
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
  const nextClip = !isStill && !isLooping ? config.sequence[sequenceIndex + 1] : undefined;
  const nextIdentity = nextClip
    ? `${renderer.instanceId}:${sequenceIndex + 1}:sequence:${nextClip.assetId}`
    : null;
  const nextSource = nextClip ? footageUri(manifest, nextClip.assetId) : null;
  const nextDurationMs = nextClip
    ? resolveVideoMedia(manifest.assets, nextClip.assetId, EXPERIENCE_PLAY_ORIENTATION)?.variant
        .durationMs
    : undefined;
  const openingKey = [
    sourceUri && !isStill ? `${playbackIdentity}\0${sourceUri}` : "",
    nextIdentity && nextSource ? `${nextIdentity}\0${nextSource}` : "",
    String(resolveGeneration),
  ].join("\n");

  const presenting = useGatedScreenActive();

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
        terminalMode: { kind: "held" },
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
    renderer.instanceId,
    sequenceIndex,
    terminalMode?.kind,
    setPlaybackState,
  ]);

  // Video hold duration lives in an effect so a remount (React Strict Mode,
  // scene identity churn) reschedules it. Stills own the same beat on their
  // own clock — a parent timeout here was cleared on remount while the still
  // stayed on screen, which froze shots like 凝视车票.
  const videoHoldMs =
    !isStill && terminalMode?.kind === "held" && clip?.endBehavior.behavior === "hold-last-frame"
      ? clip.endBehavior.durationMs
      : undefined;
  const advanceAfterHold = useEffectEvent(() => advanceSequence());
  useEffect(() => {
    if (videoHoldMs === undefined) return;
    const timer = setTimeout(() => advanceAfterHold(), videoHoldMs);
    return () => clearTimeout(timer);
  }, [sequenceIndex, videoHoldMs]);

  const reportTime = useEffectEvent((currentTime: number) => {
    setSubtitlePosition({
      identity: playbackIdentity,
      positionMs: Math.round(currentTime * 1_000),
    });
    onTimelineTimeMs(timelineOffsetMs + Math.round(currentTime * 1_000));
  });

  const reportClipError = useEffectEvent(
    (identity: string, source: string | null, message: string, visible: boolean) => {
      if (source && !retriedClipRef.current.has(identity)) {
        retriedClipRef.current.add(identity);
        invalidatePlayableMediaUrl(source);
        setPlayable((current) => {
          if (!current[identity]) return current;
          const next = { ...current };
          delete next[identity];
          return next;
        });
        setResolveGeneration((value) => value + 1);
        return;
      }
      if (visible) onRuntimeError(message.trim() || copy.mediaError(assetId ?? "unknown"));
    }
  );

  const completeEmptySequence = useEffectEvent(() => completeRenderer());

  // Empty sequence: hold, then complete — kept in an effect so completion can
  // go through useEffectEvent (not callable during render).
  useEffect(() => {
    if (sequenceLength !== 0) return;
    const timer = setTimeout(() => completeEmptySequence(), EMPTY_SEQUENCE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [renderer.instanceId, sequenceLength]);

  useEffect(() => {
    const abort = new AbortController();
    const jobs = openingKey
      .split("\n")
      .filter((row) => row.includes("\0"))
      .map((row) => {
        const splitAt = row.indexOf("\0");
        return { key: row.slice(0, splitAt), source: row.slice(splitAt + 1) };
      });
    for (const job of jobs) {
      if (playableRef.current[job.key]) continue;
      void openClip(job.source, abort.signal)
        .then((uri) => {
          if (!uri || abort.signal.aborted) return;
          setPlayable((current) => (current[job.key] ? current : { ...current, [job.key]: uri }));
        })
        .catch((error: unknown) => {
          if (abort.signal.aborted) return;
          if (error instanceof Error && error.name === "AbortError") return;
          reportClipError(
            job.key,
            job.source,
            error instanceof Error ? error.message : "Playback failed",
            job.key === playbackIdentity
          );
        });
    }
    return () => abort.abort();
  }, [openingKey]);

  if (sequenceLength === 0) {
    return <EmptyVideoSequencePlaceholder label={copy.emptySequence} />;
  }

  if (!clip || !assetId || !media || !sourceUri) return null;

  const layers = [
    playable[playbackIdentity]
      ? {
          identity: playbackIdentity,
          uri: playable[playbackIdentity],
          source: sourceUri,
          active: true,
          durationMs,
          isLooping,
          clipStartTime,
        }
      : null,
    nextIdentity && playable[nextIdentity] && nextIdentity !== playbackIdentity
      ? {
          identity: nextIdentity,
          uri: playable[nextIdentity],
          source: nextSource,
          active: false,
          durationMs: nextDurationMs,
          isLooping: false,
          clipStartTime: undefined,
        }
      : null,
  ].filter((layer): layer is NonNullable<typeof layer> => layer !== null);

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
      onTimelineTimeMs={(timeMs) => {
        setSubtitlePosition({ identity: playbackIdentity, positionMs: timeMs - timelineOffsetMs });
        onTimelineTimeMs(timeMs);
      }}
      onLoadError={() => onRuntimeError(copy.mediaError(assetId))}
    />
  ) : layers.length > 0 ? (
    <>
      {[...layers]
        .sort((left, right) => Number(left.active) - Number(right.active))
        .map((layer) => (
          <View key={layer.identity} pointerEvents="none" style={StyleSheet.absoluteFill}>
            <ExperienceClipPlayer
              fileUri={layer.uri}
              active={layer.active}
              isLooping={layer.isLooping}
              clipStartTime={layer.clipStartTime}
              shouldAutoplay={layer.active && shouldAutoplay}
              durationMs={layer.durationMs}
              presenting={presenting}
              contentFit={contentFit}
              playbackIdentity={layer.identity}
              instanceId={renderer.instanceId}
              onTime={reportTime}
              onEnded={handleEnd}
              onError={(message) =>
                reportClipError(layer.identity, layer.source, message, layer.active)
              }
              onPlaybackHandle={layer.active ? onPlaybackHandle : undefined}
            />
          </View>
        ))}
    </>
  ) : (
    <View style={StyleSheet.absoluteFill} />
  );

  const subtitles = (
    <ExperienceSubtitleLayer
      tracks={clip.subtitles ?? []}
      positionMs={subtitlePosition?.identity === playbackIdentity ? subtitlePosition.positionMs : 0}
      visible={
        presenting &&
        subtitlePosition?.identity === playbackIdentity &&
        (isStill || terminalMode === null)
      }
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
          {subtitles}
        </View>
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {visual}
      {subtitles}
    </View>
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
