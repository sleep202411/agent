import { Stack } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { SubscriptionPanel } from "@/features/paywall/components/subscription-panel";
export default function SubscriptionScreen() {
  const auth = useAuth(),
    gate = useAuthGate(),
    theme = useTheme(),
    t = useTranslations();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ padding: 16 }}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("subscription.title"),
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerShadowVisible: false,
        }}
      />
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status === "authenticated" ? (
        <SubscriptionPanel generation={auth.generation} canManage />
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => gate.openLogin()}
          style={{ paddingVertical: 12 }}
        >
          <ThemedText>{t("login.signIn")}</ThemedText>
        </Pressable>
      )}
    </ScrollView>
  );
}
