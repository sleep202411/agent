import { useEffect, useState } from "react";
import { Stack, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { crewPositionLabel } from "@/lib/crew-position-label";
import { toHref } from "@/lib/navigation";
import {
  fetchSavedOpenings,
  type SavedOpeningScope,
  type SavedOpeningsPage,
} from "@/features/browse/saved-openings-api";

export default function SavedOpeningsScreen() {
  const auth = useAuth(),
    gate = useAuthGate(),
    active = useScreenActive(),
    locale = useLocale(),
    t = useTranslations(),
    theme = useTheme();
  const userId =
    auth.status === "authenticated" ? String(auth.user?.userId ?? auth.user?.id ?? "") : "";
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("savedOpenings.title"),
          headerBackButtonDisplayMode: "minimal",
        }}
      />
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : !userId ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => gate.requireAuth()}
          style={{ padding: 16, minHeight: 44 }}
        >
          <ThemedText>{t("savedOpenings.signIn")}</ThemedText>
        </Pressable>
      ) : active ? (
        <SavedOpenings
          key={`${auth.generation}:${userId}:${locale}`}
          userId={userId}
          generation={auth.generation}
        />
      ) : null}
    </View>
  );
}

export function SavedOpenings({ userId, generation }: SavedOpeningScope) {
  const t = useTranslations(),
    theme = useTheme(),
    router = useRouter();
  const [history, setHistory] = useState<(string | null)[]>([null]);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; page?: SavedOpeningsPage; error?: string }>();
  const cursor = history.at(-1)!;
  const key = JSON.stringify([userId, generation, history, revision]);
  const value = result?.key === key ? result : undefined;
  useEffect(() => {
    const controller = new AbortController();
    void fetchSavedOpenings({ userId, generation }, cursor, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        if (page.nextCursor && history.includes(page.nextCursor))
          throw Error("Saved openings changed. Refresh the list.");
        setResult({ key, page });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ key, error: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [userId, generation, cursor, history, key]);
  const action = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 44, padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="small">{t("savedOpenings.available")}</ThemedText>
      {action(t("thread.refresh"), () => {
        setHistory([null]);
        setRevision((n) => n + 1);
      })}
      {!value ? (
        <ActivityIndicator />
      ) : value.error ? (
        <>
          <ThemedText accessibilityRole="alert">{value.error}</ThemedText>
          {action(t("common.retry"), () => setRevision((n) => n + 1))}
        </>
      ) : value.page ? (
        <>
          {!value.page.items.length ? (
            <ThemedText>{t("savedOpenings.empty")}</ThemedText>
          ) : (
            value.page.items.map(({ position, crew }) => (
              <Pressable
                key={position.id}
                accessibilityRole="button"
                style={{
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: theme.backgroundElement,
                  gap: 6,
                }}
                onPress={() =>
                  router.push(
                    toHref(
                      `/crew-opening?crewId=${encodeURIComponent(crew.id)}&positionId=${encodeURIComponent(position.id)}`
                    )
                  )
                }
              >
                <ThemedText type="smallBold">
                  {crewPositionLabel(position.positionType, t)}
                </ThemedText>
                <ThemedText>{crew.name}</ThemedText>
                {position.location ? (
                  <ThemedText type="small">{position.location}</ThemedText>
                ) : null}
              </Pressable>
            ))
          )}
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            {action(
              t("creatorEarnings.pagination.previous"),
              () => setHistory((h) => (h.length > 1 && h.at(-1) === cursor ? h.slice(0, -1) : h)),
              history.length < 2
            )}
            {action(
              t("creatorEarnings.pagination.next"),
              () => {
                const next = value.page?.nextCursor;
                if (next) setHistory((h) => (h.at(-1) === cursor ? [...h, next] : h));
              },
              !value.page.nextCursor
            )}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
