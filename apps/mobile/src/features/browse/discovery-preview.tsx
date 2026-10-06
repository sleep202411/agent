import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import { fetchIpPreview } from "@/data/ip-api";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";

export type PreviewPlayback = { pause: () => void; resume: () => void };
type PreviewProps = {
  ipId: string;
  active?: boolean;
  playback?: RefObject<PreviewPlayback | null>;
};
/** Only the selected card owns a player; scrolling pauses it before changing cards. */
export function DiscoveryPreview({ ipId, active = true, playback }: PreviewProps) {
  return <PreviewRequest key={ipId} ipId={ipId} active={active} playback={playback} />;
}
function PreviewRequest({ ipId, active = true, playback }: PreviewProps) {
  const t = useTranslations();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ url?: string; failed?: boolean }>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchIpPreview(ipId, controller.signal).then(
      (url) => {
        if (!controller.signal.aborted) setResult({ url });
      },
      () => {
        if (!controller.signal.aborted) setResult({ failed: true });
      }
    );
    return () => controller.abort();
  }, [ipId, attempt]);
  const retry = () => {
    setResult(undefined);
    setAttempt((value) => value + 1);
  };
  if (result?.url)
    return (
      <PreviewVideo
        key={`${result.url}:${attempt}`}
        url={result.url}
        retry={retry}
        active={active}
        playback={playback}
      />
    );
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
      {!result ? (
        <ActivityIndicator accessibilityLabel={t("ipDetail.videoLoading")} />
      ) : (
        <>
          <ThemedText accessibilityRole={result.failed ? "alert" : undefined}>
            {t(result.failed ? "discovery.previewFailed" : "discovery.noPreview")}
          </ThemedText>
          {result.failed && (
            <Pressable accessibilityRole="button" onPress={retry} style={{ padding: 12 }}>
              <ThemedText>{t("common.retry")}</ThemedText>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

function PreviewVideo({
  url,
  retry,
  active,
  playback: playbackRef,
}: {
  url: string;
  retry: () => void;
  active: boolean;
  playback?: RefObject<PreviewPlayback | null>;
}) {
  const t = useTranslations();
  const [muted, setMuted] = useState(true);
  const player = useVideoPlayer({ uri: url, useCaching: false }, (instance) => {
    instance.staysActiveInBackground = false;
    instance.loop = true;
    instance.muted = true;
  });
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [player, active]);
  useLayoutEffect(() => {
    if (!playbackRef) return;
    let resume = false;
    const control = {
      pause: () => {
        resume = player.playing;
        player.pause();
      },
      resume: () => {
        if (resume) player.play();
        resume = false;
      },
    };
    playbackRef.current = control;
    return () => {
      if (playbackRef.current === control) playbackRef.current = null;
    };
  }, [player, playbackRef]);
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  useLayoutEffect(
    () => () => {
      try {
        player.pause();
      } catch {
        /* Native player may already be released. */
      }
    },
    [player]
  );
  return (
    <View style={{ flex: 1, gap: 8 }}>
      <VideoView
        player={player}
        contentFit="contain"
        nativeControls={false}
        playsInline
        style={{ flex: 1, minHeight: 0, width: "100%" }}
        allowsPictureInPicture={false}
        fullscreenOptions={{ enable: false }}
      />
      {(status === "loading" || status === "idle") && (
        <ActivityIndicator accessibilityLabel={t("ipDetail.videoLoading")} />
      )}
      {status === "error" ? (
        <>
          <ThemedText accessibilityRole="alert">{t("discovery.previewFailed")}</ThemedText>
          <Pressable accessibilityRole="button" onPress={retry} style={{ padding: 12 }}>
            <ThemedText>{t("common.retry")}</ThemedText>
          </Pressable>
        </>
      ) : (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => (isPlaying ? player.pause() : player.play())}
            style={{ padding: 12 }}
          >
            <ThemedText>{t(isPlaying ? "discovery.pause" : "discovery.play")}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setPlayerMuted(player, !muted);
              setMuted(!muted);
            }}
            style={{ padding: 12 }}
          >
            <ThemedText>{t(muted ? "discovery.unmute" : "discovery.mute")}</ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Expo's player is an imperative native object, not React state. */
function setPlayerMuted(player: VideoPlayer, muted: boolean) {
  player.muted = muted;
}
