import { STORY_VISUAL_STYLE_SKILL_SLUGS } from "@repo/shared";
import type { MessageKey } from "@/i18n";
import type { AgentOsPendingUserInputQuestion } from "../api/agent-os-api";

type Translate = (key: MessageKey) => string;
const profileQuestions = ["aspect_ratio", "target_runtime", "visual_direction", "story_language"];

/** Fixed creative-profile enums use the same locale catalog as Web; authored copy stays intact. */
export function agentInputQuestionCopy(
  formId: string | undefined,
  question: AgentOsPendingUserInputQuestion,
  t: Translate
) {
  if (formId !== "story_creative_profile" || !profileQuestions.includes(question.id))
    return question;
  return {
    header: t(`agent.userInputProfile.${question.id}.header` as MessageKey),
    question: t(`agent.userInputProfile.${question.id}.question` as MessageKey),
  };
}

export function agentInputOptionLabel(
  formId: string | undefined,
  questionId: string,
  option: AgentOsPendingUserInputQuestion["options"][number],
  locale: string,
  t: Translate
): string {
  if (formId !== "story_creative_profile") return option.label;
  const { value } = option;
  if (questionId === "aspect_ratio" && ["portrait_9_16", "landscape_16_9"].includes(value))
    return t(`storyProfile.frameProfiles.${value}` as MessageKey);
  if (
    questionId === "target_runtime" &&
    ["short_5_15", "medium_15_30", "long_30_60"].includes(value)
  )
    return t(`storyProfile.durationPresets.${value}` as MessageKey);
  if (
    questionId === "visual_direction" &&
    STORY_VISUAL_STYLE_SKILL_SLUGS.some((slug) => slug === value)
  )
    return t(`storyProfile.visualStyles.${value}` as MessageKey);
  if (questionId === "story_language") {
    try {
      return new Intl.DisplayNames([locale], { type: "language" }).of(value) ?? option.label;
    } catch {
      return option.label;
    }
  }
  return option.label;
}
