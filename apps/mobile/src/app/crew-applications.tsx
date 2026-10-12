import { Stack } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { AuthedWebView } from "@/components/authed-web-view";
import { ThemedText } from "@/components/themed-text";
import { CrewApplications } from "@/features/services/crew-applications";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
export default function CrewApplicationsScreen() {
  const auth = useAuth();
  return <Session key={auth.generation} />;
}
function Session() {
  const auth = useAuth(),
    gate = useAuthGate(),
    theme = useTheme(),
    t = useTranslations();
  const [web, setWeb] = useState(false);
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  if (web)
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <Pressable accessibilityRole="button" style={{ padding: 16 }} onPress={() => setWeb(false)}>
          <ThemedText>{t("nativeApplications.back")}</ThemedText>
        </Pressable>
        <AuthedWebView path="/crews/applications" title={t("crewTerms.myApplications")} />
      </View>
    );
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("crewTerms.myApplications"),
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
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
          <ThemedText>{t("crewTerms.signIn")}</ThemedText>
        </Pressable>
      ) : userId ? (
        <CrewApplications userId={userId} generation={auth.generation} onWeb={() => setWeb(true)} />
      ) : null}
    </View>
  );
}
