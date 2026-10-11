import { useState } from "react";
import { Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { useIpBookmark } from "./use-ip-bookmark";
/** One collection read for the current target; never one request per episode card. */
export function BookmarkControl({
  ipId,
  episodes,
}: {
  ipId: string;
  episodes: { id: string; title: string }[];
}) {
  const [episodeId, setEpisodeId] = useState<string | null>(null),
    [open, setOpen] = useState(false);
  const auth = useAuth(),
    gate = useAuthGate(),
    active = useScreenActive(),
    theme = useTheme(),
    locale = useLocale(),
    t = useTranslations();
  const viewer =
    auth.status === "authenticated" ? String(auth.user?.userId ?? auth.user?.id ?? "") : null;
  const episode = episodes.find((e) => e.id === episodeId);
  const valid = episodeId === null || Boolean(episode);
  const state = useIpBookmark(
    auth.generation,
    viewer,
    locale,
    ipId,
    active && valid && auth.status !== "hydrating",
    episodeId
  );
  const action = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={onPress}
      style={{ minHeight: 44, paddingVertical: 10, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
  return (
    <View style={{ gap: 4 }}>
      {(episodes.length > 0 || episodeId) &&
        action(
          `${t("ipBookmark.target")}: ${episode?.title ?? (episodeId ? t("ipBookmark.unavailable") : t("ipBookmark.wholeIp"))}`,
          () => setOpen(!open)
        )}
      {open && (
        <View
          style={{
            backgroundColor: theme.backgroundElement,
            paddingHorizontal: 12,
            borderRadius: 8,
          }}
        >
          {[{ id: null, title: t("ipBookmark.wholeIp") }, ...episodes].map((item) => (
            <Pressable
              key={item.id ?? "ip"}
              accessibilityRole="radio"
              aria-checked={episodeId === item.id}
              accessibilityState={{ checked: episodeId === item.id }}
              onPress={() => {
                setEpisodeId(item.id);
                setOpen(false);
              }}
              style={{ minHeight: 44, paddingVertical: 10 }}
            >
              <ThemedText type="small">{item.title}</ThemedText>
            </Pressable>
          ))}
        </View>
      )}
      {!valid && <ThemedText accessibilityRole="alert">{t("ipBookmark.unavailable")}</ThemedText>}
      {action(
        t(
          state.busy
            ? "contentGpsDiscovery.loading"
            : state.saved
              ? "contentGpsDiscovery.removeBookmark"
              : episodeId
                ? "ipBookmark.episode"
                : "contentGpsDiscovery.bookmark"
        ),
        () => {
          if (viewer) void state.toggle();
          else gate.requireAuth();
        },
        !active ||
          !valid ||
          auth.status === "hydrating" ||
          Boolean(viewer && (state.busy || !state.known))
      )}
      {state.error && <ThemedText accessibilityRole="alert">{state.error}</ThemedText>}
      {viewer &&
        valid &&
        !state.known &&
        !state.busy &&
        action(t("contentGpsDiscovery.retry"), state.retry)}
    </View>
  );
}
