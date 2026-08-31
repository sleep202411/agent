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
    expect(requireModeDefinition("story", "story").toolIds).toContain(
      "story.generation.quoteAssets"
    );
    expect(requireModeDefinition("story", "story").toolIds).toContain(
      "story.generation.confirmBatch"
    );
    expect(() => requireModeDefinition("platform", "story")).toThrow();
    expect(() => requireModeDefinition("story", "canvas")).toThrow();
  });

  it("asks only for missing creative-profile decisions while the profile is unconfirmed", () => {
    const instructions = requireModeDefinition("story", "story").instructions;
    expect(instructions).toMatch(/ONLY (?:the|these) missing\s+questions/);
    expect(instructions).toContain("story_language (zh-CN / zh-HK / en-US)");
    expect(instructions).toContain("If none are missing, do not call");
    expect(instructions).toMatch(/never ask the\s+creator to confirm them again/);
    expect(instructions).toContain("call request_user_input exactly ONCE");
  });

  it("keeps conversation outside the Story production workflow", () => {
    const instructions = requireModeDefinition("story", "story").instructions;
    expect(instructions).toMatch(
      /For greetings, thanks, casual\s+conversation, capability questions, general knowledge/
    );
    expect(instructions).toContain("answer normally and call NO Story tool");
    expect(instructions).toContain('inputs such as "Hello", "Hi", "你好", and "谢谢"');
    expect(instructions).toContain("never call story_author");
    expect(instructions).toMatch(/Asking how the product\s+works is not permission/);
  });

  it("treats a creative seed in a canonically empty Story chapter as creation intent", () => {
    const instructions = requireModeDefinition("story", "story").instructions;
    expect(instructions).toContain("chapterHasNoScript=true");
    expect(instructions).toContain('Examples include "一只小猫"');
    expect(instructions).toMatch(/call story_read first/i);
    expect(instructions).toMatch(/set\s+continueThrough to storyboard/);
    expect(instructions).toMatch(
      /there is no\s+profile questionnaire or conversational confirmation/
    );
    expect(instructions).toMatch(/On mobile_h5,\s+call story_author directly/);
    expect(instructions).toMatch(
      /text\/specification authoring only on standard\/desktop\s+surfaces/
    );
    expect(instructions).toMatch(/Continue on the Plot Tree also\s+authorizes the server/);
    expect(instructions).toMatch(
      /chapterHasNoScript=false, a bare ambiguous phrase does not authorize an\s+edit/
    );
  });

  it("routes production from canonical stages instead of a fixed rebuild wizard", () => {
    const instructions = requireModeDefinition("story", "story").instructions;
    expect(instructions).toMatch(/Preserve\s+every current stage/);
    expect(instructions).toContain("script.status=missing selects screenplay creation");
    expect(instructions).toMatch(
      /script.status=current or stale means a Script already exists and MUST NOT be\s+replaced/
    );
    expect(instructions).toMatch(/productionState.ready=true\s+selects no-op/);
    expect(instructions).toMatch(
      /Only when canonical context has no valid chapter Script may story_author create/
    );
    expect(instructions).toMatch(/selects exactly one incremental Server proposal/);
    expect(instructions).toMatch(/One call creates exactly\s+ONE reviewable artifact proposal/);
    expect(instructions).toMatch(/still-unresolved intent/);
    expect(instructions).toMatch(/Continue automatically/);
    expect(instructions).toMatch(
      /Plot compiles the approved Script into the ONE\s+narrative topology/
    );
    expect(instructions).toMatch(/each Plot node projects to one Storyboard sequence/);
    expect(instructions).toMatch(/persist Asset\s+Specs without another creator checkpoint/);
    expect(instructions).toMatch(/creator uses Generate/);
    expect(instructions).toMatch(
      /Script,\s+Plot, Asset Specs, and Storyboard proposals are separate creator-visible\s+checkpoints/
    );
    expect(instructions).toMatch(/Plot Continue also authorizes/);
    expect(instructions).toMatch(/Storyboard Continue saves its specifications/);
    expect(instructions).toMatch(/Never treat automatic proposal preparation as approval/);
    expect(instructions).not.toContain("deterministic authoring pipeline");
    expect(instructions).not.toContain("hand-build a whole tree scene-by-scene");
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
