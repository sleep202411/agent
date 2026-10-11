import { useEffect, useMemo, useRef, useState } from "react";
import { useEvent, useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { loadCanvasMediaAccess, type CanvasMediaScope } from "../api/story-canvas-media-access";
import type { StoryboardMedia } from "../lib/canvas-storyboard";

export function CanvasStoryboardPlayer({
  media,
  scope,
  autoPlay,
  ended,
}: {
  media: StoryboardMedia;
  scope: CanvasMediaScope;
  autoPlay: boolean;
  ended(): void;
}) {
  const active = useScreenActive();
  return active && scope.generation === getAuthGeneration() ? (
    <AuthorizedPlayer
      key={`${media.id}:${media.url}`}
      media={media}
      scope={scope}
      autoPlay={autoPlay}
      ended={ended}
    />
  ) : null;
}
function AuthorizedPlayer({
  media,
  scope,
  autoPlay,
  ended,
}: {
  media: StoryboardMedia;
  scope: CanvasMediaScope;
  autoPlay: boolean;
  ended(): void;
}) {
  const t = useTranslations();
  const [access, setAccess] = useState<{ url: string; expiresAt: string | null }>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let expiry: ReturnType<typeof setTimeout>;
    void loadCanvasMediaAccess(scope, media, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setAccess(value);
        if (value.expiresAt)
          expiry = setTimeout(
            () => setError(t("thread.previewFailed")),
            Math.min(2147483647, Math.max(0, Date.parse(value.expiresAt) - Date.now()))
          );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => {
      controller.abort();
      clearTimeout(expiry);
    };
  }, [scope, media, attempt, t]);
  if (error)
    return (
      <View>
        <ThemedText accessibilityRole="alert">{error}</ThemedText>
        <Pressable
          onPress={() => {
            setError(undefined);
            setAccess(undefined);
            setAttempt((n) => n + 1);
          }}
        >
          <ThemedText>{t("common.retry")}</ThemedText>
        </Pressable>
      </View>
    );
  if (!access) return <ActivityIndicator />;
  return media.kind === "image" ? (
    <Still
      key={attempt}
      url={access.url}
      autoPlay={autoPlay}
      ended={ended}
      failed={() => setError(t("thread.previewFailed"))}
    />
  ) : (
    <Clip
      url={access.url}
      autoPlay={autoPlay}
      ended={ended}
      failed={() => setError(t("thread.previewFailed"))}
    />
  );
}
function Still({
  url,
  autoPlay,
  ended,
  failed,
}: {
  url: string;
  autoPlay: boolean;
  ended(): void;
  failed(): void;
}) {
  const t = useTranslations();
  const [playing, setPlaying] = useState(autoPlay),
    [ready, setReady] = useState(false);
  const remaining = useRef(5000);
  useEffect(() => {
    if (!ready || !playing) return;
    const started = Date.now();
    let finished = false;
    const timer = setTimeout(() => {
      finished = true;
      remaining.current = 5000;
      setPlaying(false);
      ended();
    }, remaining.current);
    return () => {
      clearTimeout(timer);
      if (!finished) remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [playing, ready, ended]);
  return (
    <View>
      <Image
        source={{ uri: url }}
        cachePolicy="none"
        contentFit="contain"
        style={{ height: 220 }}
        onLoad={() => setReady(true)}
        onError={failed}
      />
      <Pressable onPress={() => setPlaying((p) => !p)} style={{ padding: 12 }}>
        <ThemedText>{t(playing ? "storyboard.pause" : "storyboard.play")}</ThemedText>
      </Pressable>
      <ThemedText type="small">{t("storyboard.still")}</ThemedText>
    </View>
  );
}
function Clip({
  url,
  autoPlay,
  ended,
  failed,
}: {
  url: string;
  autoPlay: boolean;
  ended(): void;
  failed(): void;
}) {
  const source = useMemo(() => ({ uri: url, useCaching: false }), [url]);
  const player = useVideoPlayer(source, (p) => {
    p.staysActiveInBackground = false;
    if (autoPlay) p.play();
  });
  useEventListener(player, "playToEnd", ended);
  const { status } = useEvent(player, "statusChange", { status: player.status });
  useEffect(() => {
    if (status === "error") failed();
  }, [status, failed]);
  return (
    <VideoView
      player={player}
      nativeControls
      allowsPictureInPicture={false}
      fullscreenOptions={{ enable: false }}
      contentFit="contain"
      style={{ height: 240 }}
    />
  );
}
