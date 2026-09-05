import IconMovie from "@tabler/icons-react-native/icons/IconMovie";
import IconX from "@tabler/icons-react-native/icons/IconX";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

import { fillMessageTemplate } from "../api/story-production-api";
import type { StoryProposalStoryboardSequenceRow } from "../lib/story-authoring-activity";

const CANVAS = Colors.dark.background;

function formatSeconds(durationMs: number): string {
  return Number((Math.max(0, durationMs) / 1000).toFixed(1)).toString();
}

/** H5 `StoryboardDetailsDialog` — full sequence list, approval stays in chat. */
export function StoryStoryboardReviewSheet({
  visible,
  title,
  sequences,
  onClose,
}: {
  visible: boolean;
  title: string;
  sequences: readonly StoryProposalStoryboardSequenceRow[];
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
              <IconMovie size={14} color="rgba(255,255,255,0.62)" strokeWidth={1.8} />
              <Text style={styles.eyebrow}>{t("agent.proposal.card.eyebrow.storyboard")}</Text>
            </View>
            <Text style={styles.title}>
              {fillMessageTemplate(t("agent.proposal.storyboardTable.dialogTitle"), {
                count: sequences.length,
              })}
            </Text>
            {title ? <Text style={styles.subtitle}>{title}</Text> : null}
            <Text style={styles.description}>
              {t("agent.proposal.storyboardTable.dialogDescription")}
            </Text>
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

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {sequences.map((sequence, index) => (
            <View key={sequence.key} style={styles.sequence}>
              <View style={styles.sequenceHead}>
                <Text style={styles.index}>{index + 1}</Text>
                <View style={styles.sequenceCopy}>
                  <Text style={styles.sequenceTitle}>{sequence.title}</Text>
                  <Text style={styles.sequenceMeta}>
                    {fillMessageTemplate(t("agent.proposal.storyboardTable.sequenceMeta"), {
                      count: sequence.clips.length,
                      seconds: formatSeconds(sequence.durationMs),
                    })}
                  </Text>
                </View>
              </View>
              {sequence.description ? (
                <Text style={styles.sequenceDescription}>{sequence.description}</Text>
              ) : null}
              {sequence.clips.map((clip, clipIndex) => (
                <View key={`${sequence.key}:${clipIndex}`} style={styles.clipRow}>
                  <Text style={styles.clipIndex}>{clipIndex + 1}</Text>
                  <Text style={styles.clipTitle} numberOfLines={2}>
                    {clip.title}
                  </Text>
                  <Text style={styles.clipKind}>
                    {clip.kind === "video"
                      ? t("agent.proposal.storyboardTable.kind.video")
                      : t("agent.proposal.storyboardTable.kind.image")}
                  </Text>
                  <Text style={styles.clipDuration}>
                    {fillMessageTemplate(t("agent.proposal.storyboardTable.seconds"), {
                      value: formatSeconds(clip.durationMs),
                    })}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
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
  subtitle: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    fontWeight: "500",
    marginTop: 4,
  },
  description: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 12,
    lineHeight: 20,
    marginTop: 6,
  },
  closeChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  body: {
    gap: Spacing.four,
    paddingHorizontal: 20,
    paddingVertical: Spacing.four,
  },
  sequence: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16,
    overflow: "hidden",
    paddingBottom: 8,
  },
  sequenceHead: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  index: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
    marginTop: 2,
    width: 16,
  },
  sequenceCopy: {
    flex: 1,
    minWidth: 0,
  },
  sequenceTitle: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontWeight: "600",
  },
  sequenceMeta: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 11,
    marginTop: 2,
  },
  sequenceDescription: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  clipRow: {
    alignItems: "center",
    borderTopColor: "rgba(255,255,255,0.06)",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  clipIndex: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    width: 16,
  },
  clipTitle: {
    color: "rgba(255,255,255,0.84)",
    flex: 1,
    fontSize: 12,
  },
  clipKind: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
  },
  clipDuration: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
});
