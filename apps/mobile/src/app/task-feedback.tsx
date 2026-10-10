import { Stack } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { TaskFeedbackHistory } from "@/features/services/task-feedback";
export default function TaskFeedbackHistoryScreen() {
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
          headerTitle: t("feedbackHistory.title"),
          headerTintColor: theme.text,
          headerStyle: { backgroundColor: theme.background },
        }}
      />
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
        <TaskFeedbackHistory
          key={`${auth.generation}:${userId}`}
          userId={userId}
          generation={auth.generation}
        />
      )}
    </View>
  );
}
