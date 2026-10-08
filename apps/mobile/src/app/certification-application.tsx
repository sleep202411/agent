import { useSyncExternalStore } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { LevelApplicationForm } from "@/features/certificates/level-application";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";
const subscribe = () => () => {};
export default function CertificationApplicationScreen() {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  const { level } = useLocalSearchParams<{ level?: string }>();
  const auth = useAuth(),
    gate = useAuthGate(),
    router = useRouter(),
    theme = useTheme(),
    t = useTranslations();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  if (!ready) return <ActivityIndicator />;
  const valid = level === undefined || level === "13";
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ headerShown: true, title: t("levelApplication.title") }} />
      <Pressable
        accessibilityRole="link"
        style={{ padding: 16 }}
        onPress={() => router.push(toHref("/courses"))}
      >
        <ThemedText>{t("levelApplication.academy")}</ThemedText>
      </Pressable>
      {!valid ? (
        <ThemedText accessibilityRole="alert">{t("levelApplication.unavailable")}</ThemedText>
      ) : auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 16 }}
          onPress={() =>
            gate.openLogin({
              onAuthenticated: () =>
                router.replace(toHref(`/certification-application${level ? "?level=13" : ""}`)),
            })
          }
        >
          <ThemedText>{t("auth.signIn")}</ThemedText>
        </Pressable>
      ) : userId ? (
        <LevelApplicationForm
          userId={userId}
          generation={auth.generation}
          lockedLevelId={level ? 13 : undefined}
          onClose={() => router.back()}
        />
      ) : null}
    </View>
  );
}
