import {
  STORY_DIRECTING_SKILL_KEYS,
  STORY_DIRECTING_SKILL_KEY,
  type StoryDirectingSkillKey,
} from "@repo/shared/story-directing-skills";

export type StoryCanvasSkillCopyKey =
  | "symmetricalStorybook"
  | "intimateRealism"
  | "easternDreamscape"
  | "psychologicalMystery"
  | "retroFutureNoir"
  | "handcraftedFable";

export type StoryCanvasSkillIcon =
  | "symmetry"
  | "relationship"
  | "dreamscape"
  | "mystery"
  | "noir"
  | "handcrafted";

export const STORY_CANVAS_DIRECTING_SKILLS: readonly {
  key: StoryDirectingSkillKey;
  copyKey: StoryCanvasSkillCopyKey;
  icon: StoryCanvasSkillIcon;
}[] = [
  {
    key: STORY_DIRECTING_SKILL_KEY.SYMMETRICAL_STORYBOOK,
    copyKey: "symmetricalStorybook",
    icon: "symmetry",
  },
  {
    key: STORY_DIRECTING_SKILL_KEY.INTIMATE_REALISM,
    copyKey: "intimateRealism",
    icon: "relationship",
  },
  {
    key: STORY_DIRECTING_SKILL_KEY.EASTERN_DREAMSCAPE,
    copyKey: "easternDreamscape",
    icon: "dreamscape",
  },
  {
    key: STORY_DIRECTING_SKILL_KEY.PSYCHOLOGICAL_MYSTERY,
    copyKey: "psychologicalMystery",
    icon: "mystery",
  },
  {
    key: STORY_DIRECTING_SKILL_KEY.RETRO_FUTURE_NOIR,
    copyKey: "retroFutureNoir",
    icon: "noir",
  },
  {
    key: STORY_DIRECTING_SKILL_KEY.HANDCRAFTED_FABLE,
    copyKey: "handcraftedFable",
    icon: "handcrafted",
  },
];

export function storyCanvasSkillKeyFromHistory(value: unknown): StoryDirectingSkillKey | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  return typeof first === "string" &&
    STORY_DIRECTING_SKILL_KEYS.includes(first as StoryDirectingSkillKey)
    ? (first as StoryDirectingSkillKey)
    : null;
}
