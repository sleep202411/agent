import { STORY_VISUAL_STYLE_SKILL_SLUGS, type StoryVisualStyleSkillSlug } from "@repo/shared";

import type { MessageKey } from "@/i18n";

export const STORY_CREATIVE_PROFILE_FORM_ID = "story_creative_profile";

const QUESTION_COPY = {
  aspect_ratio: {
    header: "agent.profile.aspectRatio.header",
    question: "agent.profile.aspectRatio.question",
  },
  target_runtime: {
    header: "agent.profile.targetRuntime.header",
    question: "agent.profile.targetRuntime.question",
  },
  visual_direction: {
    header: "agent.profile.visualDirection.header",
    question: "agent.profile.visualDirection.question",
  },
  story_language: {
    header: "agent.profile.storyLanguage.header",
    question: "agent.profile.storyLanguage.question",
  },
} as const satisfies Record<string, { header: MessageKey; question: MessageKey }>;

const FRAME_LABELS = {
  landscape_16_9: "agent.profile.frame.landscape_16_9",
  portrait_9_16: "agent.profile.frame.portrait_9_16",
} as const satisfies Record<string, MessageKey>;

const DURATION_LABELS = {
  short_5_15: "agent.profile.duration.short_5_15",
  medium_15_30: "agent.profile.duration.medium_15_30",
  long_30_60: "agent.profile.duration.long_30_60",
} as const satisfies Record<string, MessageKey>;

const STYLE_LABELS = {
  "cinematic-realism": "agent.profile.style.cinematic-realism",
  "stylized-3d-cinema": "agent.profile.style.stylized-3d-cinema",
  "anime-cinematic": "agent.profile.style.anime-cinematic",
  "graphic-novel-cinema": "agent.profile.style.graphic-novel-cinema",
  "ink-wash-cinema": "agent.profile.style.ink-wash-cinema",
  "stop-motion-clay-cinema": "agent.profile.style.stop-motion-clay-cinema",
  "classic-cel-animation": "agent.profile.style.classic-cel-animation",
  "hand-painted-fantasy-adventure": "agent.profile.style.hand-painted-fantasy-adventure",
  "retro-anime-key-visual": "agent.profile.style.retro-anime-key-visual",
  "pixel-art-adventure": "agent.profile.style.pixel-art-adventure",
  "surreal-collage-dreamscape": "agent.profile.style.surreal-collage-dreamscape",
  "grindhouse-chapter-cinema": "agent.profile.style.grindhouse-chapter-cinema",
} as const satisfies Record<StoryVisualStyleSkillSlug, MessageKey>;

export type StoryProfileQuestionId = keyof typeof QUESTION_COPY;

export function isStoryCreativeProfileForm(formId: string | undefined): boolean {
  return formId === STORY_CREATIVE_PROFILE_FORM_ID;
}

export function storyProfileQuestionCopy(
  questionId: string
): { header: MessageKey; question: MessageKey } | null {
  if (!Object.prototype.hasOwnProperty.call(QUESTION_COPY, questionId)) return null;
  return QUESTION_COPY[questionId as StoryProfileQuestionId];
}

export function storyProfileOptionLabelKey(questionId: string, value: string): MessageKey | null {
  if (questionId === "aspect_ratio" && value in FRAME_LABELS) {
    return FRAME_LABELS[value as keyof typeof FRAME_LABELS];
  }
  if (questionId === "target_runtime" && value in DURATION_LABELS) {
    return DURATION_LABELS[value as keyof typeof DURATION_LABELS];
  }
  if (
    questionId === "visual_direction" &&
    STORY_VISUAL_STYLE_SKILL_SLUGS.some((slug) => slug === value)
  ) {
    return STYLE_LABELS[value as StoryVisualStyleSkillSlug];
  }
  return null;
}

export function storyLanguageLabel(value: string, locale: string, fallback: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(value) ?? fallback;
  } catch {
    return fallback;
  }
}
