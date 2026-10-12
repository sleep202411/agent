import { Image } from "expo-image";
import { useMemo } from "react";
import { useAuth } from "@/auth";
import { durableRecord } from "@/lib/durable-record";
import { agentInputRequestKey, type AgentInputDraftStorage } from "../lib/agent-input-draft";
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
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { Colors, Spacing } from "@/constants/theme";
import { useLocale, useTranslations } from "@/i18n";

import { agentInputQuestionCopy, agentInputOptionLabel } from "../lib/agent-input-copy";
import { fillMessageTemplate } from "../api/story-production-api";
import { useAgentInputForm } from "../hooks/use-agent-input-form";
import type { AgentOsPendingUserInput } from "../api/agent-os-api";
import {
  isStoryCreativeProfileForm,
  storyLanguageLabel,
  storyProfileOptionLabelKey,
  storyProfileQuestionCopy,
} from "../lib/story-profile-choices";
import { storyProfileStylePreview } from "../lib/story-profile-previews";

const theme = Colors.dark;

/** Bottom-half fade matching the web `from-black/95 via-black/55 to-transparent`. */
function StyleLabelScrim({ id }: { id: string }) {
  return (
    <View pointerEvents="none" style={styles.styleScrim}>
      <Svg width="100%" height="100%" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#000" stopOpacity={0.95} />
            <Stop offset="0.5" stopColor="#000" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#000" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

type AgentUserInputCardProps = {
  draftScope: { projectId: string; chapterId: string; workbenchMode: string };
  request: AgentOsPendingUserInput;
  busy: boolean;
  disabled?: boolean;
  onSubmit: (answers: Record<string, string>) => void;
};

/** Multi-step user input gate — mirrors PC `AgentOsUserInputCard`. */
export function AgentUserInputCard(props: AgentUserInputCardProps) {
  const auth = useAuth();
  const userId = auth.user?.id ?? auth.user?.userId;
  const identity = JSON.stringify(props.draftScope);
  const requestKey = agentInputRequestKey(props.request);
  const storage = useMemo(
    () =>
      auth.status === "authenticated" && userId
        ? { record: durableRecord("story-input-draft", String(userId), identity), requestKey }
        : undefined,
    [auth.status, userId, identity, requestKey]
  );
  return (
    <AgentUserInputView
      key={JSON.stringify([auth.generation, userId, identity, requestKey])}
      {...props}
      storage={storage}
    />
  );
}

function AgentUserInputView({
  request,
  busy,
  onSubmit,
  storage,
  disabled = false,
}: AgentUserInputCardProps & { storage?: AgentInputDraftStorage }) {
  const t = useTranslations();
  const locale = useLocale();
  const { height } = useWindowDimensions();
  const questions = request.questions;
  const locked = busy || disabled;
  const { step, question, isLast, selected, choose, back, submit, error } = useAgentInputForm(
    questions,
    locked,
    onSubmit,
    storage
  );

  if (!question) return null;
  const questionCopy = agentInputQuestionCopy(request.formId, question, t);

  const profileCopy = storyProfileQuestionCopy(question.id);
  const header = profileCopy ? t(profileCopy.header) : questionCopy.header;
  const body = profileCopy ? t(profileCopy.question) : questionCopy.question;
  const visualStyle =
    (isStoryCreativeProfileForm(request.formId) || profileCopy != null) &&
    question.id === "visual_direction";
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
        {error ? (
          <Text accessibilityRole="alert" style={{ color: theme.brand }}>
            {error}
          </Text>
        ) : null}
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
          {header ? <Text style={styles.questionHeaderText}>{header}</Text> : null}
          <Text style={styles.requiredMark}>*</Text>
        </View>
        <Text style={styles.questionBody}>{body}</Text>

        <ScrollView
          style={visualStyle ? styles.styleScroll : undefined}
          contentContainerStyle={[styles.optionsGrid, visualStyle && styles.styleGrid]}
          nestedScrollEnabled
          removeClippedSubviews={false}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={visualStyle}
        >
          {question.options.map((option) => {
            const checked = option.value === selected;
            const labelKey = profileCopy
              ? storyProfileOptionLabelKey(question.id, option.value)
              : null;
            const label =
              question.id === "story_language" && profileCopy
                ? storyLanguageLabel(option.value, locale, option.label)
                : labelKey
                  ? t(labelKey)
                  : agentInputOptionLabel(request.formId, question.id, option, locale, t);
            const preview = visualStyle ? storyProfileStylePreview(option.value) : null;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked, disabled: locked }}
                aria-checked={checked}
                disabled={locked}
                onPress={() => choose(option.value)}
                style={visualStyle ? styles.styleHit : styles.optionHit}
              >
                <View
                  style={[
                    visualStyle ? styles.styleOption : styles.option,
                    checked && styles.optionSelected,
                  ]}
                >
                  {preview != null ? (
                    <Image source={preview} style={styles.styleImage} contentFit="cover" />
                  ) : (
                    <FrameGlyph value={option.value} selected={checked} />
                  )}
                  {preview != null ? <StyleLabelScrim id={`style-scrim-${option.value}`} /> : null}
                  <Text style={[styles.optionLabel, preview != null && styles.styleLabel]}>
                    {label}
                  </Text>
                  {!preview && option.description ? (
                    <Text style={styles.optionDescription}>{option.description}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </ScrollView>
      <View style={styles.actions}>
        {step > 0 ? (
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            onPress={back}
            style={styles.actionHit}
          >
            <View style={[styles.backChrome, busy && styles.disabled]}>
              <SymbolView
                name={{ ios: "chevron.left", android: "chevron_left", web: "chevron_left" }}
                size={14}
                tintColor="rgba(255,255,255,0.88)"
              />
              <Text style={styles.backText}>{t("agent.userInputBack")}</Text>
            </View>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={!selected || locked}
          onPress={submit}
          style={styles.actionHit}
        >
          <View style={[styles.continueChrome, (!selected || locked) && styles.disabled]}>
            {busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
            <Text style={styles.continueText}>
              {busy
                ? t("agent.userInputSubmitting")
                : isLast
                  ? t("agent.userInputSubmit")
                  : t("agent.userInputContinue")}
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

function FrameGlyph({ value, selected }: { value: string; selected: boolean }) {
  const portrait = value.includes("9_16") || value.includes("portrait");
  const landscape = value.includes("16_9") || value.includes("landscape");
  if (!portrait && !landscape) return null;
  return (
    <View style={styles.glyphSlot}>
      <View
        style={[
          styles.glyph,
          portrait ? styles.glyphPortrait : styles.glyphLandscape,
          { borderColor: selected ? theme.brand : "rgba(255,255,255,0.6)" },
        ]}
      />
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
  questionTitle: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 2,
  },
  questionHeaderText: {
    color: theme.text,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "600",
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
  styleScroll: {
    flexGrow: 0,
    maxHeight: 248,
  },
  optionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  optionHit: {
    flexBasis: "46%",
    flexGrow: 1,
    maxWidth: "48%",
  },
  option: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.065)",
    borderRadius: 16,
    justifyContent: "center",
    minHeight: 80,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    width: "100%",
  },
  previewOption: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    overflow: "hidden",
  },
  preview: {
    width: "100%",
    aspectRatio: 2 / 3,
  },
  previewLabel: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  optionSelected: {
    backgroundColor: "rgba(229,34,39,0.095)",
    borderColor: theme.brand,
    borderWidth: 1.5,
  },
  styleGrid: {
    gap: 6,
  },
  styleHit: {
    flexBasis: "31%",
    flexGrow: 1,
    maxWidth: "32%",
  },
  styleOption: {
    backgroundColor: "rgba(255,255,255,0.065)",
    borderRadius: 12,
    overflow: "hidden",
    width: "100%",
  },
  styleImage: {
    aspectRatio: 2 / 3,
    width: "100%",
  },
  styleScrim: {
    bottom: 0,
    height: "50%",
    left: 0,
    position: "absolute",
    right: 0,
  },
  styleLabel: {
    bottom: 8,
    left: 8,
    position: "absolute",
    right: 8,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  glyphSlot: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    marginBottom: 8,
  },
  glyph: {
    borderRadius: 3,
    borderWidth: 2,
  },
  glyphPortrait: {
    height: 28,
    width: 14,
  },
  glyphLandscape: {
    height: 14,
    width: 28,
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
    flexDirection: "row",
    gap: Spacing.two,
    width: "100%",
  },
  actionHit: {
    flex: 1,
    minWidth: 0,
  },
  backChrome: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    flexDirection: "row",
    gap: 4,
    height: 40,
    justifyContent: "center",
    width: "100%",
  },
  backText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 12,
    fontWeight: "500",
  },
  continueChrome: {
    alignItems: "center",
    backgroundColor: theme.brand,
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
