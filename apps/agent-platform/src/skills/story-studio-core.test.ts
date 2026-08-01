import { describe, expect, it } from "vitest";

import {
  STORY_STUDIO_CORE_INSTRUCTIONS,
  storyStudioAlwaysOnInstructions,
  storyStudioCoreSkill,
} from "./story-studio-core.js";

describe("Story Studio core skill", () => {
  it("is an always-on, non-user-invocable product skill", () => {
    expect(storyStudioCoreSkill.name).toBe("story-studio-core");
    expect(storyStudioCoreSkill["user-invocable"]).toBe(false);
    expect(storyStudioCoreSkill.metadata).toMatchObject({
      surface: "story-studio",
      version: 1,
      alwaysOn: true,
    });
  });

  it("defines the source intake, bounded retrieval, and atomic authoring contract", () => {
    expect(STORY_STUDIO_CORE_INSTRUCTIONS).toContain(
      "material, not an automatic request to rewrite the canvas"
    );
    expect(STORY_STUDIO_CORE_INSTRUCTIONS).toContain("story_query_source_material");
    expect(STORY_STUDIO_CORE_INSTRUCTIONS).toContain("story_get_source_analysis first");
    expect(STORY_STUDIO_CORE_INSTRUCTIONS).toContain("complete source coverage");
    expect(STORY_STUDIO_CORE_INSTRUCTIONS).toContain("Range mode is the exhaustive path");
    expect(STORY_STUDIO_CORE_INSTRUCTIONS).toContain("Canonical canvas writes are atomic");
    expect(STORY_STUDIO_CORE_INSTRUCTIONS).toContain('Never simulate "streaming edits"');
    expect(STORY_STUDIO_CORE_INSTRUCTIONS).toContain("partially mutating the graph");
  });

  it("mounts the contract only on the Story Studio surface", () => {
    expect(storyStudioAlwaysOnInstructions("story-studio")).toBe(STORY_STUDIO_CORE_INSTRUCTIONS);
    expect(storyStudioAlwaysOnInstructions("crew-management")).toBe("");
  });
});
