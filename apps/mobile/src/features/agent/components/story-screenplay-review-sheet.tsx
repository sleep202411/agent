import IconFileDescription from "@tabler/icons-react-native/icons/IconFileDescription";
import IconX from "@tabler/icons-react-native/icons/IconX";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

import { StoryScreenplayDocumentView } from "./story-screenplay-document-view";
import type { StoryScreenplayDocumentBlock } from "../lib/story-screenplay-document";

const CANVAS = Colors.dark.background;

/**
 * H5 / PC `story-screenplay-review-dialog` — read the proposal Script in place.
 * Approval stays in the conversation decision area; this sheet never navigates
 * to the Script tab (that tab is the saved Yjs document, not this draft).
 */
export function StoryScreenplayReviewSheet({
  visible,
  title,
  blocks,
  onClose,
}: {
  visible: boolean;
  title: string;
  blocks: readonly StoryScreenplayDocumentBlock[];
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
              <IconFileDescription size={14} color="rgba(255,255,255,0.62)" strokeWidth={1.8} />
              <Text style={styles.eyebrow}>{t("agent.proposal.card.eyebrow.script")}</Text>
            </View>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            <Text style={styles.description}>{t("agent.proposal.card.dialogDescription")}</Text>
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

        <ScrollView
          accessibilityLabel={t("agent.proposal.card.reviewRegion")}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <StoryScreenplayDocumentView blocks={blocks} />
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
  body: {
    flexGrow: 1,
  },
});
