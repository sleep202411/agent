import { useEffect, useEffectEvent, useState, useRef, useLayoutEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import type { VideoContentFit } from "expo-video";
import { useStillPlaybackClock } from "../hooks/use-still-playback-clock";
import { resolvePlaybackUri } from "../lib/experience-media-cache";

/**
 * A storyboard still on the sequence timeline. A still has no element that
 * plays itself, so it is governed like footage: it starts its hold clock once
 * the scene is presenting (stills only mount after Start), reports elapsed
 * time so time-anchored interactions stay live, and advances the sequence
 * when that clock runs out — the same beat H5 owns on the still, not on a
 * parent timeout that remounts can drop.
 */
export function ExperienceStillSegment({
  uri,
  fit,
  durationMs,
  timelineOffsetMs,
  playbackIdentity,
  presenting,
  onDisplayed,
  onHoldComplete,
  onTimelineTimeMs,
  onLoadError,
}: {
  uri: string;
  fit: VideoContentFit;
  durationMs: number;
  timelineOffsetMs: number;
  playbackIdentity: string;
  presenting: boolean;
  onDisplayed: () => void;
  onHoldComplete: () => void;
  onTimelineTimeMs: (timeMs: number) => void;
  onLoadError: () => void;
}) {
  const [playableUri, setPlayableUri] = useState<string | null>(null);
  const [loadedMediaKey, setLoadedMediaKey] = useState<string | null>(null);
  const mediaKey = `${playbackIdentity}:${uri}`;
  const activeMediaKey = useRef<string | null>(mediaKey);
  useLayoutEffect(() => {
    activeMediaKey.current = mediaKey;
    return () => {
      activeMediaKey.current = null;
    };
  }, [mediaKey]);
  const [previousMediaKey, setPreviousMediaKey] = useState(mediaKey);
  if (previousMediaKey !== mediaKey) {
    setPreviousMediaKey(mediaKey);
    setPlayableUri(null);
    setLoadedMediaKey(null);
  }
  const reportLoadError = useEffectEvent(() => onLoadError());
  useStillPlaybackClock({
    identity: mediaKey,
    ready: Boolean(playableUri) && loadedMediaKey === mediaKey,
    presenting,
    durationMs,
    timelineOffsetMs,
    onDisplayed,
    onHoldComplete,
    onTimelineTimeMs,
  });

  useEffect(() => {
    const abort = new AbortController();
    void resolvePlaybackUri(uri, abort.signal)
      .then((resolved) => {
        if (!abort.signal.aborted) setPlayableUri(resolved);
      })
      .catch(() => {
        if (!abort.signal.aborted) reportLoadError();
      });
    return () => {
      abort.abort();
    };
  }, [playbackIdentity, uri]);

  if (!playableUri) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image
        key={mediaKey}
        source={{ uri: playableUri }}
        style={StyleSheet.absoluteFill}
        contentFit={fit === "contain" ? "contain" : "cover"}
        onLoad={() => {
          if (activeMediaKey.current === mediaKey) setLoadedMediaKey(mediaKey);
        }}
        onError={() => {
          if (activeMediaKey.current !== mediaKey) return;
          setLoadedMediaKey(null);
          onLoadError();
        }}
      />
    </View>
  );
}
