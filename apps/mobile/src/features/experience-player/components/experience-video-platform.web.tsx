import { useMemo, useCallback, type CSSProperties } from "react";
import { StyleSheet } from "react-native";
import type { VideoSource, VideoViewProps } from "expo-video";
import { BrowserVideoController } from "../lib/browser-video-controller";

export function useVideoPlayer(
  _source: VideoSource,
  setup?: (player: BrowserVideoController) => void
) {
  return useMemo(() => {
    const player = new BrowserVideoController();
    setup?.(player);
    return player;
    // The renderer supplies a stable empty initial source and controls subsequent loads explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
export function VideoView({
  player,
  style,
  contentFit,
  nativeControls,
}: Omit<VideoViewProps, "player"> & { player: BrowserVideoController }) {
  const attach = useCallback((media: HTMLVideoElement | null) => player.attach(media), [player]);
  return (
    <video
      ref={attach}
      playsInline
      controls={nativeControls}
      style={{
        ...(StyleSheet.flatten(style) as CSSProperties),
        objectFit: contentFit === "contain" ? "contain" : contentFit === "cover" ? "cover" : "none",
      }}
    />
  );
}
