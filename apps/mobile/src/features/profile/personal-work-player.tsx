import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useLayoutEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { getPersonalWorkLink } from "./personal-work-api";

export function PersonalWorkPlayer({ id }: { id: string }) {
  const t = useTranslations();
  const [attempt, setAttempt] = useState(0);
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void getPersonalWorkLink(id, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setUrl(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [id, attempt]);
  const retry = () => {
    setUrl(undefined);
    setFailed(false);
    setAttempt((value) => value + 1);
  };
  if (failed) return <Failure retry={retry} />;
  if (!url) return <ActivityIndicator accessibilityLabel={t("courses.loading")} />;
  return <Playback key={url + attempt} url={url} retry={retry} />;
}
function Failure({ retry }: { retry: () => void }) {
  const t = useTranslations();
  return (
    <View>
      <ThemedText accessibilityRole="alert">{t("courses.playError")}</ThemedText>
      <Pressable accessibilityRole="button" onPress={retry}>
        <ThemedText>{t("profileEdit.retry")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Playback({ url, retry }: { url: string; retry: () => void }) {
  const t = useTranslations();
  const player = useVideoPlayer(url, (instance) => {
    instance.staysActiveInBackground = false;
  });
  useLayoutEffect(
    () => () => {
      try {
        player.pause();
      } catch {
        /* Already released. */
      }
    },
    [player]
  );
  const { status } = useEvent(player, "statusChange", { status: player.status });
  return (
    <View style={styles.player}>
      <VideoView
        player={player}
        nativeControls
        fullscreenOptions={{ enable: true }}
        contentFit="contain"
        style={styles.video}
      />
      {status === "loading" && <ActivityIndicator accessibilityLabel={t("courses.loading")} />}
      {status === "error" && <Failure retry={retry} />}
    </View>
  );
}
const styles = StyleSheet.create({
  player: { width: "100%" },
  video: { width: "100%", aspectRatio: 16 / 9 },
});
