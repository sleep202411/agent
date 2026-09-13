import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api-client";
import { ThemedText } from "@/components/themed-text";
type Feedback = { likes: number; dislikes: number; mine: number | null };
export function EpisodeFeedback({ ipId, episodeId }: { ipId: string; episodeId: string }) {
  const auth = useAuth();
  const active = useScreenActive();
  if (!active) return null;
  return (
    <Panel
      key={`${ipId}:${episodeId}:${auth.session?.region}:${auth.session?.updatedAt}:${auth.user?.id ?? auth.user?.userId ?? "guest"}`}
      ipId={ipId}
      episodeId={episodeId}
      signedIn={auth.status === "authenticated"}
    />
  );
}
function Panel({
  ipId,
  episodeId,
  signedIn,
}: {
  ipId: string;
  episodeId: string;
  signedIn: boolean;
}) {
  const t = useTranslations();
  const gate = useAuthGate();
  const [data, setData] = useState<Feedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);
  const operation = useRef<AbortController | null>(null);
  const url = `/ip-commerce/ips/${encodeURIComponent(ipId)}/episodes/${encodeURIComponent(episodeId)}/feedback`;
  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    api
      .get<Feedback>(url, { signal: controller.signal, service: "aurora" })
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setError(null);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(String(err instanceof Error ? err.message : err));
      })
      .finally(() => {
        if (operation.current === controller) operation.current = null;
      });
    return () => {
      controller.abort();
      operation.current?.abort();
      operation.current = null;
    };
  }, [url, retry]);
  async function vote(value: 1 | -1) {
    if (!signedIn) {
      gate.openLogin();
      return;
    }
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(null);
    try {
      const result = await api.put<Feedback>(url, {
        service: "aurora",
        data: { value: data?.mine === value ? null : value },
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setData(result);
    } catch (err) {
      if (!controller.signal.aborted) setError(String(err instanceof Error ? err.message : err));
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setPending(false);
      }
    }
  }
  return (
    <View style={{ gap: 8, paddingVertical: 12 }}>
      <ThemedText type="small">{t("episodeFeedback.title")}</ThemedText>
      {!data && !error && <ActivityIndicator accessibilityLabel={t("episodeFeedback.loading")} />}
      <View style={{ flexDirection: "row", gap: 12 }}>
        {([1, -1] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: data?.mine === value, disabled: pending || !data }}
            disabled={pending || !data}
            onPress={() => void vote(value)}
            style={{
              minHeight: 44,
              padding: 12,
              borderRadius: 8,
              backgroundColor: data?.mine === value ? "#E52227" : "#24262b",
              opacity: pending ? 0.5 : 1,
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
            disabled={pending}
            accessibilityRole="button"
            onPress={() => setRetry((n) => n + 1)}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <ThemedText>{t("episodeFeedback.retry")}</ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}
