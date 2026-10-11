import { expect, it } from "vitest";
import {
  createRepairEnding,
  removeRepairEnding,
  renameRepairEnding,
  repairEndings,
} from "./story-repair-endings";
const content = {
  storyBible: { logline: "Keep", endings: [] },
  graph: {
    entryNodeId: "clip:a",
    nodes: [
      {
        nodeId: "clip:a",
        exit: {
          kind: "choice",
          prompt: { "en-US": "Choose" },
          choices: [
            {
              choiceId: "choice:a",
              label: { "en-US": "Yes" },
              effects: [{ kind: "set", key: "score", value: 1 }],
              target: null,
            },
          ],
        },
      },
    ],
  },
};
it("creates and connects an ending atomically with the project's default language", () => {
  const next = createRepairEnding(content, "clip:a", 0, "zh-CN", "en-US", "Finale");
  expect(repairEndings(next)).toEqual([
    { endingId: "ending:1", kind: "neutral", title: { "en-US": "Finale", "zh-CN": "Finale" } },
  ]);
  expect(next.graph.nodes[0].exit).toMatchObject({
    choices: [
      {
        target: { kind: "ending", endingId: "ending:1" },
        effects: [{ kind: "set", key: "score", value: 1 }],
      },
    ],
  });
  expect(() => createRepairEnding(content, "clip:a", 9, "en-US", "en-US", "Finale")).toThrow();
  expect(content.storyBible.endings).toEqual([]);
});
it("preserves translations, IDs and ending kinds while renaming", () => {
  const first = createRepairEnding(content, "clip:a", 0, "zh-CN", "en-US", "Finale");
  const next = renameRepairEnding(first, "ending:1", "zh-CN", "结局");
  expect(repairEndings(next)[0]).toEqual({
    endingId: "ending:1",
    kind: "neutral",
    title: { "en-US": "Finale", "zh-CN": "结局" },
  });
  expect(next.graph).toBe(first.graph);
});
it("removes an ending from all branches without losing conditions or effects", () => {
  const first = createRepairEnding(content, "clip:a", 0, "en-US", "en-US", "Finale");
  const extended = {
    ...first,
    graph: {
      ...first.graph,
      nodes: [
        ...first.graph.nodes,
        {
          nodeId: "clip:b",
          exit: {
            kind: "auto",
            routes: [
              {
                when: { kind: "compare", variableKey: "score", operator: "equals", value: 1 },
                target: { kind: "ending", endingId: "ending:1" },
              },
              { target: null },
            ],
          },
        },
      ],
    },
  };
  const next = removeRepairEnding(extended, "ending:1");
  expect(repairEndings(next)).toEqual([]);
  expect(next.graph.nodes[0].exit).toMatchObject({
    choices: [{ target: null, effects: [{ kind: "set", key: "score", value: 1 }] }],
  });
  expect(next.graph.nodes[1].exit).toMatchObject({
    routes: [{ when: { variableKey: "score" }, target: null }, { target: null }],
  });
});
it("rejects stale and interaction-referenced removal without mutating content", () => {
  const first = createRepairEnding(content, "clip:a", 0, "en-US", "en-US", "Finale");
  expect(() => removeRepairEnding(first, "missing")).toThrow();
  const next = {
    ...first,
    graph: {
      ...first.graph,
      nodes: [
        {
          ...first.graph.nodes[0],
          interactions: [
            {
              outcomes: {
                success: { kind: "goto", target: { kind: "ending", endingId: "ending:1" } },
              },
            },
          ],
        },
      ],
    },
  };
  expect(() => removeRepairEnding(next, "ending:1")).toThrow("interaction");
  expect(repairEndings(next)).toHaveLength(1);
});
it("enforces the 64-ending limit and uses unique IDs", () => {
  const first = createRepairEnding(content, "clip:a", 0, "en-US", "en-US", "First");
  expect(
    repairEndings(createRepairEnding(first, "clip:a", 0, "en-US", "en-US", "Second"))[1].endingId
  ).toBe("ending:2");
  const full = {
    ...content,
    storyBible: {
      ...content.storyBible,
      endings: Array.from({ length: 64 }, (_, i) => ({
        endingId: `ending:${i}`,
        kind: "neutral",
        title: { "en-US": "End" },
      })),
    },
  };
  expect(() => createRepairEnding(full, "clip:a", 0, "en-US", "en-US", "End")).toThrow("64");
});
