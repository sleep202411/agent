import { z } from "zod";
import { ExperienceUIThemeSchema } from "./ui-theme.js";

const actionLabel = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (value) =>
      Array.from(value).every(
        (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127
      ),
    "Use plain text without line breaks or control characters."
  );
export const ExperienceUICopySchema = z
  .object({
    start: z
      .object({
        "en-US": actionLabel.nullable().optional(),
        "zh-CN": actionLabel.nullable().optional(),
        "zh-HK": actionLabel.nullable().optional(),
      })
      .strict()
      .refine(
        (labels) => Object.values(labels).some((label) => label !== undefined),
        "Specify a locale for the start label."
      ),
  })
  .strict();
export type ExperienceUICopy = z.infer<typeof ExperienceUICopySchema>;

export function resolveExperienceStartLabel(
  copy: ExperienceUICopy | undefined,
  locale: string,
  fallback: string
): string {
  const label = copy?.start[locale as keyof ExperienceUICopy["start"]];
  return typeof label === "string" ? label : fallback;
}

/** One CSS/SVG bundle owns all visual styling; localized copy stays structured. */
export const ExperienceUIPresentationSchema = z
  .object({
    copy: ExperienceUICopySchema.optional(),
    theme: ExperienceUIThemeSchema.optional(),
  })
  .strict()
  .refine((value) => value.copy || value.theme, "Specify a theme or UI copy.");
export type ExperienceUIPresentation = z.infer<typeof ExperienceUIPresentationSchema>;

/** Partial copy edits retain other locales, while the theme is replaced as a complete bundle. */
export function mergeExperienceUIPresentation(
  current: ExperienceUIPresentation | undefined,
  proposal: ExperienceUIPresentation
): ExperienceUIPresentation {
  return {
    ...current,
    ...proposal,
    ...(proposal.copy
      ? { copy: { start: { ...current?.copy?.start, ...proposal.copy.start } } }
      : {}),
  };
}

/** Stable public parts and actions; runtime owns availability, validation and geometry. */
export const EXPERIENCE_UI_CONTRACT = {
  apiVersion: 1,
  copy: {
    start: {
      path: "presentation.copy.start",
      locales: ["en-US", "zh-CN", "zh-HK"],
      maximumCharacters: 80,
      description:
        "The ready Start button label only. Set the requested locale to a plain string; null restores the localized system default. Loading/starting labels and start behavior remain runtime-owned. Omit unchanged locales.",
    },
  },
  regions: {
    start: {
      parts: ["panel", "eyebrow", "title", "summary", "primary"],
      actions: ["start"],
      description:
        "Initial start screen. Primary enters the film after access checks; placement uses theme region alignment.",
      space: "viewport",
    },
    playback: {
      parts: ["controls", "progress", "pause", "rate"],
      actions: ["pause", "resume", "seek", "setRate"],
      space: "frame",
    },
    choices: {
      parts: ["prompt", "list", "option", "index", "price"],
      actions: ["choose"],
      space: "frame",
    },
    pause: {
      parts: ["panel", "title", "summary", "primary", "secondary"],
      actions: ["resume", "restart"],
      space: "frame",
    },
  },
  invariants: {
    mediaFit: "preserve-authored-aspect",
    minimumTargetPx: 44,
    reducedMotion: "respect-system",
    storyData: "read-only",
    access: "runtime-owned",
  },
} as const;
