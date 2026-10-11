import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { z } from "zod";
import { useAuth, useAuthGate } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { api } from "@/lib/api-client";
import { ThemedText } from "@/components/themed-text";
const feedback = z.object({
  likes: z.number().int().nonnegative(),
  dislikes: z.number().int().nonnegative(),
  mine: z.union([z.literal(1), z.literal(-1), z.null()]),
});
type Feedback = z.infer<typeof feedback>;
export function EpisodeFeedback({
  ipId,
  episodeId,
  visible = true,
}: {
  ipId: string;
  episodeId: string;
  visible?: boolean;
}) {
  const auth = useAuth(),
    locale = useLocale();
  return (
    <Panel
      key={JSON.stringify([ipId, episodeId, auth.generation, locale])}
      ipId={ipId}
      episodeId={episodeId}
      visible={visible}
      generation={auth.generation}
      signedIn={auth.status === "authenticated"}
    />
  );
}
function Panel({
  ipId,
  episodeId,
  generation,
  signedIn,
  visible,
}: {
  ipId: string;
  episodeId: string;
  generation: number;
  signedIn: boolean;
  visible: boolean;
}) {
  const t = useTranslations(),
    gate = useAuthGate(),
    theme = useTheme();
  const screenActive = useScreenActive();
  const active = screenActive && visible;
  const [data, setData] = useState<Feedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [needsRead, setNeedsRead] = useState(true);
  const read = useRef<AbortController | null>(null);
  const inFlight = useRef<{ interrupted: boolean } | null>(null);
  const writing = useRef(false),
    live = useRef(false),
    foreground = useRef(false);
  const url = `/ip-commerce/ips/${encodeURIComponent(ipId)}/episodes/${encodeURIComponent(episodeId)}/feedback`;
  const current = () => live.current && getAuthGeneration() === generation;
  const message = (cause: unknown) =>
    cause instanceof Error && !(cause instanceof z.ZodError) && cause.message
      ? cause.message
      : t("episodeFeedback.failed");
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
  async function refresh() {
    if (!current() || !foreground.current || writing.current || read.current) return;
    const controller = new AbortController();
    read.current = controller;
    setLoading(true);
    setNeedsRead(true);
    setError(null);
    try {
      const value = feedback.parse(
        await api.get(url, { signal: controller.signal, service: "aurora", retry: false })
      );
      if (current() && !controller.signal.aborted) {
        setData(value);
        setNeedsRead(false);
      }
    } catch (cause) {
      if (current() && !controller.signal.aborted) setError(message(cause));
    } finally {
      if (current() && read.current === controller) {
        read.current = null;
        setLoading(false);
      }
    }
  }
  const onReturn = useEffectEvent(() => void refresh());
  useEffect(() => {
    let cancelled = false;
    if (active)
      queueMicrotask(() => {
        if (!cancelled) onReturn();
      });
    return () => {
      cancelled = true;
      read.current?.abort();
      read.current = null;
    };
  }, [active]);
  async function vote(value: 1 | -1) {
    if (!current() || !foreground.current || writing.current || read.current || needsRead || !data)
      return;
    if (!signedIn) {
      gate.openLogin();
      return;
    }
    writing.current = true;
    setPending(true);
    setError(null);
    const wasForeground = { interrupted: false };
    inFlight.current = wasForeground;
    try {
      // This is an absolute vote, not a toggle at the API. Do not abort/repost
      // an already-dispatched write just because the app loses focus.
      const result = feedback.parse(
        await api.put(url, {
          service: "aurora",
          retry: false,
          data: { value: data.mine === value ? null : value },
        })
      );
      if (current()) {
        if (!wasForeground.interrupted && foreground.current) {
          setData(result);
          setNeedsRead(false);
        } else setNeedsRead(true);
      }
    } catch (cause) {
      if (current()) {
        setError(message(cause));
        setNeedsRead(true);
      }
    } finally {
      writing.current = false;
      inFlight.current = null;
      if (current()) {
        setPending(false);
        if (wasForeground.interrupted && foreground.current) void refresh();
      }
    }
  }
  useLayoutEffect(() => {
    if (!active && inFlight.current) inFlight.current.interrupted = true;
  }, [active]);
  if (!active) return null;
  const disabled = pending || loading || needsRead || !data;
  return (
    <View style={{ gap: 8, paddingVertical: 12 }}>
      <ThemedText type="small">{t("episodeFeedback.title")}</ThemedText>
      {loading && <ActivityIndicator accessibilityLabel={t("episodeFeedback.loading")} />}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {([1, -1] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: data?.mine === value, disabled }}
            disabled={disabled}
            onPress={() => void vote(value)}
            style={{
              minHeight: 44,
              padding: 12,
              borderRadius: 8,
              backgroundColor: data?.mine === value ? theme.brand : theme.backgroundElement,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <ThemedText>
              {t(value === 1 ? "episodeFeedback.like" : "episodeFeedback.dislike")}{" "}
              {data ? (value === 1 ? data.likes : data.dislikes) : ""}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      {error && (
        <View accessibilityRole="alert">
          <ThemedText type="small">{error}</ThemedText>
          <Pressable
            disabled={pending || loading}
            accessibilityRole="button"
            onPress={() => void refresh()}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <ThemedText>{t("episodeFeedback.retry")}</ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}
