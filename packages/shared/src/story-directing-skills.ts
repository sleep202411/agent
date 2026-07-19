/**
 * Stable wire keys for the directing skills available in Story Canvas.
 *
 * Display copy and prompt instructions intentionally do not live here: Studio
 * owns localized labels while the server owns model-facing instructions. The
 * shared package only defines the transport contract used by both surfaces.
 */
export const STORY_DIRECTING_SKILL_KEY = {
  SYMMETRICAL_STORYBOOK: "story.directing.symmetrical-storybook.v1",
  INTIMATE_REALISM: "story.directing.intimate-realism.v1",
  EASTERN_DREAMSCAPE: "story.directing.eastern-dreamscape.v1",
  PSYCHOLOGICAL_MYSTERY: "story.directing.psychological-mystery.v1",
  RETRO_FUTURE_NOIR: "story.directing.retro-future-noir.v1",
  HANDCRAFTED_FABLE: "story.directing.handcrafted-fable.v1",
} as const;

export const STORY_DIRECTING_SKILL_KEYS = [
  STORY_DIRECTING_SKILL_KEY.SYMMETRICAL_STORYBOOK,
  STORY_DIRECTING_SKILL_KEY.INTIMATE_REALISM,
  STORY_DIRECTING_SKILL_KEY.EASTERN_DREAMSCAPE,
  STORY_DIRECTING_SKILL_KEY.PSYCHOLOGICAL_MYSTERY,
  STORY_DIRECTING_SKILL_KEY.RETRO_FUTURE_NOIR,
  STORY_DIRECTING_SKILL_KEY.HANDCRAFTED_FABLE,
] as const;

export type StoryDirectingSkillKey = (typeof STORY_DIRECTING_SKILL_KEYS)[number];
