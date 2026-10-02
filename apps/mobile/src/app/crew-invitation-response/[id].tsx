import { toHref } from "@/lib/navigation";
import { useSyncExternalStore } from "react";
import { z } from "zod";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { CrewInvitationResponse } from "@/features/services/crew-invitation-response";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
const subscribeHydration = () => () => {};

export default function CrewInvitationResponseScreen() {
  const ready = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false
  );
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth(),
    gate = useAuthGate(),
    active = useScreenActive();
  const theme = useTheme(),
    t = useTranslations(),
    router = useRouter();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  if (!ready) return <ActivityIndicator />;
  const invitationId =
    typeof id === "string" && z.string().uuid().safeParse(id).success ? id.toLowerCase() : null;
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("crewInvitations.eyebrow"),
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
        }}
      />
      {!invitationId ? (
        <ThemedText accessibilityRole="alert">{t("crewInvitations.notFoundBody")}</ThemedText>
      ) : auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            gate.openLogin({
              onAuthenticated: () =>
                router.replace(toHref(`/crew-invitation-response/${invitationId}`)),
            })
          }
          style={{ padding: 16 }}
        >
          <ThemedText>{t("auth.signIn")}</ThemedText>
        </Pressable>
      ) : active && userId ? (
        <CrewInvitationResponse
          key={`${invitationId}:${userId}:${auth.generation}`}
          invitationId={invitationId}
          userId={userId}
          generation={auth.generation}
          onOpenCrew={(crewId) => router.replace(toHref(`/crew-tasks/${crewId}`))}
        />
      ) : null}
    </View>
  );
}
