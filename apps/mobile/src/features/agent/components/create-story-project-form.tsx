import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Colors, Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

const theme = Colors.dark;
const TITLE_MAX = 160;
const SUMMARY_MAX = 2000;
const PLACEHOLDER = "rgba(255,255,255,0.34)";

export type CreateStoryProjectValues = {
  title: string;
  summary: string | null;
};

type CreateStoryProjectFormProps = {
  busy?: boolean;
  onSubmit: (values: CreateStoryProjectValues) => void;
  submitLabel?: string;
};

/** Inline title + summary fields on the Create hub. */
export function CreateStoryProjectForm({
  busy = false,
  onSubmit,
  submitLabel,
}: CreateStoryProjectFormProps) {
  const t = useTranslations();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");

  const trimmed = title.trim();
  const canSubmit = trimmed.length > 0 && !busy;
  const label = submitLabel ?? t("agent.createProjectSubmit");

  return (
    <View style={styles.root}>
      <View style={styles.field}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>{t("agent.projectTitleLabel")}</Text>
          <Text style={styles.requiredMark}>*</Text>
        </View>
        <View style={styles.inputShell}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={t("agent.projectTitlePlaceholder")}
            placeholderTextColor={PLACEHOLDER}
            maxLength={TITLE_MAX}
            editable={!busy}
            style={styles.input}
          />
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("agent.projectSummaryLabel")}</Text>
        <View style={[styles.inputShell, styles.summaryShell]}>
          <TextInput
            value={summary}
            onChangeText={setSummary}
            placeholder={t("agent.projectSummaryPlaceholder")}
            placeholderTextColor={PLACEHOLDER}
            maxLength={SUMMARY_MAX}
            editable={!busy}
            multiline
            textAlignVertical="top"
            style={[styles.input, styles.summaryInput]}
          />
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={!canSubmit}
        onPress={() =>
          onSubmit({
            title: trimmed,
            summary: summary.trim() || null,
          })
        }
        style={({ pressed }) => (pressed && canSubmit ? styles.pressed : null)}
      >
        <View
          style={[styles.primaryButton, canSubmit ? styles.primaryEnabled : styles.primaryDisabled]}
        >
          {busy ? <ActivityIndicator color="#FFFFFF" style={styles.spinner} /> : null}
          <Text style={[styles.primaryText, !canSubmit && styles.primaryTextDisabled]}>
            {label}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing.two,
  },
  field: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  label: {
    color: theme.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  labelRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  requiredMark: {
    color: theme.brand,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 16,
  },
  inputShell: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: theme.border,
    borderRadius: 14,
    borderWidth: 1,
    height: 54,
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
  },
  summaryShell: {
    height: undefined,
    minHeight: 108,
    justifyContent: "flex-start",
    paddingVertical: Spacing.three,
  },
  input: {
    color: theme.text,
    fontSize: 16,
    fontWeight: "500",
    padding: 0,
  },
  summaryInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: 14,
    flexDirection: "row",
    height: 54,
    justifyContent: "center",
    marginTop: Spacing.three,
  },
  primaryEnabled: {
    backgroundColor: theme.brand,
  },
  primaryDisabled: {
    backgroundColor: theme.backgroundSelected,
  },
  primaryText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  primaryTextDisabled: {
    color: "rgba(255,255,255,0.4)",
  },
  spinner: {
    marginRight: Spacing.two,
  },
  pressed: {
    opacity: 0.75,
  },
});
