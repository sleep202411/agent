import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { loadStoryScriptSnapshot } from "@/features/agent/api/story-production-api";
import { StoryScreenplayView } from "@/features/agent/components/story-screenplay-view";
import { useStoryChapterContext } from "@/features/agent/context/story-chapter-context";
import { scriptDocumentToMarkdown } from "@/features/agent/lib/parse-script-snapshot";
import { STORY_HEADER_CONTENT_GAP } from "@/features/agent/lib/story-tab-bar";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

/**
 * Read-only script tab — renders the same TipTap/Yjs document PC edits.
 * No collaborative editing on mobile.
 */
export default function AgentScriptScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const {
    projectId,
    chapterId,
    loading: chapterLoading,
    error: chapterError,
  } = useStoryChapterContext();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [markdown, setMarkdown] = useState("");

  const resourceKey = `${projectId}:${chapterId}`;
  const [previousResourceKey, setPreviousResourceKey] = useState(resourceKey);
  if (previousResourceKey !== resourceKey) {
    setPreviousResourceKey(resourceKey);
    setLoading(true);
    setError(undefined);
  }

  const loadScript = useCallback(
    (signal?: AbortSignal) => {
      if (!chapterId) return;
      return loadStoryScriptSnapshot(projectId, chapterId, signal)
        .then((result) => {
          if (signal?.aborted) return;
          setMarkdown(scriptDocumentToMarkdown({ contentSnapshot: result.contentSnapshot }));
          setError(undefined);
        })
        .catch((err: unknown) => {
          if (signal?.aborted) return;
          setMarkdown("");
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (signal?.aborted) return;
          setLoading(false);
          setRefreshing(false);
        });
    },
    [chapterId, projectId]
  );

  useEffect(() => {
    if (!chapterId || chapterLoading) return;
    const controller = new AbortController();
    void loadScript(controller.signal);
    return () => controller.abort();
  }, [chapterId, chapterLoading, loadScript]);

  const topPad = STORY_HEADER_CONTENT_GAP;
  const busy = chapterLoading || loading;
  const displayError = chapterError ?? error;
  const isEmpty = !busy && !displayError && markdown.length === 0;

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        refreshControl={
          chapterId ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadScript();
              }}
              tintColor={theme.brand}
            />
          ) : undefined
        }
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: topPad,
            paddingBottom: Spacing.five,
          },
        ]}
      >
        {busy ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.brand} />
            <ThemedText type="small" themeColor="textSecondary">
              {t("agent.script.connecting")}
            </ThemedText>
          </View>
        ) : null}

        {!busy && displayError ? (
          <View style={styles.centered}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.errorText}>
              {t("agent.script.openError")}
            </ThemedText>
            <Pressable onPress={() => void loadScript()} hitSlop={8}>
              <ThemedText type="small" themeColor="textSecondary">
                {t("common.retry")}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {isEmpty ? (
          <View style={styles.docColumn}>
            <ThemedText style={styles.empty}>{t("agent.script.empty")}</ThemedText>
          </View>
        ) : null}

        {!busy && !displayError && markdown.length > 0 ? (
          <StoryScreenplayView markdown={markdown} />
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    minHeight: 280,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.five,
  },
  errorText: {
    textAlign: "center",
    maxWidth: 340,
    opacity: 0.72,
  },
  docColumn: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.five,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.six,
  },
  empty: {
    fontSize: 15,
    lineHeight: 24,
    color: "rgba(255,255,255,0.62)",
  },
});
