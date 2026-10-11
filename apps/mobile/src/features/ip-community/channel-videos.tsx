import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ChannelVideoSubmit } from "./channel-video-submit";
import { ZodError } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ConversationVideo } from "@/features/services/conversation-video";
import type { ChannelScope } from "./channel-submissions-api";
import {
  fetchChannelVideos,
  reviewChannelVideo,
  type ChannelVideo,
  type ChannelVideoPage,
} from "./channel-videos-api";

/** Parent is keyed by channel/account/locale and verifies the community channel. */
export function ChannelVideos({ scope }: { scope: ChannelScope }) {
  const t = useTranslations(),
    theme = useTheme(),
    active = useScreenActive();
  const live = useRef(false),
    foreground = useRef(false),
    writing = useRef(false);
  const read = useRef<AbortController | null>(null);
  const cursors = useRef(new Set<string>());
  const [page, setPage] = useState<ChannelVideoPage>();
  const [loading, setLoading] = useState(true),
    [pending, setPending] = useState(false);
  const [stale, setStale] = useState(true),
    [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const current = () => live.current && getAuthGeneration() === scope.generation;
  const reason = (cause: unknown) =>
    cause instanceof Error && !(cause instanceof ZodError) && cause.message
      ? cause.message
      : t("channelSubmissions.failed");
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      read.current?.abort();
    };
  }, []);
  useLayoutEffect(() => {
    foreground.current = active;
    return () => {
      foreground.current = false;
    };
  }, [active]);
  async function load(more = false) {
    if (!current() || !foreground.current || writing.current || read.current) return;
    const cursor = more ? page?.nextCursor : null;
    if (more && !cursor) return;
    const token = new AbortController();
    read.current = token;
    setLoading(true);
    setError(null);
    setPlaying(null);
    if (!more) setStale(true);
    try {
      const value = await fetchChannelVideos(scope, cursor ?? null, token.signal);
      if (!current() || token.signal.aborted || read.current !== token) return;
      if (more && value.nextCursor && cursors.current.has(value.nextCursor))
        throw new Error(t("channelSubmissions.failed"));
      if (!more) cursors.current.clear();
      if (cursor) cursors.current.add(cursor);
      setPage({
        ...value,
        items: [
          ...new Map(
            [...(more && page ? page.items : []), ...value.items].map((item) => [item.id, item])
          ).values(),
        ],
      });
      setStale(false);
    } catch (cause) {
      if (current() && !token.signal.aborted) setError(reason(cause));
    } finally {
      if (current() && read.current === token) {
        read.current = null;
        setLoading(false);
      }
    }
  }
  const refresh = useEffectEvent(() => {
    void load();
  });
  useEffect(() => {
    let cancelled = false;
    if (active)
      queueMicrotask(() => {
        if (!cancelled) refresh();
      });
    // Signed media URLs expire after five minutes. Never keep old pages playable
    // while revalidating access or after returning from the background.
    const timer = active ? setInterval(() => refresh(), 240000) : undefined;
    return () => {
      cancelled = true;
      clearInterval(timer);
      read.current?.abort();
      read.current = null;
    };
  }, [active]);
  async function decide(item: ChannelVideo, status: "approved" | "rejected") {
    if (
      !current() ||
      !foreground.current ||
      writing.current ||
      read.current ||
      stale ||
      !page?.canManage ||
      item.status !== "pending"
    )
      return;
    writing.current = true;
    setPending(true);
    setStale(true);
    setPlaying(null);
    setMutationError(null);
    try {
      await reviewChannelVideo(scope, { id: item.id, status, expectedVersion: item.version });
    } catch (cause) {
      if (current()) setMutationError(reason(cause));
    } finally {
      writing.current = false;
      if (current()) {
        setPending(false);
        if (foreground.current) void load();
      }
    }
  }
  const busy = loading || pending || stale;
  if (!active) return null;
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("channelVideos.title")}</ThemedText>
      <ChannelVideoSubmit scope={scope} onSubmitted={() => void load()} />
      {(loading || pending) && (
        <ActivityIndicator accessibilityLabel={t("channelSubmissions.loading")} />
      )}
      {(error || mutationError) && (
        <ThemedText type="small" accessibilityRole="alert">
          {error || mutationError}
        </ThemedText>
      )}
      <Button
        label={t("channelSubmissions.refresh")}
        disabled={loading || pending}
        onPress={() => {
          setMutationError(null);
          void load();
        }}
      />
      {page && !loading && !error && !page.items.length && (
        <ThemedText type="small" themeColor="textSecondary">
          {t("channelVideos.empty")}
        </ThemedText>
      )}
      {!stale &&
        page?.items.map((item) => (
          <View
            key={item.id}
            style={{ gap: 6, paddingTop: 8, borderTopWidth: 1, borderColor: theme.border }}
          >
            <ThemedText type="smallBold">{item.title}</ThemedText>
            {!!item.description && <ThemedText type="small">{item.description}</ThemedText>}
            <ThemedText type="small" themeColor="textSecondary">
              {t(`channelSubmissions.${item.status}`)}
            </ThemedText>
            {item.url ? (
              <>
                <Button
                  label={t(playing === item.id ? "thread.closePreview" : "channelVideos.play")}
                  disabled={busy}
                  onPress={() => setPlaying(playing === item.id ? null : item.id)}
                />
                {playing === item.id && !busy && (
                  <View style={{ aspectRatio: 16 / 9 }}>
                    <ConversationVideo url={item.url} onRetry={() => setPlaying(null)} />
                  </View>
                )}
              </>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                {t("channelVideos.moderation")}
              </ThemedText>
            )}
            {page.canManage && item.status === "pending" && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(["approved", "rejected"] as const).map((status) => (
                  <Button
                    key={status}
                    label={t(
                      status === "approved"
                        ? "channelSubmissions.approve"
                        : "channelSubmissions.reject"
                    )}
                    disabled={busy}
                    onPress={() => void decide(item, status)}
                  />
                ))}
              </View>
            )}
          </View>
        ))}
      {page?.nextCursor && (
        <Button
          label={t("channelSubmissions.more")}
          disabled={busy}
          onPress={() => void load(true)}
        />
      )}
    </View>
  );
}
function Button({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: 10,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}
