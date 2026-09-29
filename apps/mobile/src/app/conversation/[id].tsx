import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { NativeConversation } from "@/features/services/native-conversation";
export default function ConversationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth(),
    gate = useAuthGate(),
    t = useTranslations(),
    theme = useTheme();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("serviceContact.open"),
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
        }}
      />
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable accessibilityRole="button" onPress={() => gate.requireAuth()}>
          <ThemedText>{t("inbox.signIn")}</ThemedText>
        </Pressable>
      ) : typeof id === "string" && id && userId ? (
        <NativeConversation
          key={JSON.stringify([id, userId, auth.generation])}
          id={id}
          userId={userId}
          generation={auth.generation}
        />
      ) : (
        <ThemedText>{t("thread.unavailable")}</ThemedText>
      )}
    </View>
  );
}
