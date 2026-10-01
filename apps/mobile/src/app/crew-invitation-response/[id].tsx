import { toHref } from "@/lib/navigation";
import { z } from "zod";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { CrewInvitationResponse } from "@/features/services/crew-invitation-response";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

export default function CrewInvitationResponseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth(),
    gate = useAuthGate(),
    active = useScreenActive();
  const theme = useTheme(),
    t = useTranslations(),
    router = useRouter();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
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
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => gate.requireAuth()}
          style={{ padding: 16 }}
        >
          <ThemedText>{t("inbox.signIn")}</ThemedText>
        </Pressable>
      ) : active && userId && typeof id === "string" && z.string().uuid().safeParse(id).success ? (
        <CrewInvitationResponse
          key={`${id}:${auth.generation}`}
          invitationId={id}
          userId={userId}
          generation={auth.generation}
          onOpenCrew={(crewId) => router.replace(toHref(`/crew-tasks/${crewId}`))}
        />
      ) : active && userId ? (
        <ThemedText>{t("crewInvitations.notFoundBody")}</ThemedText>
      ) : null}
    </View>
  );
}
