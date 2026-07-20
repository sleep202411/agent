import {
  STORY_DIRECTING_SKILL_KEYS,
  STORY_DIRECTING_SKILL_KEY,
  type StoryDirectingSkillKey,
} from "@repo/shared/story-directing-skills";

export type StoryCanvasSkillCopyKey = "halftoneCollage" | "symmetricalStorybook";

export type StoryCanvasSkillIcon = "collage" | "symmetry";

export const STORY_CANVAS_DIRECTING_SKILLS: readonly {
  key: StoryDirectingSkillKey;
  copyKey: StoryCanvasSkillCopyKey;
  icon: StoryCanvasSkillIcon;
  /**
   * Optional card artwork under /public, shown uncovered in the card's image
   * zone (text left, art right). Left-anchored compositions crop best; alpha
   * PNGs let the card surface show through.
   */
  illustration?: string;
}[] = [
  {
    key: STORY_DIRECTING_SKILL_KEY.HALFTONE_COLLAGE,
    copyKey: "halftoneCollage",
    icon: "collage",
    illustration: "/story-skills/halftone-collage.png",
  },
  {
    key: STORY_DIRECTING_SKILL_KEY.SYMMETRICAL_STORYBOOK,
    copyKey: "symmetricalStorybook",
    icon: "symmetry",
    illustration: "/story-skills/symmetrical-storybook.png",
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
