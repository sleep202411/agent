import { useEffect, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { IconPhoto } from "@tabler/icons-react-native";
import { loadCanvasMediaAccess, type CanvasMediaScope } from "../api/story-canvas-media-access";
import type { StoryboardMedia } from "../lib/canvas-storyboard";
export function StoryboardThumbnail({
  media,
  scope,
}: {
  media?: StoryboardMedia;
  scope: CanvasMediaScope;
}) {
  const [source, setSource] = useState<{ original: string; url: string }>();
  useEffect(() => {
    const c = new AbortController();
    if (media)
      void loadCanvasMediaAccess(scope, media, c.signal)
        .then((v) => {
          if (!c.signal.aborted) setSource({ original: media.url, url: v.url });
        })
        .catch(() => {
          if (!c.signal.aborted) setSource(undefined);
        });
    return () => c.abort();
  }, [scope, media]);
  const url = source?.original === media?.url ? source?.url : undefined;
  return (
    <View
      pointerEvents="none"
      style={{
        aspectRatio: 16 / 9,
        width: "100%",
        overflow: "hidden",
        borderRadius: 8,
        backgroundColor: "#222",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {url ? (
        media?.kind === "image" ? (
          <Image
            source={{ uri: url }}
            contentFit="cover"
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <VideoThumbnail url={url} />
        )
      ) : (
        <IconPhoto size={24} color="#aaa" />
      )}
    </View>
  );
}
function VideoThumbnail({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.muted = true;
  });
  return (
    <VideoView
      player={player}
      nativeControls={false}
      contentFit="cover"
      style={{ width: "100%", height: "100%" }}
    />
  );
}
