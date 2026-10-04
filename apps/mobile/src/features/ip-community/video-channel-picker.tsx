import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { z, ZodError } from "zod";
import { useAuth, useAuthGate } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations } from "@/i18n";
import { api } from "@/lib/api-client";
import { toHref } from "@/lib/navigation";
import { ChannelVideoSubmit } from "./channel-video-submit";

const channel = z.object({ id: z.string().uuid(), title: z.string() });
const pageSchema = z.object({ items: z.array(channel), nextCursor: z.string().nullable() });
type Channel = z.infer<typeof channel>;
export function VideoChannelPicker() {
  const { generation } = useAuth(),
    locale = useLocale();
  return (
    <Picker key={JSON.stringify([generation, locale])} generation={generation} locale={locale} />
  );
}
function Picker({ generation, locale }: { generation: number; locale: string }) {
  const t = useTranslations(),
    theme = useTheme(),
    auth = useAuth(),
    gate = useAuthGate(),
    router = useRouter();
  const active = useScreenActive();
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Channel | null>(null);
  const [page, setPage] = useState<z.infer<typeof pageSchema>>();
  const [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0),
    [cursor, setCursor] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  const failed = useEffectEvent(() => t("channelSubmissions.failed"));
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!open || !active || selected || query !== search.trim()) return;
    const controller = new AbortController();
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError(null);
      try {
        const value = pageSchema.parse(
          await api.get("/ip-commerce/ips", {
            service: "aurora",
            retry: false,
            signal: controller.signal,
            params: {
              channelType: "community",
              q: query || undefined,
              locale,
              limit: 20,
              cursor: cursor ?? undefined,
            },
          })
        );
        if (controller.signal.aborted || generation !== getAuthGeneration()) return;
        if (
          cursor &&
          value.nextCursor &&
          (value.nextCursor === cursor || seen.current.has(value.nextCursor))
        )
          throw Error(failed());
        if (!cursor) seen.current.clear();
        else seen.current.add(cursor);
        setPage((previous) => ({
          ...value,
          items: [
            ...new Map(
              [...(cursor ? (previous?.items ?? []) : []), ...value.items].map((item) => [
                item.id,
                item,
              ])
            ).values(),
          ],
        }));
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error && !(cause instanceof ZodError) ? cause.message : failed()
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    });
    return () => controller.abort();
  }, [open, active, selected, query, search, cursor, retry, generation, locale]);
  if (!active) return null;
  const button = (label: string, onPress: () => void, disabled = false) => (
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
  return (
    <View style={{ gap: 8 }}>
      {button(t(open ? "common.cancel" : "channelVideos.submit"), () => {
        if (auth.status !== "authenticated") {
          gate.requireAuth();
          return;
        }
        setOpen(!open);
      })}
      {open &&
        (selected ? (
          <>
            <ThemedText type="smallBold">{selected.title}</ThemedText>
            {button(t("channelVideos.changeChannel"), () => {
              setSelected(null);
              setCursor(null);
              setPage(undefined);
            })}
            <ChannelVideoSubmit
              scope={{ ipId: selected.id, generation, locale }}
              onSubmitted={() => router.push(toHref(`/ip/${selected.id}`))}
            />
          </>
        ) : (
          <>
            <TextInput
              accessibilityLabel={t("channelVideos.searchChannels")}
              placeholder={t("channelVideos.searchChannels")}
              placeholderTextColor={theme.textSecondary}
              value={search}
              onChangeText={(value) => {
                setSearch(value);
                setPage(undefined);
                setCursor(null);
                setError(null);
              }}
              style={{
                color: theme.text,
                borderWidth: 1,
                borderColor: theme.border,
                padding: 10,
                borderRadius: 8,
              }}
            />
            {loading && <ActivityIndicator accessibilityLabel={t("channelSubmissions.loading")} />}
            {error && (
              <ThemedText type="small" accessibilityRole="alert">
                {error}
              </ThemedText>
            )}
            {error &&
              button(t("channelSubmissions.retry"), () => setRetry((value) => value + 1), loading)}
            {!loading && !error && page && !page.items.length && (
              <ThemedText type="small">{t("channelVideos.noChannels")}</ThemedText>
            )}
            {page?.items.map((item) => (
              <View key={item.id}>
                {button(
                  item.title,
                  () => setSelected(item),
                  loading || !!error || query !== search.trim()
                )}
              </View>
            ))}
            {page?.nextCursor &&
              button(
                t("channelSubmissions.more"),
                () => setCursor(page.nextCursor),
                loading || !!error
              )}
          </>
        ))}
    </View>
  );
}
