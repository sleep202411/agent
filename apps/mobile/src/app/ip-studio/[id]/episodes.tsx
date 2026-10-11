import { z } from "zod";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { IpEpisodesPanel } from "@/features/ip-author/episodes-panel";
export default function IpEpisodesScreen() {
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
          headerTitle: t("ipEpisodes.heading"),
          headerRight: () =>
            typeof id === "string" && z.string().uuid().safeParse(id).success ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (gate.requireAuth()) router.push(`/ip-studio/${id}/create-episode`);
                }}
                style={{ padding: 8 }}
              >
                <ThemedText>{t("ipEpisodeCreate.create")}</ThemedText>
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
        <IpEpisodesPanel
          key={`${id}:${userId}:${auth.generation}`}
          ipId={id}
          userId={userId}
          generation={auth.generation}
          onOpenMedia={(episodeId) =>
            router.push(`/ip-studio/${id}/episode-media?episodeId=${episodeId}`)
          }
        />
      ) : (
        <ThemedText>{t("ipAuthor.invalid")}</ThemedText>
      )}
    </View>
  );
}
