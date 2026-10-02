import { useSyncExternalStore } from "react";
import { useIsFocused, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { CrewInviteLinks } from "@/features/services/crew-invite-links";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";
const subscribeHydration = () => () => {};
export default function CrewInviteLinksScreen() {
  const ready = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false
  );
  const { crewId } = useLocalSearchParams<{ crewId?: string }>();
  const auth = useAuth(),
    gate = useAuthGate(),
    router = useRouter(),
    focused = useIsFocused(),
    theme = useTheme(),
    t = useTranslations();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  if (!ready) return <ActivityIndicator />;
  const valid = typeof crewId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(crewId);
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("crewLinks.title"),
          headerBackButtonDisplayMode: "minimal",
        }}
      />
      {!valid ? (
        <ThemedText accessibilityRole="alert">{t("crewLinks.invalidCrew")}</ThemedText>
      ) : auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            gate.openLogin({
              onAuthenticated: () => router.replace(toHref(`/crew-invite-links?crewId=${crewId}`)),
            })
          }
          style={{ padding: 16 }}
        >
          <ThemedText>{t("auth.signIn")}</ThemedText>
        </Pressable>
      ) : focused && userId ? (
        <CrewInviteLinks
          crewId={crewId}
          userId={userId}
          generation={auth.generation}
          onClose={() => router.replace(toHref(`/crew-tasks/${crewId}?section=members`))}
        />
      ) : null}
    </View>
  );
}
