import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useEvent } from "expo";
import { VideoView, useVideoPlayer } from "expo-video";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { getAuthGeneration } from "@/auth/auth-store";
import { getContentReviewPlayback, type ContentReviewDetail } from "./api/content-review-api";
import { parseReviewTimeOffset, formatReviewTimecode } from "./content-review-time";
type Props = { workspaceId: string; generation: number; record: ContentReviewDetail };
export function ContentReviewPlayback(props: Props) {
  return (
    <Playback
      key={`${props.workspaceId}:${props.generation}:${props.record.id}:${props.record.mediaAssetId}`}
      {...props}
    />
  );
}
function Playback({
  workspaceId,
  generation,
  record,
}: {
  workspaceId: string;
  generation: number;
  record: ContentReviewDetail;
}) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  const checkpoint = useRef({ seconds: 0, playing: false });
  const key = JSON.stringify([workspaceId, generation, record.id, revision]);
  const [snapshot, setSnapshot] = useState<{ key: string; url?: string; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void getContentReviewPlayback(workspaceId, generation, record.id, controller.signal).then(
      (access) => {
        if (controller.signal.aborted || generation !== getAuthGeneration()) return;
        setSnapshot({ key, url: access.url });
        if (access.expiresAt)
          timer = setTimeout(
            () => setRevision((v) => v + 1),
            Math.min(2147483647, Math.max(0, Date.parse(access.expiresAt) - Date.now()))
          );
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setSnapshot({ key, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [workspaceId, generation, record.id, key]);
  const data = snapshot?.key === key ? snapshot : undefined;
  return (
    <View style={{ gap: 8 }}>
      {!data && <ActivityIndicator />}
      {data?.error && <ThemedText accessibilityRole="alert">{data.error}</ThemedText>}
      {data?.url && <Player key={key} url={data.url} record={record} checkpoint={checkpoint} />}
      <Pressable
        accessibilityRole="button"
        onPress={() => setRevision((v) => v + 1)}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("contentReviewHistory.reloadVideo")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Player({
  url,
  record,
  checkpoint,
}: {
  url: string;
  record: ContentReviewDetail;
  checkpoint: RefObject<{ seconds: number; playing: boolean }>;
}) {
  const t = useTranslations();
  const player = useVideoPlayer({ uri: url, useCaching: false }, (instance) => {
    instance.staysActiveInBackground = false;
    instance.timeUpdateEventInterval = 0.25;
  });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const [error, setError] = useState<string>();
  const restored = useRef(false);
  useEffect(() => {
    if (status !== "readyToPlay" || restored.current) return;
    restored.current = true;
    const target = Math.min(record.durationSeconds, Math.max(0, checkpoint.current.seconds));
    const resume = checkpoint.current.playing;
    player.seekBy(target - player.currentTime);
    if (resume) player.play();
  }, [status, player, record.durationSeconds, checkpoint]);
  useLayoutEffect(() => {
    const time = player.addListener("timeUpdate", ({ currentTime }) => {
      if (restored.current && Number.isFinite(currentTime))
        checkpoint.current.seconds = currentTime;
    });
    const playing = player.addListener("playingChange", ({ isPlaying }) => {
      if (restored.current) checkpoint.current.playing = isPlaying;
    });
    return () => {
      time.remove();
      playing.remove();
      try {
        if (restored.current && Number.isFinite(player.currentTime)) {
          checkpoint.current = { seconds: player.currentTime, playing: player.playing };
        }
        player.pause();
      } catch {
        /* Keep the event checkpoint if the native player is already released. */
      }
    };
  }, [player, checkpoint]);
  const timed = [
    ...record.details.map((finding, index) => ({
      id: `finding-${index}`,
      seconds: parseReviewTimeOffset(finding.timeOffset),
      label: finding.label || finding.description || finding.source || "—",
    })),
    ...record.comments.map((comment) => ({
      id: `comment-${comment.id}`,
      seconds: comment.seconds,
      label: comment.body,
    })),
  ]
    .filter(
      (row): row is { id: string; seconds: number; label: string } =>
        row.seconds !== null && row.seconds >= 0 && row.seconds <= record.durationSeconds
    )
    .sort((a, b) => a.seconds - b.seconds);
  return (
    <View style={{ gap: 8 }}>
      <VideoView
        allowsPictureInPicture={false}
        player={player}
        nativeControls
        contentFit="contain"
        style={{ width: "100%", aspectRatio: 16 / 9 }}
        accessibilityLabel={record.fileName}
      />
      {status === "error" && (
        <ThemedText accessibilityRole="alert">
          {t("contentReviewHistory.playbackFailed")}
        </ThemedText>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {timed.map((row) => (
        <Pressable
          key={row.id}
          accessibilityRole="button"
          disabled={status !== "readyToPlay"}
          accessibilityState={{ disabled: status !== "readyToPlay" }}
          onPress={() => {
            try {
              player.pause();
              player.currentTime = row.seconds;
              setError(undefined);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
          style={{ padding: 12, opacity: status === "readyToPlay" ? 1 : 0.5 }}
        >
          <ThemedText type="small">
            {formatReviewTimecode(row.seconds)} · {row.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}
