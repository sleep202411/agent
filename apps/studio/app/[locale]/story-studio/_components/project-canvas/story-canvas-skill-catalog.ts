import {
  STORY_DIRECTING_SKILL_KEY,
  type StoryDirectingSkillKey,
} from "@repo/shared/story-directing-skills";

/**
 * The Studio half of a directing skill.
 *
 * A skill is split across owners: `@repo/shared` owns the stable versioned wire
 * key, Studio owns the localized copy (`copyKey`) and artwork, and the server
 * owns any model-facing instruction. Nothing here carries instruction text.
 *
 * The key is kept even though the Studio Agent's submit contract is `.strict()`
 * and has no skill field: it is the stable identity behind the i18n key and the
 * bundled artwork, and it keeps the versioning discipline in
 * `story-directing-skills.ts` intact if a scenario-parameter channel ever
 * appears. What reaches the model today is the seeded message text alone.
 */
export type StoryCanvasSkillCopyKey = "halftoneCollage" | "symmetricalStorybook";

export type StoryCanvasSkillIcon = "collage" | "symmetry";

export const STORY_CANVAS_DIRECTING_SKILLS: readonly {
  key: StoryDirectingSkillKey;
  copyKey: StoryCanvasSkillCopyKey;
  icon: StoryCanvasSkillIcon;
  /**
   * Optional card artwork under /public, shown uncovered in the card's image
   * zone (art left, text right). Left-anchored compositions crop best; alpha
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
