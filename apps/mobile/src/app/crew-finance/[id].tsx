import { Stack, useLocalSearchParams, useRouter, useIsFocused } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { CrewFinance } from "@/features/services/crew-finance";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

export default function CrewFinanceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth(),
    gate = useAuthGate(),
    focused = useIsFocused();
  const theme = useTheme(),
    t = useTranslations(),
    router = useRouter();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("crewFinance.title"),
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
      ) : focused && userId && typeof id === "string" && id.trim() && id.length <= 64 ? (
        <CrewFinance
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
