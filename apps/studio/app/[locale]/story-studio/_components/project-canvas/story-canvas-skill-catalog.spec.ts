import { describe, expect, it } from "vitest";
import { STORY_DIRECTING_SKILL_KEYS } from "@repo/shared/story-directing-skills";
import enUS from "@/messages/en-US.json";
import { STORY_CANVAS_DIRECTING_SKILLS } from "./story-canvas-skill-catalog";

describe("story canvas directing skills", () => {
  it("exposes every shared skill exactly once", () => {
    expect(STORY_CANVAS_DIRECTING_SKILLS).toHaveLength(2);
    expect(STORY_CANVAS_DIRECTING_SKILLS.map((skill) => skill.key)).toEqual(
      STORY_DIRECTING_SKILL_KEYS
    );
  });

  it("has localized copy behind every catalogue entry", () => {
    const copy: Record<
      string,
      { title: string; description: string; prompt: string; styleBrief: string }
    > = enUS.storyStudio.canvas.firstOpen.skills;

    for (const skill of STORY_CANVAS_DIRECTING_SKILLS) {
      expect(Object.keys(copy)).toContain(skill.copyKey);
      const entry = copy[skill.copyKey];
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.prompt.length).toBeGreaterThan(0);
      // The server no longer injects art direction for these skills, so the
      // seeded message is the only thing that can carry the look.
      expect(entry.styleBrief.length).toBeGreaterThan(0);
    }
  });
});
