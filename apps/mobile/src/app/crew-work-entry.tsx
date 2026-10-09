import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { CrewWorkEntry } from "@/features/services/crew-work-entry";
export default function CrewWorkEntryScreen() {
  const params = useLocalSearchParams<{ mode?: string }>(),
    mode = params.mode === "position" ? "position" : "task";
  const auth = useAuth(),
    gate = useAuthGate(),
    router = useRouter(),
    theme = useTheme(),
    t = useTranslations();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t(mode === "position" ? "taskEntry.positionTitle" : "taskEntry.title"),
          headerTintColor: theme.text,
          headerStyle: { backgroundColor: theme.background },
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
          <ThemedText>{t("taskEntry.signIn")}</ThemedText>
        </Pressable>
      ) : (
        <CrewWorkEntry
          userId={userId}
          generation={auth.generation}
          mode={mode}
          onClose={() => router.back()}
        />
      )}
    </View>
  );
}
