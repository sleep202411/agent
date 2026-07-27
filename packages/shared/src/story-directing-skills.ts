/**
 * Stable wire keys for the directing skills available in Story Canvas.
 *
 * Display copy and prompt instructions intentionally do not live here: Studio
 * owns localized labels while the server owns model-facing instructions. The
 * shared package only defines the transport contract used by both surfaces.
 *
 * Keys are versioned and never reused. Retired keys (the 2026-07 six-skill
 * catalog) simply drop out of this list — history recovery treats unknown
 * keys as "no skill selected".
 */
export const STORY_DIRECTING_SKILL_KEY = {
  HALFTONE_COLLAGE: "story.directing.halftone-collage.v1",
  SYMMETRICAL_STORYBOOK: "story.directing.symmetrical-storybook.v1",
} as const;

export const STORY_DIRECTING_SKILL_KEYS = [
  STORY_DIRECTING_SKILL_KEY.HALFTONE_COLLAGE,
  STORY_DIRECTING_SKILL_KEY.SYMMETRICAL_STORYBOOK,
] as const;

export type StoryDirectingSkillKey = (typeof STORY_DIRECTING_SKILL_KEYS)[number];
