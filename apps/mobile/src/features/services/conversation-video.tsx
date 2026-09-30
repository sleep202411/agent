import { useLayoutEffect, useMemo } from "react";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
/** Mounted only inside the authorized foreground preview. No autoplay or disk cache. */
export function ConversationVideo({ url, onRetry }: { url: string; onRetry: () => void }) {
  const t = useTranslations();
  const source = useMemo(() => ({ uri: url, useCaching: false }), [url]);
  const player = useVideoPlayer(source, (instance) => {
    instance.staysActiveInBackground = false;
  });
  useLayoutEffect(
    () => () => {
      try {
        player.pause();
      } catch {
        /* Already released by native lifecycle. */
      }
    },
    [player]
  );
  const { status } = useEvent(player, "statusChange", { status: player.status });
  return (
    <View style={{ flex: 1 }}>
      <VideoView
        player={player}
        nativeControls
        allowsPictureInPicture={false}
        fullscreenOptions={{ enable: false }}
        contentFit="contain"
        style={{ flex: 1 }}
      />
      {status === "loading" && <ActivityIndicator accessibilityLabel={t("courses.loading")} />}
      {status === "error" && (
        <View>
          <ThemedText accessibilityRole="alert">{t("thread.previewFailed")}</ThemedText>
          <Pressable accessibilityRole="button" onPress={onRetry} style={{ padding: 12 }}>
            <ThemedText>{t("thread.closePreview")}</ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}
