import { Stack, useIsFocused } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { TextAdventureLibrary } from "@/features/agent/text-adventure-library";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

export default function TextAdventureLibraryScreen() {
  const auth = useAuth(),
    gate = useAuthGate(),
    focused = useIsFocused();
  const theme = useTheme(),
    t = useTranslations();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("textAdventures.library.title"),
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
      ) : focused && userId ? (
        <TextAdventureLibrary
          key={`${userId}:${auth.generation}`}
          session={{ userId, generation: auth.generation }}
        />
      ) : null}
    </View>
  );
}
