import { toHref } from "@/lib/navigation";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { PrivateCases } from "@/features/services/private-cases";
export default function PrivateCasesScreen() {
  const { caseId } = useLocalSearchParams<{ caseId?: string }>();
  const router = useRouter();
  const auth = useAuth(),
    gate = useAuthGate(),
    theme = useTheme(),
    t = useTranslations();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("feedbackHistory.cases"),
          headerTintColor: theme.text,
          headerStyle: { backgroundColor: theme.background },
        }}
      />
      <Pressable
        accessibilityRole="button"
        style={{ padding: 16 }}
        onPress={() => router.push(toHref("/content-reports"))}
      >
        <ThemedText>{t("contentReports.title")}</ThemedText>
      </Pressable>
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 16 }}
          onPress={() => gate.requireAuth()}
        >
          <ThemedText>{t("login.signIn")}</ThemedText>
        </Pressable>
      ) : (
        <PrivateCases
          key={`${auth.generation}:${userId}`}
          initialCaseId={typeof caseId === "string" ? caseId : undefined}
          userId={userId}
          generation={auth.generation}
        />
      )}
    </View>
  );
}
