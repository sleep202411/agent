import { useEffect, useMemo, useState } from "react";
import { Pressable, View, ActivityIndicator, TextInput } from "react-native";
import { Image } from "expo-image";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { timelinePlaybackClips, timelineClipAt } from "../api/story-timeline-playback";
import type { TimelineSequence } from "../api/story-timeline-api";

function TimelineVideo({
  source,
  playing,
  seconds,
  onFailure,
}: {
  source: string;
  playing: boolean;
  seconds: number;
  onFailure: () => void;
}) {
  const player = useVideoPlayer(
    useMemo(() => ({ uri: source, useCaching: false }), [source]),
    (p) => {
      p.staysActiveInBackground = false;
      p.loop = false;
    }
  );
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const t = useTranslations();
  useEffect(() => {
    if (status === "error") {
      onFailure();
      return;
    }
    if (status !== "readyToPlay") return;
    if (Math.abs(player.currentTime - seconds) > 0.3) player.seekBy(seconds - player.currentTime);
    if (playing) player.play();
    else player.pause();
  }, [player, status, seconds, playing, onFailure]);
  useEffect(
    () => () => {
      try {
        player.pause();
      } catch {
        /* Native release may precede cleanup. */
      }
    },
    [player]
  );
  return (
    <>
      <VideoView
        player={player}
        nativeControls={false}
        allowsPictureInPicture={false}
        fullscreenOptions={{ enable: false }}
        contentFit="contain"
        style={{ width: "100%", height: 210 }}
      />
      {status === "loading" && <ActivityIndicator />}
      {status === "error" && (
        <ThemedText accessibilityRole="alert">{t("thread.previewFailed")}</ThemedText>
      )}
    </>
  );
}
function Playback({ sequence }: { sequence: TimelineSequence }) {
  const t = useTranslations(),
    theme = useTheme();
  const clips = useMemo(() => timelinePlaybackClips(sequence), [sequence]);
  const [time, setTime] = useState(0),
    [requestedPlaying, setPlaying] = useState(false);
  const playing = requestedPlaying && time < sequence.durationMs;
  const [seek, setSeek] = useState("");
  const [seekError, setSeekError] = useState(false);
  const [failedImage, setFailedImage] = useState<string>();
  const clip = timelineClipAt(clips, time);
  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    let previous = start;
    const timer = setInterval(() => {
      const now = performance.now(),
        delta = Math.max(0, now - previous);
      previous = now;
      setTime((value) => Math.min(sequence.durationMs, value + delta));
    }, 100);
    return () => clearInterval(timer);
  }, [playing, sequence.durationMs]);
  return (
    <View
      style={{ gap: 12, padding: 12, borderRadius: 8, backgroundColor: theme.backgroundElement }}
    >
      <ThemedText type="smallBold">{t("timeline.savedPreview")}</ThemedText>
      <ThemedText>{clip?.title ?? t("timeline.empty")}</ThemedText>
      {clip?.source ? (
        clip.kind === "video" ? (
          <TimelineVideo
            key={clip.id}
            source={clip.source}
            playing={playing}
            seconds={Math.max(0, time - clip.startMs) / 1000}
            onFailure={() => setPlaying(false)}
          />
        ) : failedImage === clip.id ? (
          <ThemedText accessibilityRole="alert">{t("thread.previewFailed")}</ThemedText>
        ) : (
          <Image
            source={{ uri: clip.source }}
            contentFit="contain"
            style={{ width: "100%", height: 210 }}
            onError={() => {
              setFailedImage(clip.id);
              setPlaying(false);
            }}
          />
        )
      ) : (
        <ThemedText>{t("timeline.noClipMedia")}</ThemedText>
      )}
      <ThemedText>
        {(time / 1000).toFixed(1)} / {(sequence.durationMs / 1000).toFixed(1)} s
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        disabled={!clips.length || sequence.durationMs <= 0}
        style={{ padding: 12 }}
        onPress={() => {
          if (time >= sequence.durationMs) setTime(0);
          setPlaying((v) => time >= sequence.durationMs || !v);
        }}
      >
        <ThemedText type="smallBold">{t(playing ? "timeline.pause" : "timeline.play")}</ThemedText>
      </Pressable>
      <TextInput
        accessibilityLabel={t("timeline.seekSeconds")}
        placeholder={t("timeline.seekSeconds")}
        placeholderTextColor={theme.text}
        value={seek}
        onChangeText={setSeek}
        keyboardType="decimal-pad"
        style={{
          color: theme.text,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 8,
          padding: 12,
        }}
      />
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          const value = Number(seek);
          if (
            !seek.trim() ||
            !Number.isFinite(value) ||
            value < 0 ||
            value * 1000 > sequence.durationMs
          ) {
            setSeekError(true);
            return;
          }
          setPlaying(false);
          setTime(value * 1000);
          setSeekError(false);
          setFailedImage(undefined);
        }}
      >
        <ThemedText>{t("timeline.seek")}</ThemedText>
      </Pressable>
      {seekError && <ThemedText accessibilityRole="alert">{t("timeline.seekError")}</ThemedText>}
      {clips.map((item, index) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityState={{ selected: item.id === clip?.id }}
          style={{ padding: 12 }}
          onPress={() => {
            setPlaying(false);
            setTime(item.startMs);
            setFailedImage(undefined);
          }}
        >
          <ThemedText>
            {index + 1}. {item.title} · {(item.startMs / 1000).toFixed(1)} s
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}
/** Unmount native media while backgrounded; returning starts paused, never autoplay. */
export function TimelinePreview({ sequence }: { sequence: TimelineSequence }) {
  return useScreenActive() ? (
    <Playback key={`${sequence.id}:${sequence.version}`} sequence={sequence} />
  ) : null;
}
