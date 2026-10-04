import { expect, it } from "vitest";
import {
  createRepairNode,
  updateRepairNodeText,
  removeRepairAttachedChoice,
} from "./story-repair-nodes";
const id = "11111111-1111-4111-8111-111111111111";
const content = { storyBible: { logline: "Keep" }, graph: { entryNodeId: null, nodes: [] } };
it("creates a canonical scene with a unique stable media key and initial entry", () => {
  const next = createRepairNode(content, "clip", "en-US", "en-US", id);
  expect(next.content.graph.entryNodeId).toBe(next.nodeId);
  expect(next.content.graph.nodes[0]).toEqual({
    kind: "clip",
    nodeId: `clip:${id}`,
    clipKey: "SCENE_11111111111141118111111111111111",
    interactions: [],
    exit: { kind: "auto", routes: [{ target: null }] },
  });
  expect(next.content.storyBible).toBe(content.storyBible);
  expect(content.graph.nodes).toEqual([]);
  expect(() => createRepairNode(next.content, "clip", "en-US", "en-US", id)).toThrow();
});
it("preserves the existing entry and initializes decision copy in both languages", () => {
  const existing = createRepairNode(content, "clip", "en-US", "en-US", id);
  const next = createRepairNode(
    existing.content,
    "decision",
    "zh-CN",
    "en-US",
    "22222222-2222-4222-8222-222222222222",
    ["Yes", "No"]
  );
  expect(next.content.graph.entryNodeId).toBe(existing.nodeId);
  expect(next.content.graph.nodes[1].exit).toMatchObject({
    kind: "choice",
    prompt: { "en-US": "", "zh-CN": "" },
    choices: [
      { label: { "en-US": "Yes", "zh-CN": "Yes" }, target: null },
      { label: { "en-US": "No", "zh-CN": "No" }, target: null },
    ],
  });
});
it("edits scene metadata without changing identity or routes", () => {
  const first = createRepairNode(content, "clip", "en-US", "en-US", id);
  const next = updateRepairNodeText(first.content, first.nodeId, "description", "A quiet opening");
  expect(next.graph.nodes[0]).toEqual({
    ...first.content.graph.nodes[0],
    description: "A quiet opening",
  });
  expect(() => updateRepairNodeText(next, first.nodeId, "name", "x".repeat(121))).toThrow();
  expect(() => updateRepairNodeText(next, "missing", "name", "Name")).toThrow();
});
it("removes attached choices while retaining scene identity, media and effects", () => {
  const original = {
    storyBible: { logline: "Keep", endings: [{ endingId: "old" }, { endingId: "used" }] },
    graph: {
      entryNodeId: "a",
      nodes: [
        {
          kind: "clip",
          nodeId: "a",
          clipKey: "SCENE_A",
          name: "Opening",
          onEnterEffects: [{ kind: "add", key: "score", amount: 1 }],
          interactions: [
            {
              outcomes: { success: { kind: "goto", target: { kind: "ending", endingId: "used" } } },
            },
          ],
          exit: {
            kind: "choice",
            prompt: { "en-US": "Choose" },
            choices: [{ target: { kind: "ending", endingId: "old" } }],
          },
        },
      ],
    },
  };
  const before = JSON.stringify(original);
  const next = removeRepairAttachedChoice(original, "a");
  expect(next.graph.nodes[0]).toEqual({
    ...original.graph.nodes[0],
    exit: { kind: "auto", routes: [{ target: null }] },
  });
  expect(next.graph.entryNodeId).toBe("a");
  expect(next.storyBible).toEqual({ logline: "Keep", endings: [{ endingId: "used" }] });
  expect(JSON.stringify(original)).toBe(before);
  expect(() => removeRepairAttachedChoice(next, "a")).toThrow("no longer has");
  expect(() => removeRepairAttachedChoice(original, "missing")).toThrow();
  expect(() =>
    removeRepairAttachedChoice(
      {
        ...original,
        graph: { ...original.graph, nodes: [{ ...original.graph.nodes[0], kind: "decision" }] },
      },
      "a"
    )
  ).toThrow();
});
