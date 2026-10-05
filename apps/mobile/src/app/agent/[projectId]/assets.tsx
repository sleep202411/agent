import { StoryCandidatesEntry } from "@/features/agent/components/story-candidates-panel";
import { StoryCanvasEntry } from "@/features/agent/components/story-canvas-entry";
import { StoryReferenceEntry } from "@/features/agent/components/story-reference-panel";
import { AssetCreateSheet } from "@/features/agent/components/story-asset-create-sheet";
import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { useIsFocused } from "expo-router";
import { useAssetMutations } from "@/features/agent/hooks/use-asset-mutations";
import { StoryTimelineEntry } from "@/features/agent/components/story-timeline-editor";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import {
  fillMessageTemplate,
  storyProductionApi,
  type StoryAssetSpec,
  type StoryAssetSpecKind,
} from "@/features/agent/api/story-production-api";
import { StoryAssetSpecCard } from "@/features/agent/components/story-asset-spec-card";
import { StoryAssetSpecDetailSheet } from "@/features/agent/components/story-asset-spec-detail-sheet";
import { useStoryChapterContext } from "@/features/agent/context/story-chapter-context";
import { STORY_HEADER_CONTENT_GAP } from "@/features/agent/lib/story-tab-bar";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

const TABS: StoryAssetSpecKind[] = ["character", "location", "prop"];

function replaceCount(template: string, count: number): string {
  return fillMessageTemplate(template, { count });
}

/**
 * Native assets gallery with versioned detail editing.
 * Plot/plan state does not lock this surface.
 */
export default function AgentAssetsScreen() {
  const auth = useAuth();
  if (auth.status !== "authenticated") return <ThemedView style={{ flex: 1 }} />;
  return (
    <AssetsScreen
      key={auth.generation}
      generation={auth.generation}
      userId={String(auth.user?.userId ?? auth.user?.id ?? "")}
    />
  );
}
function AssetsScreen({ generation, userId }: { generation: number; userId: string }) {
  const t = useTranslations();
  const theme = useTheme();
  const {
    projectId,
    chapterId,
    capabilities,
    loading: chapterLoading,
    error: chapterError,
    refresh: refreshChapter,
  } = useStoryChapterContext();
  const [createKind, setCreateKind] = useState<StoryAssetSpecKind>();
  const [activeTab, setActiveTab] = useState<StoryAssetSpecKind>("character");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const active = useIsFocused();
  const scope = useMemo(
    () => ({ projectId, chapterId, generation }),
    [projectId, chapterId, generation]
  );
  const [error, setError] = useState<string | undefined>();
  const [assets, setAssets] = useState<StoryAssetSpec[]>([]);
  const [detailAsset, setDetailAsset] = useState<StoryAssetSpec | null>(null);

  const resourceKey = `${projectId}:${chapterId}`;
  const [previousResourceKey, setPreviousResourceKey] = useState(resourceKey);
  if (previousResourceKey !== resourceKey) {
    setPreviousResourceKey(resourceKey);
    setLoading(true);
    setError(undefined);
    setDetailAsset(null);
    setCreateKind(undefined);
  }

  const refresh = () => {
    setLoading(true);
    if (chapterError) refreshChapter();
    setRevision((n) => n + 1);
  };
  const mutation = useAssetMutations(
    scope,
    userId,
    active && !chapterLoading && !chapterError && !!chapterId,
    capabilities.includes("story.edit"),
    () => {
      setDetailAsset(null);
      setCreateKind(undefined);
      refresh();
    }
  );
  useEffect(() => {
    if (!chapterId || chapterLoading || !active || chapterError) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && getAuthGeneration() === generation;
    void storyProductionApi
      .listAssetSpecs(projectId, chapterId, controller.signal)
      .then((result) => {
        if (!current()) return;
        if (result.some((asset) => asset.projectId !== projectId || asset.chapterId !== chapterId))
          throw Error("Asset chapter mismatch.");
        setAssets(result.filter((asset) => asset.status !== "archived"));
        setError(undefined);
      })
      .catch((e) => {
        if (current()) {
          setAssets([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, chapterId, chapterLoading, chapterError, generation, active, revision]);

  const filtered = useMemo(
    () => assets.filter((asset) => asset.kind === activeTab),
    [activeTab, assets]
  );
  const topPad = STORY_HEADER_CONTENT_GAP;
  const busy = chapterLoading || (!chapterError && loading);
  const displayError = chapterError ?? error;
  const showGallery = !busy && !displayError;

  const recovery = (
    <>
      {mutation.error && <ThemedText accessibilityRole="alert">{mutation.error}</ThemedText>}
      {mutation.pending && (
        <View style={{ padding: 16, gap: 8 }}>
          <ThemedText>{t("assetEdit.pending")}</ThemedText>
          <Pressable
            accessibilityRole="button"
            disabled={mutation.busy || !capabilities.includes("story.edit")}
            onPress={() => mutation.submit(mutation.pending!)}
          >
            <ThemedText>{t("timeline.retry")}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={mutation.busy}
            onPress={() =>
              Alert.alert(t("timeline.clear"), t("timeline.clearHelp"), [
                { text: t("common.cancel"), style: "cancel" },
                { text: t("timeline.clear"), style: "destructive", onPress: mutation.clear },
              ])
            }
          >
            <ThemedText>{t("timeline.clear")}</ThemedText>
          </Pressable>
        </View>
      )}
    </>
  );

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        refreshControl={
          chapterId ? (
            <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={theme.brand} />
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
        <StoryTimelineEntry />
        <StoryReferenceEntry />
        <StoryCandidatesEntry />
        <StoryCanvasEntry />
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
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {showGallery && capabilities.includes("story.edit") && (
          <Pressable
            accessibilityRole="button"
            disabled={mutation.locked}
            onPress={() => setCreateKind(activeTab)}
            style={{ paddingVertical: 12, opacity: mutation.locked ? 0.5 : 1 }}
          >
            <ThemedText type="smallBold" style={{ color: theme.brand }}>
              {t("assetEdit.create")}
            </ThemedText>
          </Pressable>
        )}
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
            onAction={refresh}
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

      {!detailAsset && !createKind && recovery}
      {createKind && active && !chapterLoading && !chapterError && (
        <AssetCreateSheet
          key={`${resourceKey}:${createKind}`}
          kind={createKind}
          locked={mutation.locked}
          submit={mutation.submit}
          recovery={recovery}
          onClose={() => setCreateKind(undefined)}
        />
      )}
      <StoryAssetSpecDetailSheet
        key={`${resourceKey}:${detailAsset?.id}:${detailAsset?.version}`}
        generation={{
          scope,
          userId,
          canGenerate: capabilities.includes("story.generate"),
          locked: mutation.recoveryLocked,
          refresh: () => {
            setDetailAsset(null);
            refresh();
          },
        }}
        recovery={recovery}
        asset={active && !chapterLoading && !chapterError ? detailAsset : null}
        editing={
          capabilities.includes("story.edit")
            ? { locked: mutation.locked, submit: mutation.submit }
            : undefined
        }
        visible={detailAsset != null}
        onClose={() => {
          setDetailAsset(null);
          refresh();
        }}
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
          style={({ pressed }) => pressed && styles.pressed}
        >
          <View style={[styles.stageAction, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold">{actionLabel}</ThemedText>
          </View>
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
    gap: Spacing.three,
  },
});
