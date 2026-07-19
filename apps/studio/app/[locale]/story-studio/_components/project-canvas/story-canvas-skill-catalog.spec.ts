import { describe, expect, it } from "vitest";
import { STORY_DIRECTING_SKILL_KEYS } from "@repo/shared/story-directing-skills";
import {
  STORY_CANVAS_DIRECTING_SKILLS,
  storyCanvasSkillKeyFromHistory,
} from "./story-canvas-skill-catalog";

describe("story canvas directing skills", () => {
  it("exposes every shared skill exactly once", () => {
    expect(STORY_CANVAS_DIRECTING_SKILLS).toHaveLength(6);
    expect(STORY_CANVAS_DIRECTING_SKILLS.map((skill) => skill.key)).toEqual(
      STORY_DIRECTING_SKILL_KEYS
    );
  });

  it("restores only a supported persisted skill", () => {
    expect(storyCanvasSkillKeyFromHistory([STORY_DIRECTING_SKILL_KEYS[2]])).toBe(
      STORY_DIRECTING_SKILL_KEYS[2]
    );
    expect(storyCanvasSkillKeyFromHistory(["story.directing.unknown.v1"])).toBeNull();
    expect(storyCanvasSkillKeyFromHistory(null)).toBeNull();
  });
});
