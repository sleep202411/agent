import { z } from "zod";
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { CrewAgreements } from "@/features/services/crew-agreements";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

export default function CrewAgreementsScreen() {
  const { id, agreement } = useLocalSearchParams<{ id: string; agreement?: string }>();
  const initialAgreementId = z.string().uuid().safeParse(agreement).success ? agreement : undefined;
  const auth = useAuth(),
    gate = useAuthGate(),
    active = useIsFocused();
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
          key={`${id}:${initialAgreementId ?? ""}:${auth.generation}`}
          initialAgreementId={initialAgreementId}
          crewId={id}
          userId={userId}
          generation={auth.generation}
          onClose={() => router.back()}
        />
      ) : null}
    </View>
  );
}
