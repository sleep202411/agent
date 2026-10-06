import { toHref } from "@/lib/navigation";
import { Stack, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { TaskCenter } from "@/features/services/task-center";
export default function TaskCenterScreen() {
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
          headerTitle: t("crewTaskCenter.title"),
          headerTintColor: theme.text,
          headerStyle: { backgroundColor: theme.background },
        }}
      />
      <Pressable
        accessibilityRole="button"
        style={{ padding: 16 }}
        onPress={() => router.push(toHref("/crew-work-entry"))}
      >
        <ThemedText>{t("taskEntry.title")}</ThemedText>
      </Pressable>
      <ThemedText type="small" style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        {t("taskEntry.actionHelp")}
      </ThemedText>
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
        <TaskCenter
          key={`${auth.generation}:${userId}`}
          userId={userId}
          generation={auth.generation}
        />
      )}
    </View>
  );
}
