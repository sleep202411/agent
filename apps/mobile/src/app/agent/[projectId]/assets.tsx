import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import {
  storyProductionApi,
  type StoryAssetSpec,
  type StoryAssetSpecKind,
  type StoryProductionState,
} from "@/features/agent/api/story-production-api";
import { StoryAssetSpecCard } from "@/features/agent/components/story-asset-spec-card";
import { StoryAssetSpecDetailSheet } from "@/features/agent/components/story-asset-spec-detail-sheet";
import { useStoryChapterContext } from "@/features/agent/context/story-chapter-context";
import {
  storyAssetsStageGuidance,
  storyAssetsStageHasStaleContent,
} from "@/features/agent/lib/story-assets-stage-guidance";
import { STORY_HEADER_CONTENT_GAP } from "@/features/agent/lib/story-tab-bar";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations, type MessageKey } from "@/i18n";

const TABS: StoryAssetSpecKind[] = ["character", "location", "prop"];

function replaceCount(template: string, count: number): string {
  return template.replace(/\{count\}/g, String(count));
}

/** Browse-only assets gallery — mirrors H5 `StoryAssetsGallery` (no generation). */
export default function AgentAssetsScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const router = useRouter();
  const {
    projectId,
    chapterId,
    loading: chapterLoading,
    error: chapterError,
  } = useStoryChapterContext();
  const [activeTab, setActiveTab] = useState<StoryAssetSpecKind>("character");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [assets, setAssets] = useState<StoryAssetSpec[]>([]);
  const [production, setProduction] = useState<StoryProductionState | null>(null);
  const [detailAsset, setDetailAsset] = useState<StoryAssetSpec | null>(null);

  const loadAssets = useCallback(
    async (opts?: { refresh?: boolean }) => {
      if (!chapterId) return;
      if (opts?.refresh) setRefreshing(true);
      else setLoading(true);
      setError(undefined);
      try {
        const [rows, state] = await Promise.all([
          storyProductionApi.listAssetSpecs(projectId, chapterId),
          storyProductionApi.getProductionState(projectId, chapterId),
        ]);
        setAssets(rows);
        setProduction(state);
      } catch (err) {
        setAssets([]);
        setProduction(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [chapterId, projectId]
  );

  useEffect(() => {
    if (!chapterId || chapterLoading) return;
    void loadAssets();
  }, [chapterId, chapterLoading, loadAssets]);

  const filtered = useMemo(
    () => assets.filter((asset) => asset.kind === activeTab),
    [activeTab, assets]
  );
  const guidance = production ? storyAssetsStageGuidance(production, assets.length) : null;
  const staleContent = Boolean(
    production && storyAssetsStageHasStaleContent(production, assets.length)
  );
  const topPad = STORY_HEADER_CONTENT_GAP;
  const busy = chapterLoading || loading;
  const displayError = chapterError ?? error;
  const showGallery = !busy && !displayError && (guidance === null || staleContent);

  const continueWithAgent = (promptKey: MessageKey) => {
    router.push({
      pathname: "/agent/[projectId]",
      params: { projectId, prefill: t(promptKey) },
    });
  };

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        refreshControl={
          chapterId ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadAssets({ refresh: true })}
              tintColor={theme.brand}
            />
          ) : undefined
        }
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: topPad,
            paddingBottom: Spacing.five,
            paddingHorizontal: Spacing.four,
          },
        ]}
      >
        <View style={styles.header}>
          <ThemedText style={styles.pageTitle}>{t("agent.assets.title")}</ThemedText>
          <ThemedText style={styles.pageHint}>
            {t("agent.assets.generationHint")}
            {assets.length > 0 ? (
              <ThemedText style={styles.pageMeta}>
                {` ${replaceCount(t("agent.assets.count"), assets.length)}`}
              </ThemedText>
            ) : null}
          </ThemedText>
        </View>

        {showGallery ? (
          <View style={styles.tabs}>
            {TABS.map((tab) => {
              const selected = activeTab === tab;
              const staleCount = assets.filter(
                (asset) => asset.kind === tab && asset.status === "stale"
              ).length;
              return (
                <Pressable
                  key={tab}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => setActiveTab(tab)}
                >
                  <View style={[styles.tab, selected && styles.tabSelected]}>
                    <ThemedText style={[styles.tabLabel, selected && styles.tabLabelSelected]}>
                      {t(`agent.assets.tabs.${tab}`)}
                    </ThemedText>
                    {staleCount > 0 ? (
                      <View style={styles.staleCount}>
                        <ThemedText type="code" style={styles.staleCountLabel}>
                          {staleCount}
                        </ThemedText>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {busy ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.brand} />
            <ThemedText type="small" themeColor="textSecondary">
              {t("agent.assets.loading")}
            </ThemedText>
          </View>
        ) : null}

        {!busy && displayError ? (
          <StageBlock
            title={t("agent.assets.loadError")}
            description={displayError}
            actionLabel={t("common.retry")}
            onAction={() => void loadAssets()}
          />
        ) : null}

        {!busy && !displayError && chapterId && staleContent ? (
          <StageBlock
            title={replaceCount(
              t("agent.assets.stage.stale.title"),
              production?.assets.staleCount ?? 0
            )}
            description={t("agent.assets.stage.stale.description")}
            actionLabel={t("agent.assets.continueWithAgent")}
            onAction={() => continueWithAgent("agent.assets.prompts.assets")}
          />
        ) : null}

        {!busy && !displayError && guidance === "plotRequired" ? (
          <StageBlock
            title={t("agent.assets.stage.plotRequired.title")}
            description={t("agent.assets.stage.plotRequired.description")}
            actionLabel={t("agent.assets.continueWithAgent")}
            onAction={() => continueWithAgent("agent.assets.prompts.plot")}
          />
        ) : null}

        {!busy && !displayError && guidance === "assetsRequired" ? (
          <StageBlock
            title={t("agent.assets.stage.assetsRequired.title")}
            description={t("agent.assets.stage.assetsRequired.description")}
            actionLabel={t("agent.assets.continueWithAgent")}
            onAction={() => continueWithAgent("agent.assets.prompts.assets")}
          />
        ) : null}

        {!busy && !displayError && guidance === "noAssets" ? (
          <StageBlock
            title={t("agent.assets.stage.noAssets.title")}
            description={t("agent.assets.stage.noAssets.description")}
            actionLabel={
              production?.storyboard.status !== "current"
                ? t("agent.assets.continueWithAgent")
                : undefined
            }
            onAction={
              production?.storyboard.status !== "current"
                ? () => continueWithAgent("agent.assets.prompts.storyboard")
                : undefined
            }
          />
        ) : null}

        {showGallery && filtered.length === 0 ? (
          <StageBlock
            title={t(`agent.assets.empty.${activeTab}`)}
            description={t("agent.assets.emptyHint")}
          />
        ) : null}

        {showGallery && filtered.length > 0 ? (
          <View style={styles.list}>
            {filtered.map((asset) => (
              <StoryAssetSpecCard key={asset.id} asset={asset} onPressDetails={setDetailAsset} />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <StoryAssetSpecDetailSheet
        asset={detailAsset}
        visible={detailAsset != null}
        onClose={() => setDetailAsset(null)}
      />
    </ThemedView>
  );
}

function StageBlock({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.centered}>
      <ThemedText type="smallBold" style={styles.stageTitle}>
        {title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.stageDescription}>
        {description}
      </ThemedText>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [
            styles.stageAction,
            { backgroundColor: theme.backgroundSelected },
            pressed && styles.pressed,
          ]}
        >
          <ThemedText type="smallBold">{actionLabel}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    gap: Spacing.three,
  },
  header: {
    gap: 4,
  },
  pageTitle: {
    color: "rgba(255,255,255,0.94)",
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 24,
  },
  pageHint: {
    color: "rgba(255,255,255,0.64)",
    fontSize: 12,
    lineHeight: 20,
  },
  pageMeta: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  tabs: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.035)",
    borderRadius: 16,
    flexDirection: "row",
    gap: 4,
    padding: 6,
  },
  tab: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 14,
  },
  tabSelected: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  tabLabel: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "600",
  },
  tabLabelSelected: {
    color: "#FFFFFF",
  },
  staleCount: {
    borderRadius: 6,
    backgroundColor: "rgba(251, 191, 36, 0.12)",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  staleCountLabel: {
    color: "rgba(253, 230, 138, 0.88)",
    fontSize: 10,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.8,
  },
  centered: {
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  stageTitle: {
    textAlign: "center",
    fontSize: 16,
  },
  stageDescription: {
    textAlign: "center",
    maxWidth: 360,
  },
  stageAction: {
    marginTop: Spacing.two,
    minHeight: 40,
    paddingHorizontal: Spacing.four,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    gap: Spacing.four,
  },
});
