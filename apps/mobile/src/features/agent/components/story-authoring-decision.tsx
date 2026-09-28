import { IconLoader2 } from "@tabler/icons-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Colors, Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

import type { StoryProposalStage } from "../lib/story-authoring-activity";
import { storyProposalDecisionQuestion } from "../lib/story-authoring-activity";

const theme = Colors.dark;
const BRAND_RED = theme.brand;

/** H5 `StoryAuthoringProposalApproval` — quiet reject + brand Continue. */
export function StoryAuthoringDecision({
  stage,
  assetCount = 0,
  busy,
  onResolve,
}: {
  stage: StoryProposalStage;
  assetCount?: number;
  busy: boolean;
  onResolve: (decision: "approve" | "reject", responseText: string) => void;
}) {
  const t = useTranslations();
  const continueText = t("agent.proposal.decision.continue");
  const stopText = t("agent.proposal.decision.stop");

  return (
    <View style={styles.card}>
      <Text style={styles.question}>{storyProposalDecisionQuestion(t, stage, assetCount)}</Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={stopText}
          disabled={busy}
          onPress={() => onResolve("reject", stopText)}
          style={styles.actionHit}
        >
          <View style={[styles.stopChrome, busy && styles.disabled]}>
            <Text style={styles.stopText}>{stopText}</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={continueText}
          disabled={busy}
          onPress={() => onResolve("approve", continueText)}
          style={styles.actionHit}
        >
          <View style={[styles.continueChrome, busy && styles.disabled]}>
            {busy ? <IconLoader2 size={14} color="#FFFFFF" strokeWidth={1.8} /> : null}
            <Text style={styles.continueText}>{continueText}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 16,
    borderWidth: 1,
    gap: Spacing.three,
    padding: Spacing.three,
    width: "100%",
  },
  question: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 20,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.two,
    width: "100%",
  },
  actionHit: {
    flex: 1,
    minWidth: 0,
  },
  stopChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    height: 40,
    justifyContent: "center",
    width: "100%",
  },
  stopText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 12,
    fontWeight: "500",
  },
  continueChrome: {
    alignItems: "center",
    backgroundColor: BRAND_RED,
    borderRadius: 14,
    flexDirection: "row",
    gap: 6,
    height: 40,
    justifyContent: "center",
    width: "100%",
  },
  continueText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "500",
  },
  disabled: {
    opacity: 0.5,
  },
});
