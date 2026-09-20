import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import {
  addChoiceOption,
  applyStoryBiblePatch,
  connectSceneContinuation,
  createDecisionNode,
  createClipNode,
  createWorldNode,
  deleteGraphNode,
  moveChoiceOption,
  putStoryEnding,
  putStoryStateVariable,
  removeStoryEnding,
  removeStoryStateVariable,
  setAutoRoutes,
  setNodeOnEnterEffects,
  updateChoiceStats,
  updateStoryClipMeta,
  updateChoiceExitPrompt,
} from "./story-project-canvas-mutations";

describe("story canvas mutations", () => {
  it("creates clip nodes with unique identities", () => {
    const first = createClipNode(draft(), { nodeId: "clip:a", clipKey: "A" });
    const second = createClipNode(first.content);
    expect(second.content.graph.nodes).toHaveLength(2);
    expect(second.created.kind).toBe("clip");
    expect(second.created.nodeId).not.toBe("clip:a");
    expect(second.created.clipKey).not.toBe("A");
  });

  it("creates a disconnected named Plot node from the Storyboard view", () => {
    const result = createClipNode(draft(), {
      nodeId: "clip:storyboard",
      clipKey: "STORYBOARD",
      name: "Untitled scene",
    });
    expect(result.created).toMatchObject({
      kind: "clip",
      nodeId: "clip:storyboard",
      clipKey: "STORYBOARD",
      name: "Untitled scene",
      exit: { kind: "auto", routes: [{ target: null }] },
    });
  });

  it("updates clip display metadata without changing its stable identity", () => {
    const created = createClipNode(draft(), { nodeId: "clip:a", clipKey: "A" });
    const next = updateStoryClipMeta(created.content, "clip:a", {
      name: "Opening",
      description: "Rain over Jinling.",
    });

    expect(next.graph.nodes[0]).toMatchObject({
      nodeId: "clip:a",
      clipKey: "A",
      name: "Opening",
      description: "Rain over Jinling.",
    });
  });

  it("connects clips and removes inbound references when a clip is deleted", () => {
    let content = createClipNode(draft(), { nodeId: "clip:a", clipKey: "A" }).content;
    content = createClipNode(content, { nodeId: "clip:b", clipKey: "B" }).content;
    content = connectSceneContinuation(content, "clip:a", "clip:b");
    content = deleteGraphNode(content, "clip:b");
    expect(content.graph.nodes[0]?.exit).toEqual({ kind: "auto", routes: [{ target: null }] });
  });

  it("connects world experiences into the same story-flow graph in both directions", () => {
    let content = createClipNode(draft(), { nodeId: "clip:a", clipKey: "A" }).content;
    content = createWorldNode(content, { nodeId: "world:a" }).content;
    content = createClipNode(content, { nodeId: "clip:b", clipKey: "B" }).content;

    content = connectSceneContinuation(content, "clip:a", "world:a");
    content = connectSceneContinuation(content, "world:a", "clip:b");

    expect(content.graph.nodes.find((node) => node.nodeId === "clip:a")?.exit).toEqual({
      kind: "auto",
      routes: [{ target: { kind: "node", nodeId: "world:a" } }],
    });
    expect(content.graph.nodes.find((node) => node.nodeId === "world:a")?.exit).toEqual({
      kind: "auto",
      routes: [{ target: { kind: "node", nodeId: "clip:b" } }],
    });
  });

  it("authors ordered choices", () => {
    let content = createClipNode(draft(), { nodeId: "clip:a", clipKey: "A" }).content;
    content = createClipNode(content, { nodeId: "clip:b", clipKey: "B" }).content;
    content = createClipNode(content, { nodeId: "clip:c", clipKey: "C" }).content;
    content = createDecisionNode(content, "en-US", { nodeId: "decision:a", labels: [] }).content;
    content = updateChoiceExitPrompt(content, "decision:a", "en-US", "Choose a path.");
    content = addChoiceOption(content, "decision:a", "clip:b", "en-US", {
      choiceId: "left",
      label: "Left",
    }).content;
    content = addChoiceOption(content, "decision:a", "clip:c", "en-US", {
      choiceId: "right",
      label: "Right",
    }).content;
    content = moveChoiceOption(content, "decision:a", "right", "up");
    const exit = content.graph.nodes.find((node) => node.nodeId === "decision:a")?.exit;
    expect(exit?.kind === "choice" ? exit.choices.map((choice) => choice.choiceId) : []).toEqual([
      "right",
      "left",
    ]);
  });

  it("registers bible variables and endings, then strips dangling refs on delete", () => {
    let content = createClipNode(draft(), { nodeId: "clip:a", clipKey: "A" }).content;
    content = createDecisionNode(content, "en-US", {
      nodeId: "decision:a",
      labels: ["Stay"],
    }).content;
    content = putStoryStateVariable(content, {
      key: "favorability.lin",
      name: { "en-US": "Lin" },
      valueType: "number",
      initialValue: 0,
      minimum: 0,
      maximum: 100,
    });
    content = putStoryEnding(content, {
      endingId: "ending:true-love",
      title: { "en-US": "True love" },
      kind: "success",
    });
    content = setNodeOnEnterEffects(content, "clip:a", [
      { kind: "add", key: "favorability.lin", amount: 1 },
    ]);
    content = setAutoRoutes(content, "clip:a", [
      {
        when: {
          kind: "compare",
          variableKey: "favorability.lin",
          operator: "at-least",
          value: 80,
        },
        target: { kind: "ending", endingId: "ending:true-love" },
      },
      { target: { kind: "node", nodeId: "decision:a" } },
    ]);
    content = updateChoiceStats(content, "decision:a", "option:1", {
      effects: [{ kind: "add", key: "favorability.lin", amount: 10 }],
      visibleWhen: {
        kind: "compare",
        variableKey: "favorability.lin",
        operator: "greater-than",
        value: 0,
      },
      target: { kind: "ending", endingId: "ending:true-love" },
    });

    content = removeStoryStateVariable(content, "favorability.lin");
    const clip = content.graph.nodes.find((node) => node.nodeId === "clip:a");
    const decision = content.graph.nodes.find((node) => node.nodeId === "decision:a");
    expect(clip?.onEnterEffects).toBeUndefined();
    expect(clip?.exit).toEqual({
      kind: "auto",
      routes: [{ target: { kind: "node", nodeId: "decision:a" } }],
    });
    expect(decision?.exit.kind === "choice" ? decision.exit.choices[0] : null).toMatchObject({
      choiceId: "option:1",
      target: { kind: "ending", endingId: "ending:true-love" },
    });
    expect(
      decision?.exit.kind === "choice" ? decision.exit.choices[0]?.effects : undefined
    ).toBeUndefined();
    expect(
      decision?.exit.kind === "choice" ? decision.exit.choices[0]?.visibleWhen : undefined
    ).toBeUndefined();

    content = removeStoryEnding(content, "ending:true-love");
    const after = content.graph.nodes.find((node) => node.nodeId === "decision:a");
    expect(after?.exit.kind === "choice" ? after.exit.choices[0]?.target : "missing").toBeNull();
  });

  it("applies a bible patch by upserting variables and stripping removed keys", () => {
    let content = createClipNode(draft(), { nodeId: "clip:a", clipKey: "A" }).content;
    content = putStoryStateVariable(content, {
      key: "gold",
      name: { "en-US": "Gold" },
      valueType: "number",
      initialValue: 0,
    });
    content = setNodeOnEnterEffects(content, "clip:a", [{ kind: "add", key: "gold", amount: 1 }]);
    content = applyStoryBiblePatch(content, {
      logline: "A heist",
      stateVariables: [
        { key: "courage", name: { "en-US": "Courage" }, valueType: "number", initialValue: 1 },
      ],
    });
    expect(content.storyBible.logline).toBe("A heist");
    expect(content.storyBible.stateVariables?.map((variable) => variable.key)).toEqual(["courage"]);
    expect(content.graph.nodes[0]?.onEnterEffects).toBeUndefined();
  });
});

function draft(): InteractiveStoryDraftContent {
  return {
    storyBible: { logline: "", synopsis: "", characters: [] },
    graph: { entryNodeId: null, nodes: [] },
    productionNotes: [],
  };
}
