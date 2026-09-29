import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { CrewAgreements } from "@/features/services/crew-agreements";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

export default function CrewAgreementsScreen() {
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
          headerTitle: t("crewAgreements.title"),
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
      ) : active && userId && typeof id === "string" && id.trim() && id.length <= 64 ? (
        <CrewAgreements
          key={`${id}:${auth.generation}`}
          crewId={id}
          userId={userId}
          generation={auth.generation}
          onClose={() => router.back()}
        />
      ) : null}
    </View>
  );
}
