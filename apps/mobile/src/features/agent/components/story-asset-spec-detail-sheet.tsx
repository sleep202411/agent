import { StoryCandidatesPanel } from "./story-candidates-panel";
import { StoryAssetMediaVersions } from "./story-asset-media-versions";
import { StoryAssetEditFields } from "./story-asset-edit-fields";
import type { AssetCommand } from "../api/story-asset-mutations";
import { useMemo, useState, type ReactNode } from "react";
import { AssetGenerationPanel } from "./story-asset-generation-panel";
import type { TimelineScope } from "../api/story-timeline-api";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import type { StoryAssetSpec } from "@/features/agent/api/story-production-api";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

function statusLabelKey(status: StoryAssetSpec["status"]) {
  if (status === "archived") return "agent.assets.status.archived" as const;
  return "agent.assets.status.current" as const;
}

/** Existing asset detail sheet, with permission-gated editing actions. */
export function StoryAssetSpecDetailSheet({
  asset,
  visible,
  onClose,
  editing,
  recovery,
  generation,
}: {
  asset: StoryAssetSpec | null;
  visible: boolean;
  onClose: () => void;
  recovery?: ReactNode;
  generation?: {
    scope: TimelineScope;
    userId: string;
    canGenerate: boolean;
    locked: boolean;
    refresh: () => void;
  };
  editing?: { locked: boolean; submit: (command: AssetCommand) => void };
}) {
  const t = useTranslations();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [candidateId, setCandidateId] = useState<string>();
  const [purpose, setPurpose] = useState<"primary" | "turnaround">();
  const baseScope = generation?.scope,
    assetId = asset?.id;
  const scope = useMemo(
    () =>
      baseScope && assetId && purpose
        ? { ...baseScope, assetId, purpose, outputKind: "image" as const }
        : undefined,
    [baseScope, assetId, purpose]
  );
  if (!asset) return null;
  const latest = purpose
    ? (asset.latestGenerations?.[purpose] ??
      (asset.latestGeneration?.purpose === purpose ? asset.latestGeneration : null))
    : null;

  const reference = asset.stableKey.startsWith("@") ? asset.stableKey : `@${asset.stableKey}`;
  const prompt = asset.imagePrompt?.trim() || "—";
  const candidateOpen = !!(candidateId && generation && visible && editing);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityElementsHidden={candidateOpen}
        importantForAccessibility={candidateOpen ? "no-hide-descendants" : "auto"}
        aria-hidden={candidateOpen}
      >
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: theme.backgroundElement,
              paddingBottom: Math.max(insets.bottom, Spacing.four),
            },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.handle} />
          <ThemedText type="smallBold" style={styles.title}>
            {asset.name}
          </ThemedText>
          <ThemedText type="code" themeColor="textSecondary">
            {t(`agent.assets.tabs.${asset.kind}`)} · {reference}
          </ThemedText>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Field label={t("agent.assets.detail.status")}>
              <ThemedText type="small">{t(statusLabelKey(asset.status))}</ThemedText>
            </Field>
            {!editing && (
              <>
                <Field label={t("agent.assets.detail.description")}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {asset.description?.trim() || "—"}
                  </ThemedText>
                </Field>
                <Field label={t("agent.assets.detail.imagePrompt")}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {prompt}
                  </ThemedText>
                </Field>
              </>
            )}
            {recovery}
            {scope && generation ? (
              <AssetGenerationPanel
                scope={scope}
                userId={generation.userId}
                version={asset.version}
                kind="image"
                newGenerationDisabledReason={
                  purpose === "turnaround" && !asset.selectedMediaVersion
                    ? t("assetEdit.turnaroundNeedsPrimary")
                    : undefined
                }
                latestId={latest?.outputKind === "image" ? latest.id : undefined}
                canGenerate={generation.canGenerate && !generation.locked}
                onClose={() => {
                  setPurpose(undefined);
                  generation.refresh();
                }}
              />
            ) : (
              <>
                {!editing && <StoryAssetMediaVersions asset={asset} />}
                {!editing &&
                  generation &&
                  (["primary", ...(asset.kind === "character" ? ["turnaround"] : [])] as const).map(
                    (target) => (
                      <Pressable
                        key={target}
                        accessibilityRole="button"
                        onPress={() => setPurpose(target as "primary" | "turnaround")}
                      >
                        <ThemedText type="smallBold">
                          {t(
                            target === "primary"
                              ? "assetEdit.generateImage"
                              : "assetEdit.generateTurnaround"
                          )}
                        </ThemedText>
                      </Pressable>
                    )
                  )}
                {editing && (
                  <StoryAssetEditFields
                    key={`${asset.id}:${asset.version}`}
                    asset={asset}
                    onSaveCandidate={generation ? setCandidateId : undefined}
                    {...editing}
                    onGenerate={generation && !generation.locked ? setPurpose : undefined}
                  />
                )}
              </>
            )}
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeBtn,
              { backgroundColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="smallBold">{t("agent.assets.detail.close")}</ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
      {candidateId && generation && visible && editing && (
        <StoryCandidatesPanel
          scope={generation.scope}
          userId={generation.userId}
          mediaAssetId={candidateId}
          close={() => setCandidateId(undefined)}
        />
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText type="code" themeColor="textSecondary">
        {label}
      </ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    maxHeight: "78%",
    gap: Spacing.two,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: Spacing.two,
  },
  title: {
    fontSize: 17,
  },
  body: {
    marginTop: Spacing.two,
  },
  bodyContent: {
    gap: Spacing.four,
    paddingBottom: Spacing.three,
  },
  field: {
    gap: Spacing.one,
  },
  closeBtn: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    borderRadius: 12,
  },
  pressed: {
    opacity: 0.85,
  },
});
