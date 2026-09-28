import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import { createStoryHotspotId, migrateLegacyStoryHotspotIds } from "./story-interaction-ids";

describe("createStoryHotspotId", () => {
  it("turns a digit-leading UUID into a valid durable Story graph id", () => {
    const id = createStoryHotspotId("019ffc80-22af-704c-8403-cf77c5334696");

    expect(id).toBe("hotspot:019ffc80-22af-704c-8403-cf77c5334696");
    expect(id).toMatch(/^[A-Za-z][A-Za-z0-9._:-]*$/);
    expect(id.length).toBeLessThanOrEqual(120);
  });

  it("repairs only bare UUIDs created by the previous editor", () => {
    const legacyId = "019ffc80-22af-704c-8403-cf77c5334696";
    const letterLeadingLegacyId = "a19ffc80-22af-704c-8403-cf77c5334696";
    const content = storyDraftWithInteractionIds([
      legacyId,
      letterLeadingLegacyId,
      "hotspot:already-valid",
      "invalid id",
    ]);
    const migrated = migrateLegacyStoryHotspotIds(content);

    expect(migrated).not.toBe(content);
    const migratedClip = migrated.graph.nodes[0];
    expect(migratedClip?.kind).toBe("clip");
    expect(
      migratedClip?.kind === "clip"
        ? migratedClip.interactions.map(({ interactionId }) => interactionId)
        : []
    ).toEqual([
      `hotspot:${legacyId}`,
      `hotspot:${letterLeadingLegacyId}`,
      "hotspot:already-valid",
      "invalid id",
    ]);
    expect(migrateLegacyStoryHotspotIds(migrated)).toBe(migrated);
  });
});

function storyDraftWithInteractionIds(ids: string[]): InteractiveStoryDraftContent {
  return {
    storyBible: { logline: "", synopsis: "", characters: [] },
    graph: {
      entryNodeId: "clip:a",
      nodes: [
        {
          kind: "clip",
          nodeId: "clip:a",
          clipKey: "A",
          interactions: ids.map((interactionId) => ({
            kind: "hotspot",
            interactionId,
            label: { "en-US": interactionId },
            trigger: { kind: "tap" },
            rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
            startMs: 0,
            endMs: 1_000,
            outcomes: { success: { kind: "continue" } },
          })),
          exit: { kind: "auto", routes: [{ target: null }] },
        },
      ],
    },
    productionNotes: [],
  };
}
