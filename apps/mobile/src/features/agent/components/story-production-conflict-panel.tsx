import IconAlertTriangle from "@tabler/icons-react-native/icons/IconAlertTriangle";
import IconArrowBackUp from "@tabler/icons-react-native/icons/IconArrowBackUp";
import IconRefresh from "@tabler/icons-react-native/icons/IconRefresh";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import {
  fillMessageTemplate,
  storyAssetSpecConflictIsResolvable,
  storyProductionApi,
  type StoryAssetSpec,
  type StoryAssetSpecConflictResolutionResult,
  type StoryProductionConflictResolution,
} from "@/features/agent/api/story-production-api";
import { useTranslations } from "@/i18n";

/** H5 `StoryProductionConflictPanel` — keep current vs use latest plan. */
export function StoryProductionConflictPanel({
  projectId,
  chapterId,
  asset,
  onResolved,
}: {
  projectId: string;
  chapterId: string;
  asset: StoryAssetSpec;
  onResolved: (result: StoryAssetSpecConflictResolutionResult) => void;
}) {
  const t = useTranslations();
  const [resolving, setResolving] = useState<StoryProductionConflictResolution | null>(null);

  if (asset.status !== "stale") return null;

  const conflict = asset.conflict;
  const metadataReady = storyAssetSpecConflictIsResolvable(asset);
  const pendingItem = conflict?.pendingItem ?? null;

  const confirm = (resolution: StoryProductionConflictResolution) => {
    if (!metadataReady || !conflict || resolving) return;
    Alert.alert(
      resolution === "keep_current"
        ? t("agent.productionConflict.confirmKeepTitle")
        : t("agent.productionConflict.confirmLatestTitle"),
      resolution === "keep_current"
        ? t("agent.productionConflict.confirmKeepDescription")
        : conflict.removed
          ? t("agent.productionConflict.confirmRemoveAssetDescription")
          : t("agent.productionConflict.confirmLatestDescription"),
      [
        { text: t("agent.productionConflict.cancel"), style: "cancel" },
        {
          text:
            resolution === "keep_current"
              ? t("agent.productionConflict.confirmKeep")
              : t("agent.productionConflict.confirmLatest"),
          onPress: () => {
            void run(resolution);
          },
        },
      ]
    );
  };

  const run = async (resolution: StoryProductionConflictResolution) => {
    if (!conflict) return;
    setResolving(resolution);
    try {
      const result = await storyProductionApi.resolveAssetSpecConflict(
        projectId,
        chapterId,
        asset.id,
        {
          expectedVersion: asset.version,
          expectedPendingSourceFingerprint: conflict.pendingSourceFingerprint,
          resolution,
        }
      );
      onResolved(result);
    } catch (error) {
      Alert.alert(
        t("agent.productionConflict.resolveError"),
        error instanceof Error && error.message.trim()
          ? error.message
          : t("agent.productionConflict.resolveError")
      );
    } finally {
      setResolving(null);
    }
  };

  return (
    <View style={styles.panel} accessibilityRole="alert">
      <View style={styles.row}>
        <IconAlertTriangle size={20} color="rgba(253, 230, 138, 0.9)" strokeWidth={1.7} />
        <View style={styles.copy}>
          <ThemedText style={styles.title}>{t("agent.productionConflict.title")}</ThemedText>
          <ThemedText style={styles.description}>
            {t("agent.productionConflict.description")}
          </ThemedText>

          {metadataReady && conflict?.removed ? (
            <View style={styles.summary}>
              <ThemedText style={styles.summaryTitle}>
                {t("agent.productionConflict.latestRemovesItem")}
              </ThemedText>
              <ThemedText style={styles.summaryBody}>
                {fillMessageTemplate(t("agent.productionConflict.assetRemovalSummary"), {
                  name: asset.name,
                })}
              </ThemedText>
            </View>
          ) : null}

          {metadataReady && pendingItem && !conflict?.removed ? (
            <View style={styles.summary}>
              <ThemedText style={styles.summaryTitle}>
                {fillMessageTemplate(t("agent.productionConflict.latestAsset"), {
                  name: pendingItem.name,
                  kind: t(`agent.assets.tabs.${pendingItem.kind}`),
                })}
              </ThemedText>
              <ThemedText style={styles.summaryBody} numberOfLines={2}>
                {pendingItem.description}
              </ThemedText>
              <ThemedText style={styles.summaryBody} numberOfLines={2}>
                {fillMessageTemplate(t("agent.productionConflict.latestPrompt"), {
                  prompt: pendingItem.imagePrompt,
                })}
              </ThemedText>
            </View>
          ) : null}

          {!metadataReady ? (
            <View style={styles.summary}>
              <ThemedText style={styles.summaryBody}>
                {t("agent.productionConflict.metadataUnavailable")}
              </ThemedText>
            </View>
          ) : null}

          {metadataReady ? (
            <View style={styles.actions}>
              <View style={styles.actionHit}>
                <Pressable
                  accessibilityRole="button"
                  disabled={resolving != null}
                  onPress={() => confirm("keep_current")}
                >
                  <View style={[styles.quietChrome, resolving != null && styles.disabled]}>
                    {resolving === "keep_current" ? (
                      <ActivityIndicator color="rgba(255,255,255,0.86)" size="small" />
                    ) : (
                      <>
                        <IconArrowBackUp
                          size={14}
                          color="rgba(255,255,255,0.86)"
                          strokeWidth={1.8}
                        />
                        <ThemedText style={styles.quietText}>
                          {t("agent.productionConflict.keepCurrent")}
                        </ThemedText>
                      </>
                    )}
                  </View>
                </Pressable>
              </View>
              <View style={styles.actionHit}>
                <Pressable
                  accessibilityRole="button"
                  disabled={resolving != null}
                  onPress={() => confirm("use_latest_plan")}
                >
                  <View style={[styles.brandChrome, resolving != null && styles.disabled]}>
                    {resolving === "use_latest_plan" ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <>
                        <IconRefresh size={14} color="#FFFFFF" strokeWidth={1.8} />
                        <ThemedText style={styles.brandText}>
                          {t("agent.productionConflict.useLatestPlan")}
                        </ThemedText>
                      </>
                    )}
                  </View>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: "rgba(251, 191, 36, 0.07)",
    borderColor: "rgba(253, 230, 138, 0.2)",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: Spacing.three,
    padding: 14,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  title: {
    color: "rgba(255, 251, 235, 0.95)",
    fontSize: 14,
    fontWeight: "600",
  },
  description: {
    color: "rgba(255, 251, 235, 0.82)",
    fontSize: 12,
    lineHeight: 18,
  },
  summary: {
    backgroundColor: "rgba(0,0,0,0.22)",
    borderRadius: 8,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  summaryTitle: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    fontWeight: "600",
  },
  summaryBody: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    lineHeight: 16,
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.two,
    marginTop: 4,
  },
  actionHit: {
    flex: 1,
    minWidth: 0,
  },
  quietChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    flexDirection: "row",
    gap: 6,
    height: 40,
    justifyContent: "center",
    width: "100%",
  },
  quietText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 12,
    fontWeight: "600",
  },
  brandChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: 12,
    flexDirection: "row",
    gap: 6,
    height: 40,
    justifyContent: "center",
    width: "100%",
  },
  brandText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.6,
  },
});
