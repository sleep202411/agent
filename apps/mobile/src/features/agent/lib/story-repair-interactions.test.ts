import { expect, it } from "vitest";
import {
  newRepairInteraction,
  readRepairInteractions,
  replaceRepairInteractions,
  compileRepairInteractions,
  repairInteractionsSchema,
} from "./story-repair-interactions";
const item = newRepairInteraction("one", "zh-CN", "en-US");
const content = {
  storyBible: {
    stateVariables: [
      { key: "ready", valueType: "boolean", initialValue: false, name: { "en-US": "Ready" } },
    ],
  },
  graph: {
    entryNodeId: "a",
    nodes: [
      {
        kind: "clip",
        nodeId: "a",
        interactions: [item],
        exit: { kind: "auto", routes: [{ target: null }] },
      },
      { kind: "clip", nodeId: "b", interactions: [] },
    ],
  },
};
it("preserves locales and compiles unfinished numeric drafts only on Apply", () => {
  expect(item.label).toEqual({ "en-US": "", "zh-CN": "" });
  expect(() => compileRepairInteractions([{ ...item, startMs: "-" }])).toThrow();
  const next = compileRepairInteractions([
    {
      ...item,
      startMs: "100",
      endMs: "800",
      branchAtMs: "",
      rect: { x: "0.1", y: "0.2", width: "0.3", height: "0.4" },
      trigger: { kind: "press-hold", durationMs: "500", controlTimeline: true },
      outcomes: { success: { kind: "seek", timeMs: "900" } },
    },
  ]);
  expect(next[0]).toMatchObject({
    startMs: 100,
    endMs: 800,
    rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    trigger: { durationMs: 500, controlTimeline: true },
    outcomes: { success: { timeMs: 900 } },
  });
  expect(next[0].branchAtMs).toBeUndefined();
});
it("enforces rectangle, time, gesture, action and count contracts", () => {
  for (const patch of [
    { rect: { x: 0.8, y: 0, width: 0.5, height: 0.5 } },
    { endMs: 0 },
    { startMs: 1000 },
    { branchAtMs: 500 },
    { trigger: { kind: "press-hold", durationMs: 299 } },
    { outcomes: { success: { kind: "seek", timeMs: -1 } } },
  ])
    expect(() => repairInteractionsSchema.parse([{ ...item, ...patch }])).toThrow();
  expect(() => repairInteractionsSchema.parse([item, item])).toThrow();
  expect(() =>
    repairInteractionsSchema.parse(
      Array.from({ length: 101 }, (_, i) => ({ ...item, interactionId: `item:${i}` }))
    )
  ).toThrow();
});
it("rejects stale edits, missing targets, invalid state effects and cross-scene duplicate IDs", () => {
  expect(() => replaceRepairInteractions(content, "a", [], [item])).toThrow("changed");
  expect(() =>
    replaceRepairInteractions(
      content,
      "a",
      [item],
      [
        {
          ...item,
          outcomes: { success: { kind: "goto", target: { kind: "node", nodeId: "missing" } } },
        },
      ]
    )
  ).toThrow("destination");
  expect(() =>
    replaceRepairInteractions(
      content,
      "a",
      [item],
      [
        {
          ...item,
          outcomes: {
            success: { kind: "continue", effects: [{ kind: "add", key: "ready", amount: 1 }] },
          },
        },
      ]
    )
  ).toThrow();
  expect(() => replaceRepairInteractions(content, "b", [], [item])).toThrow("already used");
});
it("updates only the selected scene and preserves authored outcome effects", () => {
  const next = replaceRepairInteractions(content, "a", readRepairInteractions(content, "a"), [
    {
      ...item,
      label: { ...item.label, "en-US": "Touch" },
      outcomes: {
        success: {
          kind: "goto",
          target: { kind: "node", nodeId: "b" },
          effects: [{ kind: "set", key: "ready", value: true }],
        },
      },
    },
  ]);
  expect(next.graph.nodes[1]).toBe(content.graph.nodes[1]);
  expect(next.storyBible).toBe(content.storyBible);
  expect(readRepairInteractions(next, "a")[0]).toMatchObject({
    label: { "en-US": "Touch", "zh-CN": "" },
    outcomes: { success: { effects: [{ kind: "set", key: "ready", value: true }] } },
  });
  expect(content.graph.nodes[0].interactions[0]).toBe(item);
});

it("enforces official localized label keys without silently rewriting translations", () => {
  expect(() => repairInteractionsSchema.parse([{ ...item, label: { x: "Bad locale" } }])).toThrow();
  expect(() => newRepairInteraction("two", "en-US", "")).toThrow();
});
