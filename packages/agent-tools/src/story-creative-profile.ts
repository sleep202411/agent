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

type StoryCreativeProfileOption = {
  value: string;
  label: string;
  description?: string;
};

/**
 * Fixed product catalogs are runtime-owned, not model-authored. Models still
 * provide localized labels and question copy, but may abbreviate a long option
 * list even when instructed not to. Expand any valid canonical subset back to
 * the complete ordered catalog before strict validation and persistence.
 *
 * Unknown values, duplicates, malformed options, question omissions, and
 * invented knownValues are deliberately left untouched so the strict schema
 * rejects them instead of silently changing creator intent.
 */
export function canonicalizeStoryCreativeProfileInputRequest(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const request = value as Record<string, unknown>;
  if (request.formId !== STORY_CREATIVE_PROFILE_FORM_ID || !Array.isArray(request.questions)) {
    return value;
  }

  let changed = false;
  const questions = request.questions.map((question) => {
    if (!question || typeof question !== "object" || Array.isArray(question)) return question;
    const record = question as Record<string, unknown>;
    const canonical = STORY_CREATIVE_PROFILE_QUESTION_OPTIONS.find(
      ([questionId]) => questionId === record.id
    );
    if (!canonical || !Array.isArray(record.options)) return question;

    const [, expectedValues] = canonical;
    if (record.options.length < 2 || record.options.length > expectedValues.length) return question;

    const supplied = record.options as unknown[];
    const suppliedByValue = new Map<string, StoryCreativeProfileOption>();
    for (const rawOption of supplied) {
      if (!rawOption || typeof rawOption !== "object" || Array.isArray(rawOption)) return question;
      const option = rawOption as Record<string, unknown>;
      if (
        typeof option.value !== "string" ||
        typeof option.label !== "string" ||
        !expectedValues.some((expectedValue) => expectedValue === option.value) ||
        suppliedByValue.has(option.value)
      ) {
        return question;
      }
      suppliedByValue.set(option.value, rawOption as StoryCreativeProfileOption);
    }

    const alreadyCanonical =
      supplied.length === expectedValues.length &&
      supplied.every(
        (rawOption, optionIndex) =>
          (rawOption as StoryCreativeProfileOption).value === expectedValues[optionIndex]
      );
    if (alreadyCanonical) return question;

    changed = true;
    return {
      ...record,
      options: expectedValues.map(
        (optionValue): StoryCreativeProfileOption =>
          suppliedByValue.get(optionValue) ?? {
            value: optionValue,
            // Fixed-form clients render canonical values through their locale
            // catalog. This fallback keeps the generic protocol self-describing.
            label: optionValue,
          }
      ),
    };
  });

  return changed ? { ...request, questions } : value;
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
