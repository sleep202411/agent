import { expect, it } from "vitest";
import { duplicateRepairNodes } from "./story-repair-duplicate";
import type { RepairContent } from "./story-repair-fields";
const allocator = () => {
  let i = 0;
  return () => `00000000-0000-4000-8000-${String(++i).padStart(12, "0")}`;
};
const target = (nodeId: string) => ({ kind: "node", nodeId }),
  ending = { kind: "ending", endingId: "end" };
const effects = [{ kind: "add", key: "score", amount: 1 }];
const content: RepairContent = {
  storyBible: { logline: "Keep", endings: [{ endingId: "end" }] },
  graph: {
    entryNodeId: "a",
    nodes: [
      {
        kind: "clip",
        nodeId: "a",
        clipKey: "SCENE_A",
        name: "Opening",
        description: "Keep",
        communityPointPrice: 3,
        onEnterEffects: effects,
        interactions: [
          {
            interactionId: "hotspot:a",
            label: { "en-US": "Touch", "zh-CN": "点击" },
            outcomes: {
              success: { kind: "goto", target: target("b") },
              failure: { kind: "goto", target: target("c"), effects },
              timeout: { kind: "goto", target: ending },
            },
          },
        ],
        exit: {
          kind: "auto",
          routes: [
            {
              when: { kind: "compare", variableKey: "score", operator: "equals", value: 1 },
              target: target("c"),
            },
            { target: target("b") },
          ],
        },
      },
      {
        kind: "decision",
        nodeId: "b",
        onEnterEffects: effects,
        exit: {
          kind: "choice",
          decisionId: "decision:b",
          prompt: { "en-US": "Choose", "zh-CN": "选择" },
          choices: [
            { choiceId: "one", label: { "en-US": "A" }, effects, target: target("a") },
            { choiceId: "two", target: target("c") },
            { choiceId: "three", target: ending },
          ],
        },
      },
      {
        kind: "clip",
        nodeId: "c",
        clipKey: "SCENE_C",
        interactions: [],
        exit: { kind: "auto", routes: [{ target: null }] },
      },
    ],
  },
};
it("copies internal topology with fresh identities and drops external node links", () => {
  const before = JSON.stringify(content);
  const next = duplicateRepairNodes(
    content,
    [
      { nodeId: "a", role: "node" },
      { nodeId: "b", role: "node" },
    ],
    allocator()
  );
  const [a, b] = next.created;
  expect(next.content.graph.entryNodeId).toBe("a");
  expect(next.content.graph.nodes).toHaveLength(5);
  const ca = next.content.graph.nodes[3],
    cb = next.content.graph.nodes[4];
  expect(ca).toMatchObject({
    kind: "clip",
    name: "Opening",
    description: "Keep",
    communityPointPrice: 3,
    onEnterEffects: effects,
    exit: { kind: "auto", routes: [{ target: target(b) }] },
    interactions: [
      {
        label: { "en-US": "Touch", "zh-CN": "点击" },
        outcomes: {
          success: { kind: "goto", target: target(b) },
          failure: { kind: "continue", effects },
          timeout: { kind: "goto", target: ending },
        },
      },
    ],
  });
  expect(ca.clipKey).not.toBe("SCENE_A");
  expect((ca.interactions as { interactionId: string }[])[0].interactionId).not.toBe("hotspot:a");
  expect(cb.exit).toMatchObject({
    prompt: { "en-US": "Choose", "zh-CN": "选择" },
    choices: [
      { choiceId: "one", effects, target: target(a) },
      { choiceId: "two", target: null },
      { choiceId: "three", target: ending },
    ],
  });
  expect((cb.exit as { decisionId: string }).decisionId).not.toBe("decision:b");
  expect(next.content.storyBible).toBe(content.storyBible);
  expect(JSON.stringify(content)).toBe(before);
  expect(ca.onEnterEffects).not.toBe(effects);
});
it("duplicates attached choices independently and includes them only once with their scene", () => {
  const attached: RepairContent = {
    ...content,
    graph: {
      ...content.graph,
      nodes: [
        { ...content.graph.nodes[0], exit: content.graph.nodes[1].exit },
        content.graph.nodes[2],
      ],
    },
  };
  const result = duplicateRepairNodes(
    attached,
    [{ nodeId: "a", role: "choice-exit" }],
    allocator()
  );
  expect(result.content.graph.nodes.at(-1)).toMatchObject({
    kind: "decision",
    onEnterEffects: effects,
  });
  const both = duplicateRepairNodes(
    attached,
    [
      { nodeId: "a", role: "node" },
      { nodeId: "a", role: "choice-exit" },
      { nodeId: "a", role: "node" },
    ],
    allocator()
  );
  expect(both.created).toHaveLength(1);
  expect(both.content.graph.nodes.at(-1)?.kind).toBe("clip");
});
it("clears external fallback links and rejects stale selections, collisions and excessive copies", () => {
  const result = duplicateRepairNodes(content, [{ nodeId: "c", role: "node" }], allocator());
  expect(result.content.graph.nodes.at(-1)?.exit).toEqual({
    kind: "auto",
    routes: [{ target: null }],
  });
  expect(() =>
    duplicateRepairNodes(content, [{ nodeId: "missing", role: "node" }], allocator())
  ).toThrow("no longer available");
  expect(() =>
    duplicateRepairNodes(
      content,
      [
        { nodeId: "a", role: "node" },
        { nodeId: "c", role: "node" },
      ],
      () => "00000000-0000-4000-8000-000000000001"
    )
  ).toThrow("already exists");
  expect(() =>
    duplicateRepairNodes(
      {
        ...content,
        graph: {
          ...content.graph,
          nodes: Array.from({ length: 10000 }, () => content.graph.nodes[0]),
        },
      },
      [{ nodeId: "a", role: "node" }],
      allocator()
    )
  ).toThrow("10,000");
});
