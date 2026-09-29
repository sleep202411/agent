import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";

function clock(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

/** Only mounted after explicit authorized access. No autoplay or download-first cache. */
export function ConversationAudio({ url }: { url: string }) {
  const t = useTranslations();
  const source = useMemo(() => ({ uri: url }), [url]);
  const player = useAudioPlayer(source, { downloadFirst: false, updateInterval: 500 });
  const status = useAudioPlayerStatus(player);
  const alive = useRef(false),
    seeking = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      try {
        player.pause();
      } catch {
        /* Native hook may already have released it. */
      }
    };
  }, [player]);
  const seek = async (seconds: number, resume = false) => {
    if (seeking.current) return;
    seeking.current = true;
    setBusy(true);
    setError(false);
    try {
      await player.seekTo(Math.max(0, Math.min(status.duration, seconds)));
      if (alive.current && resume) player.play();
    } catch {
      if (alive.current) setError(true);
    } finally {
      seeking.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const disabled = !status.isLoaded || busy || !!status.error;
  return (
    <View style={{ flex: 1, justifyContent: "center", gap: 12 }}>
      <ThemedText>
        {clock(status.currentTime)} / {clock(status.duration)}
      </ThemedText>
      {(!status.isLoaded || status.isBuffering) && !status.error && (
        <ActivityIndicator accessibilityLabel={t("courses.loading")} />
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        <AudioControl
          label={t("thread.audioBack")}
          disabled={disabled}
          onPress={() => void seek(status.currentTime - 15)}
        />
        <AudioControl
          label={t(status.playing ? "thread.audioPause" : "thread.audioPlay")}
          disabled={disabled}
          onPress={() => {
            if (seeking.current) return;
            if (!status.playing && status.duration > 0 && status.currentTime >= status.duration) {
              void seek(0, true);
              return;
            }
            try {
              if (status.playing) player.pause();
              else player.play();
              setError(false);
            } catch {
              setError(true);
            }
          }}
        />
        <AudioControl
          label={t("thread.audioForward")}
          disabled={disabled}
          onPress={() => void seek(status.currentTime + 15)}
        />
        <AudioControl
          label={t("thread.audioReplay")}
          disabled={disabled}
          onPress={() => void seek(0, true)}
        />
      </View>
      {(status.error || error) && (
        <ThemedText accessibilityRole="alert">{t("thread.previewFailed")}</ThemedText>
      )}
    </View>
  );
}

function AudioControl({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 12 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
