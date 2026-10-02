import { ActivityIndicator, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { StoryPlotImportAction } from "@/features/agent/components/story-plot-import";
import { StoryScriptEditor } from "@/features/agent/components/story-script-editor";
import { useStoryChapterContext } from "@/features/agent/context/story-chapter-context";
import { useTranslations } from "@/i18n";

export default function AgentScriptScreen() {
  const t = useTranslations();
  const { projectId, chapterId, capabilities, loading, error, refresh } = useStoryChapterContext();
  return (
    <ThemedView style={{ flex: 1 }}>
      {loading ? (
        <ActivityIndicator />
      ) : error ? (
        <View style={{ padding: 16, gap: 8 }}>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable accessibilityRole="button" onPress={refresh}>
            <ThemedText>{t("common.retry")}</ThemedText>
          </Pressable>
        </View>
      ) : chapterId ? (
        <>
          <StoryPlotImportAction
            projectId={projectId}
            chapterId={chapterId}
            canEdit={capabilities.includes("story.edit")}
            onImported={refresh}
          />
          <StoryScriptEditor
            projectId={projectId}
            chapterId={chapterId}
            canEdit={capabilities.includes("story.edit")}
          />
        </>
      ) : (
        <ThemedText>{t("agent.script.empty")}</ThemedText>
      )}
    </ThemedView>
  );
}
