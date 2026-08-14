import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import {
  buildStoryCanvasModel,
  characterCanvasNodeId,
  syntheticDecisionNodeId,
} from "./story-project-canvas-model";

describe("film-only story canvas projection", () => {
  it("projects clips, choices and cast members", () => {
    const model = buildStoryCanvasModel(draft(), "en-US", [], {
      clip: "Clip",
      decision: "Decision",
    });
    expect(model.nodes.map((node) => node.id)).toEqual([
      "clip:a",
      syntheticDecisionNodeId("clip:a"),
      "clip:b",
      characterCanvasNodeId("hero"),
    ]);
    expect(model.nodes.map((node) => node.data.kind)).toEqual([
      "clip",
      "decision",
      "clip",
      "character",
    ]);
    expect(model.nodes.every((node) => node.dragHandle === undefined)).toBe(true);
  });

  it("projects choice flow through the synthetic decision card", () => {
    const model = buildStoryCanvasModel(draft(), "en-US");
    expect(model.edges.map((edge) => edge.data.kind)).toEqual(["decision", "choice"]);
  });

  it("projects cast cards as non-interactive display nodes outside story wiring", () => {
    const model = buildStoryCanvasModel(draft(), "en-US");
    const characterNode = model.nodes.find((node) => node.data.kind === "character");

    expect(characterNode).toMatchObject({
      connectable: false,
      deletable: false,
      draggable: false,
      focusable: false,
      selectable: false,
    });
    expect(
      model.edges.some(
        (edge) => edge.source === characterNode?.id || edge.target === characterNode?.id
      )
    ).toBe(false);
  });
});

function draft(): InteractiveStoryDraftContent {
  return {
    storyBible: {
      logline: "A choice",
      synopsis: "",
      characters: [{ id: "hero", name: { "en-US": "Hero" }, summary: "", images: [], voice: null }],
    },
    graph: {
      entryNodeId: "clip:a",
      nodes: [
        {
          kind: "clip",
          nodeId: "clip:a",
          clipKey: "A",
          exit: {
            kind: "choice",
            decisionId: "decision:a",
            prompt: { "en-US": "Where next?" },
            choices: [{ choiceId: "go", label: { "en-US": "Go" }, nextNodeId: "clip:b" }],
          },
        },
        {
          kind: "clip",
          nodeId: "clip:b",
          clipKey: "B",
          exit: { kind: "auto", nextNodeId: null },
        },
      ],
    },
    productionNotes: [],
  };
}
