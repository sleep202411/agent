import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, Platform, Pressable, View } from "react-native";
import { useAuth } from "@/auth";
import { api } from "@/lib/api-client";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { useStoryChapterContext } from "../context/story-chapter-context";
import { AppStoryNativeView } from "./app-story-native-view";

export function AppStoryEntry({ legacy }: { legacy: ReactNode }) {
  const auth = useAuth();
  const chapter = useStoryChapterContext();
  const t = useTranslations();
  const config = useQuery({
    queryKey: ["app-story-config", auth.generation],
    enabled: Platform.OS !== "web" && auth.status === "authenticated",
    retry: false,
    queryFn: async ({ signal }) => {
      const value = await api.get<{ enabled: boolean; path: string }>("/app-story-agent/config", {
        service: "aurora",
        signal,
      });
      if (
        typeof value?.enabled !== "boolean" ||
        value.path !== "/aurora/app-story-agent/ui/index.html"
      )
        throw new Error("Invalid App Story configuration.");
      return value;
    },
  });
  if (Platform.OS === "web" || auth.status !== "authenticated" || config.data?.enabled === false)
    return legacy;
  if (config.error || chapter.error)
    return (
      <View style={{ padding: 20, gap: 12 }}>
        <ThemedText>{config.error?.message || chapter.error}</ThemedText>
        <Pressable
          onPress={() => {
            void config.refetch();
            chapter.refresh();
          }}
        >
          <ThemedText>{t("common.retry")}</ThemedText>
        </Pressable>
      </View>
    );
  if (!config.data || !chapter.chapterId) return <ActivityIndicator />;
  return <AppStoryNativeView projectId={chapter.projectId} chapterId={chapter.chapterId} />;
}
