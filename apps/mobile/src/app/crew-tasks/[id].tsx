import { z } from "zod";
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { CrewTaskBrowser } from "@/features/services/crew-task-browser";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

export default function CrewTasksScreen() {
  const { id, task, section } = useLocalSearchParams<{
    id: string;
    task?: string;
    section?: string;
  }>();
  const initialSection =
    !task && (section === "members" || section === "setup" || section === "studio")
      ? section
      : undefined;
  const initialTaskId = z.string().uuid().safeParse(task).success ? task : undefined;
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
          headerTitle: t("crewTasks.title"),
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
        <CrewTaskBrowser
          key={`${id}:${initialTaskId ?? ""}:${initialSection ?? ""}:${auth.generation}`}
          initialTaskId={initialTaskId}
          initialSection={initialSection}
          crewId={id}
          userId={userId}
          generation={auth.generation}
          onClose={() => router.back()}
        />
      ) : null}
    </View>
  );
}
