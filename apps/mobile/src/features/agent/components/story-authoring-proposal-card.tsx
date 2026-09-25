import IconCheck from "@tabler/icons-react-native/IconCheck";
import IconChevronRight from "@tabler/icons-react-native/IconChevronRight";
import IconClock from "@tabler/icons-react-native/IconClock";
import IconFileDescription from "@tabler/icons-react-native/IconFileDescription";
import IconGitBranch from "@tabler/icons-react-native/IconGitBranch";
import IconLayoutGrid from "@tabler/icons-react-native/IconLayoutGrid";
import IconLoader2 from "@tabler/icons-react-native/IconLoader2";
import IconMovie from "@tabler/icons-react-native/IconMovie";
import IconRotateClockwise from "@tabler/icons-react-native/IconRotateClockwise";
import IconRoute from "@tabler/icons-react-native/IconRoute";
import IconX from "@tabler/icons-react-native/IconX";
import { useMemo, useState, type ComponentType } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Spacing } from "@/constants/theme";
import { useLocale, useTranslations, type MessageKey } from "@/i18n";

import { fillMessageTemplate } from "../api/story-production-api";
import { useThreadScrollHydrateLock } from "../hooks/use-agent-thread-scroll";
import { useStoryAgentRunById } from "../hooks/use-story-authoring-run";
import {
  storyProposalAssetKindCounts,
  storyProposalStageFromSchema,
  storyProposalStoryboardMetrics,
  storyProposalStoryboardSequences,
  type StoryProposalStage,
} from "../lib/story-authoring-activity";
import { buildStoryPlotPreviewModel } from "../lib/story-plot-preview-model";
import { storyScreenplayDocumentBlocks } from "../lib/story-screenplay-document";
import type { StoryProposalArtifactStatus } from "../types";
import { StoryPlotReviewSheet } from "./story-plot-review-sheet";
import { StoryScreenplayReviewSheet } from "./story-screenplay-review-sheet";
import { StoryStoryboardReviewSheet } from "./story-storyboard-review-sheet";

const EYEBROW_KEYS = {
  script: "agent.proposal.card.eyebrow.script",
  plot: "agent.proposal.card.eyebrow.plot",
  assets: "agent.proposal.card.eyebrow.assets",
  storyboard: "agent.proposal.card.eyebrow.storyboard",
  patch: "agent.proposal.card.eyebrow.patch",
} as const satisfies Record<StoryProposalStage, MessageKey>;

const STATUS_KEYS = {
  proposed: "agent.proposal.card.status.proposed",
  active: "agent.proposal.card.status.active",
  applying: "agent.proposal.card.status.applying",
  applied: "agent.proposal.card.status.applied",
  rejected: "agent.proposal.card.status.rejected",
  failed: "agent.proposal.card.status.failed",
  cancelled: "agent.proposal.card.status.cancelled",
} as const satisfies Record<StoryProposalArtifactStatus, MessageKey>;

const STATUS_ICONS = {
  proposed: IconClock,
  active: IconClock,
  applying: IconLoader2,
  applied: IconCheck,
  rejected: IconRotateClockwise,
  failed: IconX,
  cancelled: IconX,
} as const satisfies Record<
  StoryProposalArtifactStatus,
  ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
>;

const STAGE_ICONS = {
  script: IconFileDescription,
  plot: IconGitBranch,
  assets: IconLayoutGrid,
  storyboard: IconMovie,
  patch: IconFileDescription,
} as const satisfies Record<
  StoryProposalStage,
  ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
>;

const EMBEDDED_STORYBOARD_SEQUENCE_LIMIT = 4;

function formatStoryboardSeconds(durationMs: number): string {
  return Number((Math.max(0, durationMs) / 1000).toFixed(1)).toString();
}

/** H5 `StoryScreenplayProposalCard` — hairline section, not a boxed chat card. */
export function StoryAuthoringProposalCard({
  projectId,
  storyAgentRunId,
  status,
}: {
  projectId: string;
  storyAgentRunId: string;
  status: StoryProposalArtifactStatus;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const run = useStoryAgentRunById(projectId, storyAgentRunId);
  useThreadScrollHydrateLock(!run);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [plotOpen, setPlotOpen] = useState(false);
  const [storyboardOpen, setStoryboardOpen] = useState(false);
  const stage = storyProposalStageFromSchema(run?.proposal.schemaVersion ?? "");
  const title =
    stage === "plot"
      ? run?.proposal.title?.trim() || run?.proposal.screenplay?.title?.trim() || ""
      : run?.proposal.screenplay?.title?.trim() || run?.proposal.title?.trim() || "";
  const summary = run?.proposal.summary?.trim() || "";
  const scenes = Array.isArray(run?.proposal.screenplay?.scenes)
    ? run.proposal.screenplay.scenes
    : [];
  const characters = Array.isArray(run?.proposal.screenplay?.characters)
    ? run.proposal.screenplay.characters
    : [];
  const showScriptMetrics = stage === "script" && (scenes.length > 0 || characters.length > 0);
  const choices = countScreenplayChoices(scenes);
  const plotModel = useMemo(
    () =>
      run && stage === "plot"
        ? buildStoryPlotPreviewModel(
            run.proposal,
            locale,
            t("agent.proposal.card.plotScene"),
            t("agent.proposal.card.plotDecision")
          )
        : null,
    [locale, run, stage, t]
  );
  const plotMetrics = plotModel?.metrics ?? null;
  const assetCounts =
    stage === "assets"
      ? storyProposalAssetKindCounts(run?.proposal ?? { schemaVersion: "" })
      : null;
  const storyboardSequences =
    stage === "storyboard" && run ? storyProposalStoryboardSequences(run.proposal) : [];
  const visibleStoryboardSequences = storyboardSequences.slice(
    0,
    EMBEDDED_STORYBOARD_SEQUENCE_LIMIT
  );
  const hiddenStoryboardCount = Math.max(
    0,
    storyboardSequences.length - visibleStoryboardSequences.length
  );
  const storyboardMetrics =
    stage === "storyboard"
      ? storyProposalStoryboardMetrics(run?.proposal ?? { schemaVersion: "" })
      : null;
  const reviewBlocks = useMemo(
    () => (run && stage === "script" ? storyScreenplayDocumentBlocks(run.proposal) : []),
    [run, stage]
  );
  const StatusIcon = STATUS_ICONS[status];
  const StageIcon = STAGE_ICONS[stage];
  const bodyCopy =
    stage === "assets" && assetCounts
      ? fillMessageTemplate(t("agent.proposal.assets.mobileDescription"), {
          count: assetCounts.total,
        })
      : summary;

  if (!run) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <StageIcon size={18} color="rgba(255,255,255,0.72)" strokeWidth={1.7} />
        </View>
        <View style={styles.headerCopy}>
          <View style={styles.eyebrowRow}>
            <Text style={styles.eyebrow}>{t(EYEBROW_KEYS[stage])}</Text>
            <View style={styles.status}>
              <StatusIcon size={14} color="rgba(255,255,255,0.58)" strokeWidth={1.8} />
              <Text style={styles.statusText}>{t(STATUS_KEYS[status])}</Text>
            </View>
          </View>
          {title ? <Text style={styles.title}>{title}</Text> : null}
        </View>
      </View>

      {assetCounts ? (
        <View style={styles.chips}>
          <Chip value={assetCounts.total} label={t("agent.proposal.metrics.assetSpecs")} />
          <Chip value={assetCounts.characters} label={t("agent.proposal.metrics.characters")} />
          <Chip value={assetCounts.locations} label={t("agent.proposal.metrics.locations")} />
          <Chip value={assetCounts.props} label={t("agent.proposal.metrics.props")} />
        </View>
      ) : null}

      {storyboardMetrics ? (
        <View style={styles.chips}>
          <Chip value={storyboardMetrics.sequences} label={t("agent.proposal.metrics.sequences")} />
          <Chip value={storyboardMetrics.clips} label={t("agent.proposal.metrics.clips")} />
          <Chip value={storyboardMetrics.seconds} label={t("agent.proposal.metrics.seconds")} />
          <Chip
            value={storyboardMetrics.assetSpecs}
            label={t("agent.proposal.metrics.assetSpecs")}
          />
        </View>
      ) : null}

      {bodyCopy ? (
        <Text
          style={styles.summary}
          numberOfLines={stage === "assets" ? 4 : stage === "plot" ? 2 : 3}
        >
          {bodyCopy}
        </Text>
      ) : null}

      {visibleStoryboardSequences.length > 0 ? (
        <View style={styles.tableSection}>
          <Text style={styles.tableHeading}>{t("agent.proposal.sections.storyboard")}</Text>
          <View style={styles.table}>
            <View style={styles.tableHead}>
              <Text style={[styles.tableHeadCell, styles.colIndex]}>#</Text>
              <Text style={[styles.tableHeadCell, styles.colSequence]}>
                {t("agent.proposal.storyboardTable.sequence")}
              </Text>
              <Text style={[styles.tableHeadCell, styles.colShots, styles.alignRight]}>
                {t("agent.proposal.storyboardTable.shots")}
              </Text>
              <Text style={[styles.tableHeadCell, styles.colDuration, styles.alignRight]}>
                {t("agent.proposal.storyboardTable.duration")}
              </Text>
            </View>
            {visibleStoryboardSequences.map((sequence, index) => (
              <View key={sequence.key} style={styles.tableRow}>
                <Text style={[styles.tableCellMuted, styles.colIndex]}>{index + 1}</Text>
                <Text style={[styles.tableCell, styles.colSequence]} numberOfLines={1}>
                  {sequence.title}
                </Text>
                <Text style={[styles.tableCellMuted, styles.colShots, styles.alignRight]}>
                  {sequence.clips.length}
                </Text>
                <Text style={[styles.tableCellMuted, styles.colDuration, styles.alignRight]}>
                  {fillMessageTemplate(t("agent.proposal.storyboardTable.seconds"), {
                    value: formatStoryboardSeconds(sequence.durationMs),
                  })}
                </Text>
              </View>
            ))}
          </View>
          <Pressable accessibilityRole="button" onPress={() => setStoryboardOpen(true)}>
            <View style={styles.viewAllChrome}>
              <Text style={styles.viewAllText}>{t("agent.proposal.storyboardTable.viewAll")}</Text>
              {hiddenStoryboardCount > 0 ? (
                <Text style={styles.moreText}>
                  {fillMessageTemplate(t("agent.proposal.storyboardTable.more"), {
                    count: hiddenStoryboardCount,
                  })}
                </Text>
              ) : null}
            </View>
          </Pressable>
          <StoryStoryboardReviewSheet
            visible={storyboardOpen}
            title={title}
            sequences={storyboardSequences}
            onClose={() => setStoryboardOpen(false)}
          />
        </View>
      ) : null}

      {showScriptMetrics ? (
        <View style={styles.metrics}>
          <Metric value={scenes.length} label={t("agent.proposal.metrics.scenes")} />
          <View style={styles.metricRule} />
          <Metric value={characters.length} label={t("agent.proposal.metrics.characters")} />
          <View style={styles.metricRule} />
          <Metric value={choices} label={t("agent.proposal.metrics.choices")} />
        </View>
      ) : null}

      {plotMetrics ? (
        <View style={styles.metrics}>
          <Metric value={plotMetrics.nodes} label={t("agent.proposal.metrics.nodes")} />
          <View style={styles.metricRule} />
          <Metric value={plotMetrics.branches} label={t("agent.proposal.metrics.branches")} />
          <View style={styles.metricRule} />
          <Metric value={plotMetrics.endings} label={t("agent.proposal.metrics.endings")} />
        </View>
      ) : null}

      {plotModel?.entryTitle ? (
        <View style={styles.entryRow}>
          <IconRoute size={14} color="rgba(255,255,255,0.58)" strokeWidth={1.7} />
          <Text style={styles.entryLabel}>{t("agent.proposal.card.plotEntry")}</Text>
          <Text style={styles.entryTitle} numberOfLines={1}>
            {plotModel.entryTitle}
          </Text>
        </View>
      ) : null}

      {stage === "plot" && plotModel ? (
        <>
          <Pressable accessibilityRole="button" onPress={() => setPlotOpen(true)}>
            <View style={styles.reviewChrome}>
              <Text style={styles.reviewText}>{t("agent.proposal.card.reviewPlot")}</Text>
              <IconChevronRight size={16} color="rgba(255,255,255,0.58)" strokeWidth={1.8} />
            </View>
          </Pressable>
          <StoryPlotReviewSheet
            visible={plotOpen}
            title={title}
            model={plotModel}
            onClose={() => setPlotOpen(false)}
          />
        </>
      ) : null}

      {stage === "script" ? (
        <>
          <Pressable accessibilityRole="button" onPress={() => setReviewOpen(true)}>
            <View style={styles.reviewChrome}>
              <Text style={styles.reviewText}>{t("agent.proposal.card.reviewScript")}</Text>
              <IconChevronRight size={16} color="rgba(255,255,255,0.58)" strokeWidth={1.8} />
            </View>
          </Pressable>
          <StoryScreenplayReviewSheet
            visible={reviewOpen}
            title={title}
            blocks={reviewBlocks}
            onClose={() => setReviewOpen(false)}
          />
        </>
      ) : null}
    </View>
  );
}

function countScreenplayChoices(scenes: unknown[]): number {
  return scenes.reduce<number>((total, scene) => {
    if (!scene || typeof scene !== "object") return total;
    const exit = (scene as Record<string, unknown>).exit;
    if (!exit || typeof exit !== "object") return total;
    const record = exit as Record<string, unknown>;
    if (record.kind !== "choice" || !Array.isArray(record.choices)) return total;
    return total + record.choices.length;
  }, 0);
}

function Chip({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderColor: "rgba(255,255,255,0.09)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: Spacing.three,
  },
  icon: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrowRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.three,
    justifyContent: "space-between",
  },
  eyebrow: {
    color: "rgba(255,255,255,0.58)",
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.9,
  },
  status: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  statusText: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: -0.16,
    lineHeight: 24,
    marginTop: 4,
  },
  summary: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    lineHeight: 24,
  },
  metrics: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    flexDirection: "row",
    overflow: "hidden",
    paddingVertical: 10,
  },
  metric: {
    alignItems: "center",
    flex: 1,
    paddingHorizontal: 10,
  },
  metricRule: {
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.07)",
    width: StyleSheet.hairlineWidth,
  },
  metricValue: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
  },
  metricLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    marginTop: 2,
  },
  reviewChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 14,
    flexDirection: "row",
    height: 40,
    justifyContent: "space-between",
    paddingHorizontal: 14,
    width: "100%",
  },
  reviewText: {
    color: "rgba(255,255,255,0.92)",
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "500",
  },
  entryRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minWidth: 0,
  },
  entryLabel: {
    color: "rgba(255,255,255,0.58)",
    flexShrink: 0,
    fontSize: 12,
  },
  entryTitle: {
    color: "rgba(255,255,255,0.78)",
    flex: 1,
    fontSize: 12,
    fontWeight: "500",
    minWidth: 0,
  },
  viewAllChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 14,
    flexDirection: "row",
    gap: 8,
    height: 40,
    justifyContent: "center",
    paddingHorizontal: 14,
    width: "100%",
  },
  viewAllText: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 12,
    fontWeight: "500",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 10,
    minWidth: 72,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  tableSection: {
    gap: Spacing.two,
  },
  tableHeading: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 12,
    fontWeight: "600",
  },
  table: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    overflow: "hidden",
  },
  tableHead: {
    backgroundColor: "rgba(255,255,255,0.035)",
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  tableRow: {
    borderTopColor: "rgba(255,255,255,0.06)",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  tableHeadCell: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 11,
    fontWeight: "500",
  },
  tableCell: {
    color: "rgba(255,255,255,0.84)",
    fontSize: 11,
    fontWeight: "500",
  },
  tableCellMuted: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  colIndex: {
    width: 22,
  },
  colSequence: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  colShots: {
    width: 40,
  },
  colDuration: {
    width: 56,
  },
  alignRight: {
    textAlign: "right",
  },
  moreText: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 12,
  },
});
