import { useState } from "react";
import { AuthedWebView } from "@/components/authed-web-view";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { ApplicationReview } from "@/features/services/application-review";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

export default function ApplicationReviewScreen() {
  const auth = useAuth();
  return <Session key={auth.generation} />;
}
function Session() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth(),
    gate = useAuthGate(),
    active = useScreenActive();
  const theme = useTheme(),
    t = useTranslations(),
    router = useRouter();
  const [web, setWeb] = useState(false);
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("applicationReview.title"),
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
      ) : active && userId && typeof id === "string" && id.trim() && id.length <= 64 ? (
        web ? (
          <View style={{ flex: 1 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setWeb(false)}
              style={{ padding: 16 }}
            >
              <ThemedText>{t("nativeApplications.back")}</ThemedText>
            </Pressable>
            <AuthedWebView
              path={`/crews/${encodeURIComponent(id)}/workspace?tab=positions`}
              title={t("applicationReview.title")}
            />
          </View>
        ) : (
          <ApplicationReview
            key={`${id}:${auth.generation}`}
            crewId={id}
            userId={userId}
            generation={auth.generation}
            onWeb={() => setWeb(true)}
            onClose={() => router.back()}
          />
        )
      ) : null}
    </View>
  );
}
