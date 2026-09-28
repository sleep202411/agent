import IconGitBranch from "@tabler/icons-react-native/IconGitBranch";
import IconX from "@tabler/icons-react-native/IconX";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Circle, Path, Svg } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

import {
  PLOT_PREVIEW_CHOICE_ROW_HEIGHT,
  plotPreviewEdgePath,
  plotPreviewHandle,
  type StoryPlotPreviewModel,
  type StoryPlotPreviewNode,
} from "../lib/story-plot-preview-model";

const CANVAS = Colors.dark.background;
const BRANCH_STROKE = "rgba(77,141,255,0.72)";
const AUTO_STROKE = "rgba(255,255,255,0.28)";

/**
 * H5 `story-plot-review-dialog` — read-only topology. Approval stays in chat.
 */
export function StoryPlotReviewSheet({
  visible,
  title,
  model,
  onClose,
}: {
  visible: boolean;
  title: string;
  model: StoryPlotPreviewModel;
  onClose: () => void;
}) {
  const t = useTranslations();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "ios" ? Spacing.five : Math.max(insets.top, Spacing.four);
  const bottomPad = Math.max(insets.bottom, Spacing.five);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={onClose}
    >
      <View style={[styles.screen, { paddingBottom: bottomPad }]}>
        <View style={[styles.header, { paddingTop: topPad }]}>
          <View style={styles.headerCopy}>
            <View style={styles.eyebrowRow}>
              <IconGitBranch size={14} color="rgba(255,255,255,0.62)" strokeWidth={1.8} />
              <Text style={styles.eyebrow}>{t("agent.proposal.card.eyebrow.plot")}</Text>
            </View>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            <Text style={styles.description}>{t("agent.proposal.card.plotDialogDescription")}</Text>
            <View style={styles.metrics}>
              <Metric value={model.metrics.nodes} label={t("agent.proposal.metrics.nodes")} />
              <View style={styles.metricRule} />
              <Metric value={model.metrics.branches} label={t("agent.proposal.metrics.branches")} />
              <View style={styles.metricRule} />
              <Metric value={model.metrics.endings} label={t("agent.proposal.metrics.endings")} />
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("agent.close")}
            hitSlop={8}
            onPress={onClose}
          >
            <View style={styles.closeChrome}>
              <IconX size={18} color="rgba(255,255,255,0.72)" strokeWidth={1.8} />
            </View>
          </Pressable>
        </View>

        {visible ? <PlotPreviewCanvas model={model} /> : null}
      </View>
    </Modal>
  );
}

function plotPreviewMarks(model: StoryPlotPreviewModel) {
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
  const edges = model.edges.flatMap((edge) => {
    const source = nodesById.get(edge.sourceId);
    const target = nodesById.get(edge.targetId);
    if (!source || !target) return [];
    const from =
      edge.kind === "choice"
        ? plotPreviewHandle(source, "choice", edge.choiceId)
        : plotPreviewHandle(source, "completion");
    return [
      {
        id: edge.id,
        d: plotPreviewEdgePath(from, plotPreviewHandle(target, "in")),
        isBranch: edge.kind === "choice",
      },
    ];
  });
  const handles: { key: string; x: number; y: number; fill: string }[] = [];
  for (const node of model.nodes) {
    const inbound = plotPreviewHandle(node, "in");
    handles.push({
      key: `${node.id}-in`,
      x: inbound.x,
      y: inbound.y,
      fill: "rgba(255,255,255,0.72)",
    });
    if (node.kind === "decision") {
      for (const choice of node.choices) {
        const handle = plotPreviewHandle(node, "choice", choice.choiceId);
        handles.push({
          key: `${node.id}-${choice.choiceId}`,
          x: handle.x,
          y: handle.y,
          fill: "rgb(77,141,255)",
        });
      }
      continue;
    }
    if (!node.continuationTargetId) continue;
    const handle = plotPreviewHandle(node, "completion");
    handles.push({
      key: `${node.id}-out`,
      x: handle.x,
      y: handle.y,
      fill: "rgba(255,255,255,0.72)",
    });
  }
  return { edges, handles };
}

function PlotPreviewCanvas({ model }: { model: StoryPlotPreviewModel }) {
  const t = useTranslations();
  const marks = plotPreviewMarks(model);

  return (
    <ScrollView
      accessibilityLabel={t("agent.proposal.card.plotCanvasRegion")}
      horizontal
      nestedScrollEnabled
      directionalLockEnabled={false}
      bounces
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      maximumZoomScale={Platform.OS === "ios" ? 1.6 : 1}
      minimumZoomScale={Platform.OS === "ios" ? 0.4 : 1}
      style={styles.canvasScroll}
      contentContainerStyle={{ width: model.canvasWidth }}
    >
      <ScrollView
        nestedScrollEnabled
        directionalLockEnabled={false}
        bounces
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          width: model.canvasWidth,
          height: model.canvasHeight,
        }}
      >
        <View
          accessibilityLabel={t("agent.proposal.card.plotCanvasRegion")}
          style={{ width: model.canvasWidth, height: model.canvasHeight }}
        >
          <Svg
            pointerEvents="none"
            width={model.canvasWidth}
            height={model.canvasHeight}
            style={StyleSheet.absoluteFill}
          >
            {marks.edges.map((edge) => (
              <Path
                key={edge.id}
                d={edge.d}
                fill="none"
                stroke={edge.isBranch ? BRANCH_STROKE : AUTO_STROKE}
                strokeWidth={edge.isBranch ? 1.8 : 1.5}
              />
            ))}
            {marks.handles.map((handle) => (
              <Circle key={handle.key} cx={handle.x} cy={handle.y} r={4} fill={handle.fill} />
            ))}
          </Svg>
          {model.nodes.map((node) => (
            <PlotPreviewNodeCard key={node.id} node={node} />
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

function PlotPreviewNodeCard({ node }: { node: StoryPlotPreviewNode }) {
  const t = useTranslations();

  return (
    <View
      accessibilityLabel={node.title}
      style={[
        styles.nodeWrap,
        {
          left: node.x,
          top: node.y,
          width: node.width,
        },
      ]}
    >
      <View style={[styles.node, { minHeight: node.height }]}>
        <View style={styles.nodeBody}>
          <View style={styles.nodeEyebrowRow}>
            <Text style={styles.nodeEyebrow} numberOfLines={1}>
              {node.eyebrow}
            </Text>
            {node.isEntry ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{t("agent.proposal.card.plotEntry")}</Text>
              </View>
            ) : null}
            {node.isEnding ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{t("agent.proposal.card.plotEnding")}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.nodeTitle} numberOfLines={1}>
            {node.title}
          </Text>
          {node.summary ? (
            <Text style={styles.nodeSummary} numberOfLines={2}>
              {node.summary}
            </Text>
          ) : null}
        </View>
        {node.kind === "decision" ? (
          <View style={styles.nodeFooter}>
            {node.choices.map((choice, index) => (
              <View key={choice.choiceId} style={styles.choiceRow}>
                <Text style={styles.choiceIndex}>{String(index + 1).padStart(2, "0")}</Text>
                <Text style={styles.choiceLabel} numberOfLines={1}>
                  {choice.label}
                </Text>
                <Text style={styles.choiceTarget} numberOfLines={1}>
                  {`→ ${choice.targetTitle}`}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {node.kind !== "decision" && node.continuationTargetId ? (
          <View style={styles.continueRow}>
            <Text style={styles.continueText}>{t("agent.proposal.card.plotContinues")}</Text>
          </View>
        ) : null}
      </View>
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
  screen: {
    backgroundColor: CANVAS,
    flex: 1,
  },
  header: {
    alignItems: "flex-start",
    borderBottomColor: "rgba(255,255,255,0.07)",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: Spacing.three,
    paddingHorizontal: 20,
    paddingBottom: Spacing.four,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrowRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  eyebrow: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "600",
    letterSpacing: -0.4,
    lineHeight: 26,
  },
  description: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 12,
    lineHeight: 20,
    marginTop: 6,
  },
  closeChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  metrics: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    flexDirection: "row",
    marginTop: 12,
    overflow: "hidden",
    paddingVertical: 8,
  },
  metric: {
    alignItems: "center",
    minWidth: 64,
    paddingHorizontal: 12,
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
  canvasScroll: {
    flex: 1,
    backgroundColor: CANVAS,
  },
  nodeWrap: {
    elevation: 8,
    position: "absolute",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.42,
    shadowRadius: 24,
  },
  node: {
    backgroundColor: "rgba(28,28,28,0.96)",
    borderRadius: 16,
    overflow: "hidden",
  },
  nodeBody: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  nodeEyebrowRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  nodeEyebrow: {
    color: "rgba(255,255,255,0.46)",
    flex: 1,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  badge: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 9,
    fontWeight: "600",
  },
  nodeTitle: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 6,
  },
  nodeSummary: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 11,
    lineHeight: 18,
    marginTop: 6,
  },
  nodeFooter: {
    borderTopColor: "rgba(255,255,255,0.07)",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
  },
  choiceRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: PLOT_PREVIEW_CHOICE_ROW_HEIGHT,
    paddingHorizontal: 16,
  },
  choiceIndex: {
    color: "rgba(255,255,255,0.26)",
    fontSize: 10,
    fontVariant: ["tabular-nums"],
    width: 16,
  },
  choiceLabel: {
    color: "rgba(255,255,255,0.72)",
    flex: 1,
    fontSize: 10,
    fontWeight: "500",
    minWidth: 0,
  },
  choiceTarget: {
    color: "rgba(255,255,255,0.34)",
    fontSize: 10,
    maxWidth: 96,
  },
  continueRow: {
    alignItems: "center",
    borderTopColor: "rgba(255,255,255,0.07)",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: PLOT_PREVIEW_CHOICE_ROW_HEIGHT,
    paddingHorizontal: 16,
  },
  continueText: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 10,
  },
});
