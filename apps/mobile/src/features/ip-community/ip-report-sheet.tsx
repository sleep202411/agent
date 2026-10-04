import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/themed-text";
import { REASON_LABELS } from "@/components/report-actions";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { IP_REPORT_REASONS } from "@/data/ip-api";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import type { ReportDraft } from "./use-ip-moderation";

/** Keep the form mounted during backgrounding so an interrupted report retains its draft. */
export function IpReportSheet({
  visible,
  submitting,
  accepted,
  draft,
  onChange,
  onSubmit,
  onClose,
  allowBlock = true,
}: {
  visible: boolean;
  submitting: boolean;
  accepted: boolean;
  draft: ReportDraft;
  onChange: (value: Partial<ReportDraft>) => void;
  onSubmit: () => void;
  onClose: () => void;
  allowBlock?: boolean;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const locked = submitting || accepted;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable
          accessible={false}
          style={StyleSheet.absoluteFill}
          onPress={submitting ? undefined : onClose}
        />
        <View
          onAccessibilityEscape={onClose}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.backgroundElement,
              paddingBottom: Math.max(insets.bottom, Spacing.three),
            },
          ]}
        >
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <ThemedText type="smallBold">{t("report.reportAction")}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t(draft.targetType === "episode" ? "report.targetEpisode" : "report.targetIp")}:{" "}
              {draft.title}
            </ThemedText>
            {accepted && !submitting && (
              <ThemedText type="small" accessibilityLiveRegion="polite">
                {t("report.acceptedBlockPending")}
              </ThemedText>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("report.reason")}
              accessibilityState={{ expanded: reasonsOpen, disabled: locked }}
              disabled={locked}
              onPress={() => setReasonsOpen(!reasonsOpen)}
              style={[styles.control, { borderColor: theme.border }]}
            >
              <ThemedText type="small" style={styles.grow}>
                {t(REASON_LABELS[draft.reason])}
              </ThemedText>
              <ThemedText themeColor="textSecondary">{reasonsOpen ? "−" : "+"}</ThemedText>
            </Pressable>
            {reasonsOpen &&
              IP_REPORT_REASONS.map((reason) => (
                <Pressable
                  key={reason}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: draft.reason === reason, disabled: locked }}
                  disabled={locked}
                  onPress={() => {
                    onChange({ reason });
                    setReasonsOpen(false);
                  }}
                  style={styles.reason}
                >
                  <ThemedText type="small" style={styles.grow}>
                    {t(REASON_LABELS[reason])}
                  </ThemedText>
                  {draft.reason === reason && <ThemedText themeColor="brand">✓</ThemedText>}
                </Pressable>
              ))}
            <ThemedText type="smallBold">{t("report.description")}</ThemedText>
            <TextInput
              accessibilityLabel={t("report.description")}
              placeholder={t("report.descriptionPlaceholder")}
              placeholderTextColor={theme.textSecondary}
              multiline
              maxLength={2000}
              editable={!locked}
              value={draft.description ?? ""}
              onChangeText={(description) => onChange({ description })}
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.border, backgroundColor: theme.background },
              ]}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.count}>
              {draft.description?.length ?? 0}/2000
            </ThemedText>
            {allowBlock && (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: draft.blockIp, disabled: locked }}
                disabled={locked}
                onPress={() => onChange({ blockIp: !draft.blockIp })}
                style={[styles.control, { borderColor: theme.border }]}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: theme.textSecondary,
                      backgroundColor: draft.blockIp ? theme.brand : theme.background,
                    },
                  ]}
                >
                  {draft.blockIp && <ThemedText type="small">✓</ThemedText>}
                </View>
                <ThemedText type="small" style={styles.grow}>
                  {t("report.blockIp")}
                </ThemedText>
              </Pressable>
            )}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={onClose}
              style={styles.action}
            >
              <ThemedText type="small">{t("report.cancel")}</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              onPress={onSubmit}
              style={[
                styles.action,
                { backgroundColor: theme.brand, opacity: submitting ? 0.6 : 1 },
              ]}
            >
              {submitting && <ActivityIndicator color={theme.text} size="small" />}
              <ThemedText type="smallBold">
                {t(
                  submitting
                    ? "report.submitting"
                    : accepted
                      ? "report.retryBlock"
                      : "report.submit"
                )}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    width: "100%",
    maxWidth: MaxContentWidth,
    maxHeight: "90%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: Spacing.four,
  },
  content: { paddingHorizontal: Spacing.four, gap: Spacing.three },
  control: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.three,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
  },
  reason: { flexDirection: "row", gap: Spacing.two, paddingVertical: Spacing.three, minHeight: 44 },
  grow: { flex: 1 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: Spacing.three,
    fontSize: 14,
    minHeight: 100,
    maxHeight: 180,
    textAlignVertical: "top",
  },
  count: { textAlign: "right" },
  checkbox: {
    height: 22,
    width: 22,
    borderWidth: 1,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: { flexDirection: "row", gap: Spacing.two, padding: Spacing.three },
  action: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    flexDirection: "row",
    gap: Spacing.two,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.two,
  },
});
