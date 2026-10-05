import { SymbolView } from "expo-symbols";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { Colors, Spacing } from "@/constants/theme";
import { useLocale, useTranslations } from "@/i18n";

import { agentInputQuestionCopy, agentInputOptionLabel } from "../lib/agent-input-copy";
import { fillMessageTemplate } from "../api/story-production-api";
import { useAgentInputForm } from "../hooks/use-agent-input-form";
import type { AgentOsPendingUserInput } from "../api/agent-os-api";

const theme = Colors.dark;

type AgentUserInputCardProps = {
  request: AgentOsPendingUserInput;
  busy: boolean;
  onSubmit: (answers: Record<string, string>) => void;
};

/** Multi-step user input gate — mirrors PC `AgentOsUserInputCard`. */
export function AgentUserInputCard(props: AgentUserInputCardProps) {
  return <AgentUserInputView key={JSON.stringify(props.request)} {...props} />;
}

function AgentUserInputView({ request, busy, onSubmit }: AgentUserInputCardProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { height } = useWindowDimensions();
  const questions = request.questions;
  const { step, question, isLast, selected, choose, back, submit } = useAgentInputForm(
    questions,
    busy,
    onSubmit
  );

  if (!question) return null;
  const questionCopy = agentInputQuestionCopy(request.formId, question, t);

  const stepLabel = fillMessageTemplate(t("agent.userInputStep"), {
    current: step + 1,
    total: questions.length,
  });

  return (
    <View style={styles.card}>
      <ScrollView
        key={question.id}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        style={{ maxHeight: Math.max(140, height * 0.42) }}
        contentContainerStyle={styles.body}
      >
        <View style={styles.stepRow}>
          <Text style={styles.stepLabel}>{stepLabel}</Text>
          <View style={styles.progressTrack}>
            {questions.map((item, index) => (
              <View
                key={item.id}
                style={[
                  styles.progressSegment,
                  index <= step ? styles.progressActive : styles.progressIdle,
                ]}
              />
            ))}
          </View>
        </View>

        <View style={styles.questionHeader}>
          <View style={styles.qBadge}>
            <Text style={styles.qBadgeText}>Q{step + 1}</Text>
          </View>
          {questionCopy.header ? (
            <Text style={styles.questionHeaderText}>{questionCopy.header}</Text>
          ) : null}
          <Text style={styles.requiredMark}>*</Text>
        </View>
        <Text style={styles.questionBody}>{questionCopy.question}</Text>

        <View style={styles.optionsGrid}>
          {question.options.map((option) => {
            const checked = option.value === selected;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked, disabled: busy }}
                aria-checked={checked}
                disabled={busy}
                onPress={() => choose(option.value)}
                style={({ pressed }) => [
                  styles.option,
                  checked && styles.optionSelected,
                  pressed && !busy && styles.pressed,
                ]}
              >
                <Text style={styles.optionLabel}>
                  {agentInputOptionLabel(request.formId, question.id, option, locale, t)}
                </Text>
                {option.description ? (
                  <Text style={styles.optionDescription}>{option.description}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View style={styles.actions}>
        {step > 0 ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={back}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          >
            <SymbolView
              name={{ ios: "chevron.left", android: "chevron_left", web: "chevron_left" }}
              size={14}
              tintColor={theme.textSecondary}
            />
            <Text style={styles.backText}>{t("agent.userInputBack")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={!selected || busy}
          onPress={submit}
          style={({ pressed }) => [
            styles.submitBtn,
            !selected || busy ? styles.submitDisabled : styles.submitEnabled,
            pressed && selected && !busy && styles.pressed,
          ]}
        >
          {busy ? <ActivityIndicator color="#FFFFFF" size="small" style={styles.spinner} /> : null}
          <Text style={[styles.submitText, (!selected || busy) && styles.submitTextDisabled]}>
            {busy
              ? t("agent.userInputSubmitting")
              : isLast
                ? t("agent.userInputSubmit")
                : t("agent.userInputContinue")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.three },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: Spacing.three,
    padding: Spacing.three,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.28,
    shadowRadius: 40,
  },
  stepRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.three,
  },
  stepLabel: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1.2,
  },
  progressTrack: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
  },
  progressSegment: {
    borderRadius: 999,
    flex: 1,
    height: 2,
  },
  progressActive: {
    backgroundColor: theme.brand,
  },
  progressIdle: {
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  questionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
  },
  qBadge: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  qBadgeText: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 10,
    fontWeight: "600",
  },
  questionHeaderText: {
    color: theme.text,
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  requiredMark: {
    color: theme.brand,
    fontSize: 14,
    fontWeight: "600",
  },
  questionBody: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 11,
    lineHeight: 17,
  },
  optionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  option: {
    backgroundColor: "rgba(255,255,255,0.065)",
    borderRadius: 16,
    flexGrow: 1,
    flexBasis: "46%",
    maxWidth: "48%",
    minHeight: 80,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  optionSelected: {
    backgroundColor: "rgba(229,34,39,0.095)",
    borderColor: theme.brand,
    borderWidth: 1.5,
  },
  optionLabel: {
    color: theme.text,
    fontSize: 12,
    fontWeight: "600",
  },
  optionDescription: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 10,
    lineHeight: 14,
    marginTop: 4,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
  },
  backBtn: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  backText: {
    color: theme.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  submitBtn: {
    alignItems: "center",
    borderRadius: 12,
    flex: 1,
    flexDirection: "row",
    height: 44,
    justifyContent: "center",
    marginLeft: "auto",
  },
  submitEnabled: {
    backgroundColor: theme.brand,
  },
  submitDisabled: {
    backgroundColor: theme.backgroundSelected,
  },
  submitText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  submitTextDisabled: {
    color: "rgba(255,255,255,0.4)",
  },
  spinner: {
    marginRight: Spacing.two,
  },
  pressed: {
    opacity: 0.85,
  },
});
