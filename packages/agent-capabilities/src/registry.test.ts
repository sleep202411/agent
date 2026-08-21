import { describe, expect, it } from "vitest";

import {
  getModeDefinition,
  isModeAvailable,
  listModeDefinitions,
  listProjectKindDefinitions,
  requireModeDefinition,
} from "./index.js";

describe("agent capability registry", () => {
  it("registers the three existing platform modes", () => {
    expect(listProjectKindDefinitions().map((definition) => definition.projectKind)).toEqual([
      "platform",
      "story",
    ]);
    expect(listModeDefinitions("platform").map((definition) => definition.mode)).toEqual([
      "storyboard",
      "canvas",
      "brief",
    ]);
  });

  it("mounts the Story capability set only for Story projects", () => {
    expect(listModeDefinitions("story").map((definition) => definition.mode)).toEqual(["story"]);
    expect(requireModeDefinition("story", "story").toolIds).toContain("story.addBranch");
    expect(requireModeDefinition("story", "story").toolIds).toContain("request_user_input");
    expect(requireModeDefinition("story", "story").toolIds).toContain(
      "story.confirmCreativeProfile"
    );
    expect(() => requireModeDefinition("platform", "story")).toThrow();
    expect(() => requireModeDefinition("story", "canvas")).toThrow();
  });

  it("asks only for missing creative-profile decisions while the profile is unconfirmed", () => {
    const instructions = requireModeDefinition("story", "story").instructions;
    expect(instructions).toContain("ONLY the missing questions");
    expect(instructions).toContain("story_language (zh-CN / zh-HK / en-US)");
    expect(instructions).toContain("If none are missing, do not call");
    expect(instructions).toContain("never ask the creator to confirm them again");
  });

  it("owns each mode's exact tool subset", () => {
    expect(getModeDefinition("platform", "canvas")?.toolIds).toEqual([
      "characters.list",
      "storyboard.listShots",
      "canvas.read",
      "canvas.applyPatch",
    ]);
  });

  it("validates the project-kind/mode pair", () => {
    expect(isModeAvailable("platform", "storyboard")).toBe(true);
    expect(isModeAvailable("story", "storyboard")).toBe(false);
    expect(() => requireModeDefinition("story", "storyboard")).toThrow(
      "not available for project kind story"
    );
  });
});
