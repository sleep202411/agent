import { describe, expect, it } from "vitest";
import type { StoryBuildDiagnostic } from "@/lib/story-projects-api";
import { storyDecisionCanvasNodeId } from "./story-project-canvas-model";
import { groupStoryCanvasIssues } from "./story-canvas-validation";

function diagnostic(overrides: Partial<StoryBuildDiagnostic>): StoryBuildDiagnostic {
  return {
    severity: "error",
    code: "STORY_BUILD_EXAMPLE",
    message: "Example blocker.",
    entityType: "clip",
    entityId: null,
    ...overrides,
  };
}

describe("groupStoryCanvasIssues", () => {
  it("pins diagnostics to the matching canvas node", () => {
    const validation = groupStoryCanvasIssues(
      [diagnostic({ entityId: "clip:S01" })],
      new Set(["clip:S00", "clip:S01"])
    );
    expect(validation.projectIssues).toEqual([]);
    expect(validation.issuesByNodeId.get("clip:S01")).toHaveLength(1);
    expect(validation.issuesByNodeId.get("clip:S00")).toBeUndefined();
  });

  it("routes a choice-level issue to the derived decision card", () => {
    const sourceNodeId = "clip:S00";
    const validation = groupStoryCanvasIssues(
      [diagnostic({ entityType: "choice", entityId: sourceNodeId })],
      new Set([sourceNodeId, storyDecisionCanvasNodeId(sourceNodeId)])
    );
    expect(validation.issuesByNodeId.get(storyDecisionCanvasNodeId(sourceNodeId))).toHaveLength(1);
    expect(validation.issuesByNodeId.get(sourceNodeId)).toBeUndefined();
  });

  it("keeps a choice-level issue on the scene when no decision card exists", () => {
    const validation = groupStoryCanvasIssues(
      [diagnostic({ entityType: "choice", entityId: "clip:S00" })],
      new Set(["clip:S00"])
    );
    expect(validation.issuesByNodeId.get("clip:S00")).toHaveLength(1);
  });

  it("keeps issues that name no canvas node project-scoped", () => {
    const validation = groupStoryCanvasIssues(
      [
        diagnostic({ entityId: null, code: "STORY_BUILD_ENTRY_NODE_MISSING" }),
        diagnostic({ entityId: "clip:GONE" }),
      ],
      new Set(["clip:S00"])
    );
    expect(validation.projectIssues).toHaveLength(2);
    expect(validation.issuesByNodeId.size).toBe(0);
  });

  it("ignores warnings — only blockers earn a badge", () => {
    const validation = groupStoryCanvasIssues(
      [diagnostic({ severity: "warning", entityId: "clip:S00" })],
      new Set(["clip:S00"])
    );
    expect(validation.issuesByNodeId.size).toBe(0);
    expect(validation.projectIssues).toEqual([]);
  });
});
