import IconAlertCircle from "@tabler/icons-react-native/icons/IconAlertCircle";
import IconPencilPlus from "@tabler/icons-react-native/icons/IconPencilPlus";
import { useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import type { AgentOsRunStatus } from "@/features/agent/api/agent-os-api";
import { StoryCreditsButton } from "@/features/agent/components/story-project-header-actions";
import { useTranslations, type MessageKey } from "@/i18n";

type ChatRunStatus = AgentOsRunStatus | "idle" | "restoring" | "error";

const STATUS_KEYS: Record<ChatRunStatus, MessageKey> = {
  idle: "agent.runDetails.statusValue.idle",
  restoring: "agent.runDetails.statusValue.restoring",
  queued: "agent.runDetails.statusValue.queued",
  running: "agent.runDetails.statusValue.running",
  waiting_for_approval: "agent.runDetails.statusValue.waiting_for_approval",
  waiting_for_input: "agent.runDetails.statusValue.waiting_for_input",
  waiting_for_external: "agent.runDetails.statusValue.waiting_for_external",
  paused: "agent.runDetails.statusValue.paused",
  completed: "agent.runDetails.statusValue.completed",
  failed: "agent.runDetails.statusValue.failed",
  cancelled: "agent.runDetails.statusValue.cancelled",
  error: "agent.runDetails.statusValue.error",
};

type StoryChatHeaderActionsProps = {
  projectId: string;
  conversationId: string | null;
  status: ChatRunStatus;
  error?: string;
  busy?: boolean;
  onNewChat: () => void;
};

/** Chat-tab header: run details + new conversation + credits. */
export function StoryChatHeaderActions({
  projectId,
  conversationId,
  status,
  error,
  busy = false,
  onNewChat,
}: StoryChatHeaderActionsProps) {
  const t = useTranslations();
  const insets = useSafeAreaInsets();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasIssue = Boolean(error?.trim()) || status === "error" || status === "failed";

  const confirmNewChat = () => {
    if (busy) return;
    Alert.alert(t("agent.newConversation.title"), t("agent.newConversation.description"), [
      { text: t("agent.newConversation.cancel"), style: "cancel" },
      {
        text: t("agent.newConversation.confirm"),
        style: "destructive",
        onPress: onNewChat,
      },
    ]);
  };

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("agent.runDetails.open")}
        hitSlop={8}
        onPress={() => setDetailsOpen(true)}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
      >
        <View style={[styles.iconChrome, hasIssue && styles.iconChromeIssue]}>
          <IconAlertCircle
            color={hasIssue ? "rgba(254,202,202,0.92)" : "rgba(255,255,255,0.68)"}
            size={18}
            strokeWidth={1.8}
          />
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("agent.newChat")}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        hitSlop={8}
        onPress={confirmNewChat}
        style={({ pressed }) => [styles.iconButton, pressed && !busy && styles.pressed]}
      >
        <View style={[styles.iconChrome, busy && styles.disabled]}>
          <IconPencilPlus color="rgba(255,255,255,0.68)" size={18} strokeWidth={1.8} />
        </View>
      </Pressable>
      <StoryCreditsButton />

      <Modal
        visible={detailsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailsOpen(false)}
      >
        <View style={styles.backdrop}>
          <View
            style={[
              styles.dialog,
              {
                marginTop: Math.max(insets.top, Spacing.four),
                marginBottom: Math.max(insets.bottom, Spacing.four),
              },
            ]}
          >
            <ThemedText style={styles.dialogTitle}>{t("agent.runDetails.title")}</ThemedText>
            <ThemedText style={styles.dialogDescription}>
              {t("agent.runDetails.description")}
            </ThemedText>
            <View style={styles.details}>
              <View style={styles.detailRow}>
                <ThemedText style={styles.detailLabel}>{t("agent.runDetails.status")}</ThemedText>
                <ThemedText style={styles.detailValue}>{t(STATUS_KEYS[status])}</ThemedText>
              </View>
              <View style={styles.detailRow}>
                <ThemedText style={styles.detailLabel}>
                  {t("agent.runDetails.conversationId")}
                </ThemedText>
                <ThemedText selectable type="code" style={styles.detailMono}>
                  {conversationId ?? t("agent.runDetails.notAvailable")}
                </ThemedText>
              </View>
              {error?.trim() ? (
                <View style={styles.issueBlock}>
                  <ThemedText style={styles.detailLabel}>
                    {t("agent.runDetails.latestIssue")}
                  </ThemedText>
                  <ThemedText style={styles.issueText}>{error.trim()}</ThemedText>
                </View>
              ) : null}
            </View>
            <Pressable accessibilityRole="button" onPress={() => setDetailsOpen(false)}>
              <View style={styles.closeChrome}>
                <ThemedText style={styles.closeText}>{t("agent.runDetails.close")}</ThemedText>
              </View>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 8,
    marginRight: 8,
  },
  iconButton: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  iconChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 18,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  iconChromeIssue: {
    backgroundColor: "rgba(239,68,68,0.16)",
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.72,
  },
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  dialog: {
    alignSelf: "stretch",
    backgroundColor: "rgba(28,28,28,0.98)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
    maxWidth: 520,
    padding: 20,
    width: "100%",
  },
  dialogTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  dialogDescription: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    lineHeight: 18,
  },
  details: {
    backgroundColor: "rgba(255,255,255,0.035)",
    borderRadius: 14,
    gap: 10,
    padding: 12,
  },
  detailRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  detailLabel: {
    color: "rgba(255,255,255,0.42)",
    flexShrink: 0,
    fontSize: 12,
    lineHeight: 16,
  },
  detailValue: {
    color: "rgba(255,255,255,0.82)",
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
    textAlign: "right",
  },
  detailMono: {
    color: "rgba(255,255,255,0.68)",
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "right",
  },
  issueBlock: {
    borderTopColor: "rgba(255,255,255,0.07)",
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
    paddingTop: 10,
  },
  issueText: {
    color: "rgba(254, 202, 202, 0.88)",
    fontSize: 12,
    lineHeight: 18,
  },
  closeChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: "center",
  },
  closeText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 15,
    fontWeight: "500",
  },
});
