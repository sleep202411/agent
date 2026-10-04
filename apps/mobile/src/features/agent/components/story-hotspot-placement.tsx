import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  TextInput,
  View,
  type GestureResponderEvent,
} from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEvent } from "expo";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { fetchTimelines, type TimelineScope } from "../api/story-timeline-api";
import { timelinePlaybackClips } from "../api/story-timeline-playback";
import {
  hotspotRect,
  placeHotspot,
  type HotspotPoint,
  type HotspotRect,
} from "../lib/story-hotspot-geometry";
function Footage({
  source,
  playing,
  seek,
  onTime,
  ratio,
}: {
  source: string;
  playing: boolean;
  seek: { ms: number; revision: number };
  onTime: (time: number) => void;
  ratio: number;
}) {
  const t = useTranslations();
  const player = useVideoPlayer(
    useMemo(() => ({ uri: source, useCaching: false }), [source]),
    (p) => {
      p.staysActiveInBackground = false;
      p.loop = false;
      p.timeUpdateEventInterval = 0.1;
    }
  );
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const appliedSeek = useRef<number | null>(null);
  const time = useEvent(player, "timeUpdate", {
    currentTime: 0,
    bufferedPosition: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
  });
  useEffect(() => {
    onTime(Math.round(time.currentTime * 1000));
  }, [time.currentTime, onTime]);
  useEffect(() => {
    if (status !== "readyToPlay" || appliedSeek.current === seek.revision) return;
    const seconds = Math.max(0, Math.min(seek.ms / 1000, player.duration || seek.ms / 1000));
    player.seekBy(seconds - player.currentTime);
    appliedSeek.current = seek.revision;
  }, [player, status, seek]);
  useEffect(() => {
    if (!playing) player.pause();
    else if (status === "readyToPlay") player.play();
  }, [player, status, playing]);
  useEffect(
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
    <View pointerEvents="none" style={{ position: "absolute", inset: 0 }}>
      <VideoView
        player={player}
        nativeControls={false}
        allowsPictureInPicture={false}
        fullscreenOptions={{ enable: false }}
        contentFit="contain"
        style={{ width: "100%", aspectRatio: ratio }}
      />
      {status === "loading" ? <ActivityIndicator /> : null}
      {status === "error" ? (
        <ThemedText accessibilityRole="alert">{t("thread.previewFailed")}</ThemedText>
      ) : null}
    </View>
  );
}
type PlacementProps = {
  scope: TimelineScope;
  nodeId: string;
  frameProfile?: "landscape_16_9" | "portrait_9_16";
  value: unknown;
  disabled: boolean;
  suspended?: boolean;
  onChange: (rect: HotspotRect) => boolean;
};
export function StoryHotspotPlacement(props: PlacementProps) {
  const [revision, setRevision] = useState(0);
  return (
    <PlacementSession
      {...props}
      key={`${props.scope.projectId}:${props.scope.chapterId}:${props.scope.generation}:${props.nodeId}:${revision}`}
      onReload={() => setRevision((v) => v + 1)}
    />
  );
}
function PlacementSession({
  scope,
  nodeId,
  frameProfile,
  value,
  disabled,
  suspended = false,
  onChange,
  onReload,
}: PlacementProps & { onReload: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    screenActive = useScreenActive();
  const active = screenActive && !suspended;
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string>(),
    [source, setSource] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [seekText, setSeekText] = useState("0"),
    [seek, setSeek] = useState({ ms: 0, revision: 0 });
  const [mode, setMode] = useState<"draw" | "move" | "resize">("move"),
    [size, setSize] = useState({ width: 0, height: 0 }),
    [preview, setPreview] = useState<HotspotRect | null>(null);
  const drag = useRef<{
    start: HotspotPoint;
    original: HotspotRect;
    mode: "draw" | "move" | "resize";
  } | null>(null);
  const rect = hotspotRect(value),
    shown = preview ?? rect;
  const { projectId, chapterId, generation } = scope;
  useEffect(() => {
    const controller = new AbortController();
    fetchTimelines({ projectId, chapterId, generation }, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        const sequence = rows.find((s) => s.plotNodeId === nodeId);
        setSource(
          sequence
            ? (timelinePlaybackClips(sequence).find((c) => c.kind === "video" && c.source)
                ?.source ?? null)
            : null
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, chapterId, generation, nodeId]);
  const [previous, setPrevious] = useState({ active, disabled, value });
  if (previous.active !== active || previous.disabled !== disabled || previous.value !== value) {
    setPrevious({ active, disabled, value });
    setPreview(null);
    if (!active) setPlaying(false);
  }
  useEffect(() => {
    drag.current = null;
  }, [active, disabled, value]);
  const point = (e: GestureResponderEvent) => ({
    x: e.nativeEvent.locationX / size.width,
    y: e.nativeEvent.locationY / size.height,
  });
  const canPlace =
    !disabled &&
    active &&
    !!frameProfile &&
    size.width > 0 &&
    size.height > 0 &&
    (mode === "draw" || !!rect);
  const move = (e: GestureResponderEvent) => {
    if (!drag.current || !canPlace) return null;
    return placeHotspot(drag.current.mode, drag.current.original, drag.current.start, point(e));
  };
  const button = (label: string, onPress: () => void, blocked = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked }}
      disabled={blocked}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: "center", opacity: blocked ? 0.5 : 1 }}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
  const ratio = frameProfile === "portrait_9_16" ? 9 / 16 : 16 / 9;
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("storyHotspot.placement")}</ThemedText>
      {loading ? <ActivityIndicator /> : null}
      {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
      {!loading && !source ? (
        <ThemedText type="small">{t("storyHotspot.noFootage")}</ThemedText>
      ) : null}
      {button(t("common.retry"), onReload, loading)}
      {!frameProfile ? (
        <ThemedText accessibilityRole="alert">{t("storyHotspot.noFrame")}</ThemedText>
      ) : (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            {(["draw", "move", "resize"] as const).map((item) => (
              <View key={item}>
                {button(
                  `${item === mode ? "● " : "○ "}${t(`storyHotspot.${item}`)}`,
                  () => setMode(item),
                  disabled
                )}
              </View>
            ))}
          </View>
          <ThemedText type="small">{t("storyHotspot.placeHelp")}</ThemedText>
          <View
            style={{
              width: "100%",
              aspectRatio: ratio,
              backgroundColor: theme.background,
              borderWidth: 1,
              borderColor: theme.border,
              overflow: "hidden",
            }}
          >
            {source ? (
              <Footage
                key={source}
                source={source}
                playing={playing && active}
                seek={seek}
                onTime={setTime}
                ratio={ratio}
              />
            ) : null}
            <View
              accessibilityLabel={t("storyHotspot.placement")}
              style={{ position: "absolute", inset: 0 }}
              onLayout={(e) =>
                setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
              }
              onStartShouldSetResponder={() => canPlace}
              onResponderGrant={(e) => {
                setPlaying(false);
                drag.current = {
                  start: point(e),
                  original: rect ?? { x: 0, y: 0, width: 0.1, height: 0.1 },
                  mode,
                };
              }}
              onResponderMove={(e) => {
                const next = move(e);
                if (next) setPreview(next);
              }}
              onResponderRelease={(e) => {
                const next = move(e);
                drag.current = null;
                if (next) onChange(next);
                setPreview(null);
              }}
              onResponderTerminationRequest={() => false}
              onResponderTerminate={() => {
                drag.current = null;
                setPreview(null);
              }}
            >
              {shown ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: `${shown.x * 100}%`,
                    top: `${shown.y * 100}%`,
                    width: `${shown.width * 100}%`,
                    height: `${shown.height * 100}%`,
                    borderWidth: 2,
                    borderColor: "#4D8DFF",
                    backgroundColor: "rgba(77,141,255,0.12)",
                  }}
                />
              ) : null}
            </View>
          </View>
          {source ? (
            <>
              <View style={{ flexDirection: "row", gap: 16 }}>
                {button(
                  t(playing ? "storyHotspot.pause" : "storyHotspot.play"),
                  () => setPlaying((v) => !v),
                  !active
                )}
                <ThemedText type="small">{`${time} ms`}</ThemedText>
              </View>
              <TextInput
                accessibilityLabel={t("storyHotspot.previewTime")}
                value={seekText}
                onChangeText={setSeekText}
                style={{
                  color: theme.text,
                  minHeight: 44,
                  padding: 10,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 8,
                }}
              />
              {button(
                t("storyHotspot.seek"),
                () => {
                  const value = Number(seekText);
                  if (!seekText.trim() || !Number.isInteger(value) || value < 0) {
                    setError(t("storyCondition.invalidValue"));
                    return;
                  }
                  setError(undefined);
                  setSeek((s) => ({ ms: value, revision: s.revision + 1 }));
                },
                !active
              )}
            </>
          ) : null}
        </>
      )}
    </View>
  );
}
