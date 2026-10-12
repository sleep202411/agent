import { Stack, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { WorkspaceGenerationPanel } from "@/features/ai-lab/workspace-panel";
export default function GenerationScreen() {
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
          headerTitle: t("aiLab.heading"),
          headerTintColor: theme.text,
          headerStyle: { backgroundColor: theme.background },
        }}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/casting-invite")}
        style={{ paddingHorizontal: 16, paddingVertical: 8 }}
      >
        <ThemedText type="small">{t("castingAccept.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/likeness-authorizations")}
        style={{ paddingHorizontal: 16, paddingVertical: 8 }}
      >
        <ThemedText type="small">{t("likenessGrants.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/character-library")}
        style={{ paddingHorizontal: 16, paddingVertical: 8 }}
      >
        <ThemedText type="small">{t("characterLibrary.title")}</ThemedText>
      </Pressable>
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable accessibilityRole="button" onPress={() => gate.requireAuth()}>
          <ThemedText>{t("login.signIn")}</ThemedText>
        </Pressable>
      ) : userId ? (
        <WorkspaceGenerationPanel
          key={`${userId}:${auth.generation}`}
          userId={userId}
          generation={auth.generation}
        />
      ) : (
        <ThemedText>{t("ipAuthor.invalid")}</ThemedText>
      )}
    </View>
  );
}
