import { z } from "zod";
import { Stack, useIsFocused, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { CrewChat } from "@/features/services/crew-chat";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

export default function CrewChatScreen() {
  const { id, channel = "team" } = useLocalSearchParams<{ id: string; channel?: string }>();
  const auth = useAuth(),
    gate = useAuthGate(),
    active = useIsFocused();
  const theme = useTheme(),
    t = useTranslations();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t(channel === "community" ? "thread.communityChat" : "thread.teamChat"),
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
      ) : active &&
        userId &&
        typeof id === "string" &&
        z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,64}$/)
          .safeParse(id).success &&
        (channel === "team" || channel === "community") ? (
        <CrewChat
          key={`${id}:${channel}:${auth.generation}`}
          channel={channel}
          crewId={id}
          userId={userId}
          generation={auth.generation}
        />
      ) : null}
    </View>
  );
}
