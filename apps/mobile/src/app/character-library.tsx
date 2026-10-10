import { Stack } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { CharacterLibraryPanel } from "@/features/ai-lab/character-library-panel";
export default function CharacterLibraryScreen() {
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
          title: t("characterLibrary.title"),
          headerBackButtonDisplayMode: "minimal",
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
          <ThemedText>{t("login.signIn")}</ThemedText>
        </Pressable>
      ) : userId ? (
        <CharacterLibraryPanel
          key={`${userId}:${auth.generation}`}
          userId={userId}
          generation={auth.generation}
        />
      ) : null}
    </View>
  );
}
