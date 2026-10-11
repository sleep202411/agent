import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth, useAuthGate } from "@/auth";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { invalidateBrowse } from "@/data/browse-refresh";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";
import { fetchIpFanCommunity, joinIpFanCommunity } from "./fan-community-api";

export function IpFanCommunity({ ipId }: { ipId: string }) {
  const auth = useAuth(),
    active = useScreenActive(),
    locale = useLocale();
  const [retry, setRetry] = useState(0);
  // Returning from login or another route re-resolves the viewer-visible link.
  if (!active || auth.status === "hydrating") return null;
  return (
    <Entry
      key={JSON.stringify([ipId, auth.generation, locale, retry])}
      ipId={ipId}
      authenticated={auth.status === "authenticated"}
      retry={() => setRetry((n) => n + 1)}
    />
  );
}
function Entry({
  ipId,
  authenticated,
  retry,
}: {
  ipId: string;
  authenticated: boolean;
  retry: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    router = useRouter(),
    gate = useAuthGate();
  const op = useAuthFormOperation(ipId, useScreenActive());
  const [crew, setCrew] = useState<Awaited<ReturnType<typeof fetchIpFanCommunity>>>();
  const [loadError, setLoadError] = useState<string>();
  const [joinError, setJoinError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchIpFanCommunity(ipId, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setCrew(result);
      },
      (cause) => {
        if (!controller.signal.aborted)
          setLoadError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [ipId]);
  if ((crew === undefined && loadError === undefined) || crew === null) return null;
  return (
    <View style={{ gap: 8, alignItems: "flex-start" }}>
      {crew && (
        <Pressable
          accessibilityRole="button"
          disabled={op.busy}
          style={{
            minHeight: 44,
            justifyContent: "center",
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 8,
            backgroundColor: theme.backgroundElement,
            opacity: op.busy ? 0.5 : 1,
          }}
          onPress={() => {
            if (!authenticated) {
              gate.requireAuth();
              return;
            }
            setJoinError(undefined);
            void op.run(
              async () => {
                await joinIpFanCommunity(crew.id);
                invalidateBrowse();
              },
              () =>
                router.push(toHref(`/crew-chat/${encodeURIComponent(crew.id)}?channel=community`)),
              (cause) => setJoinError(cause instanceof Error ? cause.message : String(cause))
            );
          }}
        >
          <ThemedText type="smallBold">{t("ipDetail.joinFanGroup")}</ThemedText>
        </Pressable>
      )}
      {op.busy && <ActivityIndicator color={theme.textSecondary} />}
      {(loadError !== undefined || joinError !== undefined) && (
        <ThemedText type="small" accessibilityRole="alert">
          {joinError || loadError || t("ipDetail.fanGroupFailed")}
        </ThemedText>
      )}
      {loadError !== undefined && (
        <Pressable
          accessibilityRole="button"
          onPress={retry}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <ThemedText type="smallBold" style={{ color: theme.brand }}>
            {t("common.retry")}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}
