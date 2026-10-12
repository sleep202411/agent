import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Colors, Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

import type { AgentOsPendingApproval } from "../api/agent-os-api";
import { fillMessageTemplate } from "../api/story-production-api";
import {
  safeApprovalJson,
  summarizeApprovalPayload,
  truncateApprovalNote,
  type ApprovalPayloadLabels,
} from "../lib/approval-payload";

const theme = Colors.dark;
const PREVIEW_LIMIT = 6;

type AgentApprovalCardProps = {
  approval: AgentOsPendingApproval;
  busy: boolean;
  onResolve: (decision: "approve" | "reject") => void;
};

/** HITL approval gate — mirrors PC `AgentOsApprovalComposer` in the composer slot. */
export function AgentApprovalCard({ approval, busy, onResolve }: AgentApprovalCardProps) {
  const t = useTranslations();
  const [showDetails, setShowDetails] = useState(false);

  const payloadLabels: ApprovalPayloadLabels = useMemo(
    () => ({
      creates: (count) => fillMessageTemplate(t("agent.approvalCreates"), { count }),
      updates: (count) => fillMessageTemplate(t("agent.approvalUpdates"), { count }),
      deletes: (count) => fillMessageTemplate(t("agent.approvalDeletes"), { count }),
      andMore: (count) => fillMessageTemplate(t("agent.approvalAndMore"), { count }),
      untitled: t("agent.approvalUntitled"),
      storyBible: t("agent.approvalStoryBible"),
      storyEntry: t("agent.approvalStoryEntry"),
      sceneOrder: t("agent.approvalSceneOrder"),
      storyScene: t("agent.approvalStoryScene"),
      generationBatch: t("agent.approvalGenerationBatch"),
      generationBatchSummary: (count, points) =>
        fillMessageTemplate(t("agent.approvalGenerationBatchSummary"), { count, points }),
    }),
    [t]
  );

  const summary = useMemo(
    () => summarizeApprovalPayload(approval.toolId, approval.arguments, payloadLabels),
    [approval.arguments, approval.toolId, payloadLabels]
  );

  const hasRows = summary.creates.length + summary.updates.length + summary.deletes.length > 0;
  const hasSummary = hasRows || Boolean(summary.decision);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <SymbolView
          name={{ ios: "shield.lefthalf.filled", android: "shield", web: "shield" }}
          size={16}
          tintColor="rgba(255,255,255,0.82)"
        />
        <Text style={styles.headerTitle}>{t("agent.approvalRequired")}</Text>
      </View>

      {summary.decision ? (
        <View style={styles.decision}>
          <Text style={styles.decisionTitle}>{summary.decision.title}</Text>
          {summary.decision.note ? (
            <Text style={styles.decisionNote}>{summary.decision.note}</Text>
          ) : null}
        </View>
      ) : null}

      {hasRows ? (
        <View style={styles.payload}>
          <RowList
            rows={summary.deletes}
            tone="danger"
            heading={payloadLabels.deletes(summary.deletes.length)}
            untitled={payloadLabels.untitled}
            andMoreLabel={
              summary.deletes.length > PREVIEW_LIMIT
                ? payloadLabels.andMore(summary.deletes.length - PREVIEW_LIMIT)
                : undefined
            }
          />
          <RowList
            rows={summary.updates}
            tone="neutral"
            heading={payloadLabels.updates(summary.updates.length)}
            untitled={payloadLabels.untitled}
            andMoreLabel={
              summary.updates.length > PREVIEW_LIMIT
                ? payloadLabels.andMore(summary.updates.length - PREVIEW_LIMIT)
                : undefined
            }
          />
          <RowList
            rows={summary.creates}
            tone="neutral"
            heading={payloadLabels.creates(summary.creates.length)}
            untitled={payloadLabels.untitled}
            andMoreLabel={
              summary.creates.length > PREVIEW_LIMIT
                ? payloadLabels.andMore(summary.creates.length - PREVIEW_LIMIT)
                : undefined
            }
          />
        </View>
      ) : null}

      {!hasRows && !summary.recognized && approval.arguments != null ? (
        <ScrollView style={styles.rawBox} nestedScrollEnabled>
          <Text style={styles.rawText}>{safeApprovalJson(approval.arguments)}</Text>
        </ScrollView>
      ) : null}

      {hasSummary ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowDetails((v) => !v)}
          style={styles.detailsLink}
        >
          <Text style={styles.detailsLinkText}>
            {showDetails ? t("agent.approvalHideDetails") : t("agent.approvalShowDetails")}
          </Text>
        </Pressable>
      ) : null}

      {showDetails && hasSummary ? (
        <ScrollView style={styles.rawBox} nestedScrollEnabled>
          <Text style={styles.rawText}>{safeApprovalJson(approval.arguments)}</Text>
        </ScrollView>
      ) : null}

      <View style={styles.actions}>
        <View style={styles.actionHit}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("agent.approve")}
            disabled={busy}
            onPress={() => onResolve("approve")}
          >
            <View style={[styles.approveChrome, busy && styles.disabled]}>
              {busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
              <Text style={styles.approveText}>{t("agent.approve")}</Text>
            </View>
          </Pressable>
        </View>
        <View style={styles.actionHit}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("agent.reject")}
            disabled={busy}
            onPress={() => onResolve("reject")}
          >
            <View style={[styles.rejectChrome, busy && styles.disabled]}>
              <Text style={styles.rejectText}>{t("agent.reject")}</Text>
            </View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function RowList({
  rows,
  tone,
  heading,
  untitled,
  andMoreLabel,
}: {
  rows: { key: string; title: string; note?: string }[];
  tone: "neutral" | "danger";
  heading: string;
  untitled: string;
  andMoreLabel?: string;
}) {
  if (!rows.length) return null;
  const shown = rows.slice(0, PREVIEW_LIMIT);
  const hidden = rows.length - shown.length;
  return (
    <View style={styles.rowGroup}>
      <Text style={tone === "danger" ? styles.rowHeadingDanger : styles.rowHeading}>{heading}</Text>
      {shown.map((row) => (
        <Text key={row.key} style={tone === "danger" ? styles.rowItemDanger : styles.rowItem}>
          {row.title || untitled}
          {row.note ? (
            <Text style={styles.rowNote}> — {truncateApprovalNote(row.note)}</Text>
          ) : null}
        </Text>
      ))}
      {hidden > 0 && andMoreLabel ? <Text style={styles.rowMore}>{andMoreLabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: Spacing.two,
    padding: Spacing.three,
    width: "100%",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  headerTitle: {
    color: theme.text,
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
  },
  decision: {
    backgroundColor: "rgba(255,255,255,0.055)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  decisionTitle: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    fontWeight: "500",
  },
  decisionNote: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  payload: {
    gap: Spacing.one,
  },
  rowGroup: {
    gap: 2,
  },
  rowHeading: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    fontWeight: "600",
  },
  rowHeadingDanger: {
    color: "#FECACA",
    fontSize: 11,
    fontWeight: "600",
  },
  rowItem: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    lineHeight: 16,
  },
  rowItemDanger: {
    color: "rgba(254,202,202,0.9)",
    fontSize: 11,
    lineHeight: 16,
  },
  rowNote: {
    color: "rgba(255,255,255,0.35)",
  },
  rowMore: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 11,
  },
  detailsLink: {
    paddingVertical: 2,
  },
  detailsLinkText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    textDecorationLine: "underline",
  },
  rawBox: {
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 8,
    maxHeight: 140,
    padding: Spacing.two,
  },
  rawText: {
    color: "rgba(255,255,255,0.55)",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 10,
    lineHeight: 14,
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.two,
    marginTop: Spacing.one,
    width: "100%",
  },
  actionHit: {
    flex: 1,
    minWidth: 0,
  },
  approveChrome: {
    alignItems: "center",
    backgroundColor: theme.brand,
    borderRadius: 12,
    flexDirection: "row",
    gap: 6,
    height: 36,
    justifyContent: "center",
    width: "100%",
  },
  approveText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  rejectChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    height: 36,
    justifyContent: "center",
    width: "100%",
  },
  rejectText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.6,
  },
});
