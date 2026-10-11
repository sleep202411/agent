import { z } from "zod";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { IpProfileEditor } from "@/features/ip-author/profile-editor";
export default function IpStudioScreen() {
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
          headerRight:
            auth.status === "authenticated" &&
            typeof id === "string" &&
            z.string().uuid().safeParse(id).success
              ? () => (
                  <View style={{ flexDirection: "row" }}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => router.push(`/ip-studio/${id}/episodes` as never)}
                      style={{ padding: 8 }}
                    >
                      <ThemedText>{t("ipEpisodes.heading")}</ThemedText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => router.push(`/ip-studio/${id}/media` as never)}
                      style={{ padding: 8 }}
                    >
                      <ThemedText>{t("ipMedia.heading")}</ThemedText>
                    </Pressable>
                  </View>
                )
              : undefined,
          headerTitle: t("ipAuthor.heading"),
          headerTintColor: theme.text,
          headerStyle: { backgroundColor: theme.background },
        }}
      />
      {auth.status === "authenticated" &&
        typeof id === "string" &&
        z.string().uuid().safeParse(id).success && (
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {(
              [
                { path: "contributors", label: "ipContributors.heading" },
                { path: "rights", label: "ipGovernance.heading" },
                { path: "commerce", label: "ipCommerce.heading" },
                { path: "pricing", label: "ipPricing.heading" },
                { path: "review", label: "ipReview.heading" },
                { path: "templates", label: "ipTemplates.heading" },
                { path: "knowledge", label: "ipKnowledgeAdmin.heading" },
                { path: "locations", label: "contentGpsOwner.title" },
              ] as const
            ).map((item) => (
              <Pressable
                key={item.path}
                accessibilityRole="button"
                onPress={() => router.push(`/ip-studio/${id}/${item.path}` as never)}
                style={{ paddingHorizontal: 16, paddingVertical: 12 }}
              >
                <ThemedText type="small">{t(item.label)}</ThemedText>
              </Pressable>
            ))}
          </View>
        )}
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable accessibilityRole="button" onPress={() => gate.requireAuth()}>
          <ThemedText>{t("login.signIn")}</ThemedText>
        </Pressable>
      ) : typeof id === "string" && z.string().uuid().safeParse(id).success && userId ? (
        <IpProfileEditor
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
