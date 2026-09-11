import { z } from "zod";
import { STORY_VISUAL_STYLE_SKILL_SLUGS } from "@repo/shared";

export const STORY_CREATIVE_PROFILE_FORM_ID = "story_creative_profile" as const;

/** Languages currently supported end-to-end by Story Studio authoring. */
export const StoryCreativeProfileLanguageSchema = z.enum(["zh-CN", "zh-HK", "en-US"]);

/**
 * The durable interaction contract, ordered exactly as the creator experiences
 * it. Keeping this outside the model prompt prevents the registry, LangGraph
 * adapter, and server journal validator from drifting apart again.
 */
export const STORY_CREATIVE_PROFILE_QUESTION_OPTIONS = [
  ["aspect_ratio", ["portrait_9_16", "landscape_16_9"]],
  ["target_runtime", ["short_5_15", "medium_15_30", "long_30_60"]],
  ["visual_direction", STORY_VISUAL_STYLE_SKILL_SLUGS],
  ["story_language", StoryCreativeProfileLanguageSchema.options],
] as const;

export type StoryCreativeProfileQuestionId =
  (typeof STORY_CREATIVE_PROFILE_QUESTION_OPTIONS)[number][0];

/**
 * Values already stated explicitly by the creator in the current request or
 * source material. They are carried separately from answers so the UI asks
 * only for genuine gaps while the durable journal still records how every
 * final profile value was obtained.
 */
export type StoryCreativeProfileKnownValues = Partial<
  Record<StoryCreativeProfileQuestionId, string>
>;

/** Fixed question copy is a fallback for clients without the Story locale catalog. */
const PROFILE_QUESTION_COPY: Record<StoryCreativeProfileQuestionId, [string, string]> = {
  aspect_ratio: ["Aspect ratio", "Which frame aspect ratio should the project use?"],
  target_runtime: ["Target runtime", "What is the target runtime?"],
  visual_direction: ["Visual direction", "Which visual style should the project use?"],
  story_language: ["Story language", "Which language should the story use?"],
};

/**
 * Models identify explicitly known values; code owns every remaining question
 * and its complete catalog. Missing values become questions, never preferences.
 * Invalid known values stay invalid so they cannot silently change user intent.
 */
export function canonicalizeStoryCreativeProfileInputRequest(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const request = value as Record<string, unknown>;
  if (request.formId !== STORY_CREATIVE_PROFILE_FORM_ID) return value;
  const knownValues = request.knownValues ?? {};
  if (!knownValues || typeof knownValues !== "object" || Array.isArray(knownValues)) return value;
  for (const [id, known] of Object.entries(knownValues)) {
    const field = STORY_CREATIVE_PROFILE_QUESTION_OPTIONS.find(([key]) => key === id);
    if (typeof known !== "string" || !field?.[1].some((option) => option === known)) return value;
  }
  return {
    ...request,
    knownValues,
    questions: STORY_CREATIVE_PROFILE_QUESTION_OPTIONS.filter(
      ([id]) => !Object.prototype.hasOwnProperty.call(knownValues, id)
    ).map(([id, values]) => ({
      id,
      header: PROFILE_QUESTION_COPY[id][0],
      question: PROFILE_QUESTION_COPY[id][1],
      options: values.map((option) => ({ value: option, label: option })),
    })),
  };
}

export function isCanonicalStoryCreativeProfileQuestions(value: unknown): boolean {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > STORY_CREATIVE_PROFILE_QUESTION_OPTIONS.length
  ) {
    return false;
  }
  let previousCanonicalIndex = -1;
  return value.every((question) => {
    if (!question || typeof question !== "object" || Array.isArray(question)) return false;
    const record = question as Record<string, unknown>;
    const canonicalIndex = STORY_CREATIVE_PROFILE_QUESTION_OPTIONS.findIndex(
      ([expectedId]) => expectedId === record.id
    );
    if (canonicalIndex <= previousCanonicalIndex) return false;
    previousCanonicalIndex = canonicalIndex;
    const canonical = STORY_CREATIVE_PROFILE_QUESTION_OPTIONS[canonicalIndex];
    if (!canonical || !Array.isArray(record.options)) return false;
    const [, expectedOptions] = canonical;
    const actualOptions = record.options.flatMap((option) => {
      if (!option || typeof option !== "object" || Array.isArray(option)) return [];
      const optionValue = (option as Record<string, unknown>).value;
      return typeof optionValue === "string" ? [optionValue] : [];
    });
    return (
      actualOptions.length === expectedOptions.length &&
      actualOptions.every((option, optionIndex) => option === expectedOptions[optionIndex])
    );
  });
}

export function isCompleteStoryCreativeProfileInputRequest(
  questions: unknown,
  knownValues: unknown
): boolean {
  if (!isCanonicalStoryCreativeProfileQuestions(questions)) return false;
  if (!knownValues || typeof knownValues !== "object" || Array.isArray(knownValues)) {
    return false;
  }

  const questionIds = new Set(
    (questions as Array<{ id: StoryCreativeProfileQuestionId }>).map((question) => question.id)
  );
  const knownEntries = Object.entries(knownValues);
  if (knownEntries.length + questionIds.size !== STORY_CREATIVE_PROFILE_QUESTION_OPTIONS.length) {
    return false;
  }

  for (const [rawQuestionId, rawValue] of knownEntries) {
    const questionId = rawQuestionId as StoryCreativeProfileQuestionId;
    const canonical = STORY_CREATIVE_PROFILE_QUESTION_OPTIONS.find(
      ([candidateId]) => candidateId === questionId
    );
    if (
      questionIds.has(questionId) ||
      typeof rawValue !== "string" ||
      !canonical?.[1].some((allowedValue) => allowedValue === rawValue)
    ) {
      return false;
    }
  }

  return STORY_CREATIVE_PROFILE_QUESTION_OPTIONS.every(
    ([questionId]) =>
      questionIds.has(questionId) || Object.prototype.hasOwnProperty.call(knownValues, questionId)
  );
}
