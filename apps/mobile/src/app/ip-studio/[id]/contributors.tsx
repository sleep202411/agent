import { z } from "zod";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { IpContributorsPanel } from "@/features/ip-author/contributors-panel";
export default function IpContributorsScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
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
          headerTitle: t("ipContributors.heading"),
          headerRight: () =>
            auth.status === "authenticated" &&
            typeof id === "string" &&
            z.string().uuid().safeParse(id).success ? (
              <Pressable
                accessibilityRole="button"
                style={{ padding: 8 }}
                onPress={() => router.push(`/ip-studio/${id}/access` as never)}
              >
                <ThemedText type="small">{t("ipAccess.heading")}</ThemedText>
              </Pressable>
            ) : null,
          headerTintColor: theme.text,
          headerStyle: { backgroundColor: theme.background },
        }}
      />
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable accessibilityRole="button" onPress={() => gate.requireAuth()}>
          <ThemedText>{t("login.signIn")}</ThemedText>
        </Pressable>
      ) : typeof id === "string" && z.string().uuid().safeParse(id).success && userId ? (
        <IpContributorsPanel
          key={`${id}:${userId}:${auth.generation}`}
          ipId={id}
          userId={userId}
          generation={auth.generation}
        />
      ) : (
        <ThemedText>{t("ipAuthor.invalid")}</ThemedText>
      )}
    </View>
  );
}
