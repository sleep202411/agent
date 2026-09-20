import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import { buildStoryCanvasModel } from "./story-project-canvas-model";
import {
  parseStoryCommunityPointPrice,
  updateStoryCommunityPointPrice,
} from "./story-community-price";

function draft(): InteractiveStoryDraftContent {
  return {
    storyBible: { logline: "", synopsis: "", characters: [] },
    productionNotes: [],
    graph: {
      entryNodeId: "opening",
      nodes: [
        {
          kind: "clip",
          nodeId: "opening",
          clipKey: "OPENING",
          interactions: [],
          exit: { kind: "auto", routes: [{ target: { kind: "node", nodeId: "decision" } }] },
        },
        {
          kind: "decision",
          nodeId: "decision",
          exit: {
            kind: "choice",
            decisionId: "gate",
            prompt: { "en-US": "Enter?" },
            choices: [
              {
                choiceId: "enter",
                label: { "en-US": "Enter" },
                target: { kind: "node", nodeId: "opening" },
              },
              { choiceId: "leave", label: { "en-US": "Leave" }, target: null },
            ],
          },
        },
      ],
    },
  };
}

describe("community point settings", () => {
  it("accepts free and integer prices, rejecting invalid input", () => {
    expect(parseStoryCommunityPointPrice("0")).toBe(0);
    expect(parseStoryCommunityPointPrice(" 20 ")).toBe(20);
    for (const invalid of ["", "-1", "1.5", "1e3", "0x10", "abc", "2147483648"])
      expect(parseStoryCommunityPointPrice(invalid)).toBeNull();
  });
  it("updates a node without touching story content or choices", () => {
    const original = draft();
    const changed = updateStoryCommunityPointPrice(original, "opening", 20);
    expect(changed.graph.nodes[0]).toEqual({ ...original.graph.nodes[0], communityPointPrice: 20 });
    expect(changed.graph.nodes[1]).toBe(original.graph.nodes[1]);
    expect(
      (original.graph.nodes[0] as { communityPointPrice?: number }).communityPointPrice
    ).toBeUndefined();
    expect(updateStoryCommunityPointPrice(changed, "opening", 0)).toEqual(original);
  });
  it("projects only the linked node price and follows reconnections", () => {
    const priced = updateStoryCommunityPointPrice(draft(), "opening", 30);
    const choices = (content: InteractiveStoryDraftContent) =>
      buildStoryCanvasModel(content, "en-US").nodes.find((node) => node.id === "decision")!.data
        .choices!;
    expect(choices(priced).map((choice) => choice.communityPointPrice)).toEqual([30, undefined]);
    const decision = priced.graph.nodes[1]!;
    if (decision.exit.kind !== "choice") throw new Error("Expected decision");
    expect(decision.exit.choices[0]).not.toHaveProperty("communityPointPrice");
    decision.exit.choices[1]!.target = { kind: "node", nodeId: "opening" };
    expect(choices(priced).map((choice) => choice.communityPointPrice)).toEqual([30, 30]);
    const free = updateStoryCommunityPointPrice(priced, "opening", 0);
    expect(choices(free).map((choice) => choice.communityPointPrice)).toEqual([
      undefined,
      undefined,
    ]);
    decision.exit.choices[0]!.target = null;
    expect(choices(priced)[0]!.communityPointPrice).toBeUndefined();
  });
  it("rejects prices on a decision node", () => {
    expect(() => updateStoryCommunityPointPrice(draft(), "decision", 20)).toThrow(
      "Only story nodes"
    );
  });
  it("treats an unchanged price as a no-op and rejects deleted targets", () => {
    const original = draft();
    expect(updateStoryCommunityPointPrice(original, "opening", 0)).toBe(original);
    expect(() => updateStoryCommunityPointPrice(original, "missing", 20)).toThrow();
  });
});
