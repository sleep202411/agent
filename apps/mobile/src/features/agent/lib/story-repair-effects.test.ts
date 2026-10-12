import { expect, it } from "vitest";
import { repairEffects, replaceRepairEffects } from "./story-repair-effects";
const content = {
  storyBible: {
    stateVariables: [
      { key: "score", valueType: "number" },
      { key: "ready", valueType: "boolean" },
    ],
  },
  graph: {
    entryNodeId: "scene:a",
    nodes: [
      {
        nodeId: "scene:a",
        onEnterEffects: [],
        extra: "keep",
        exit: {
          kind: "choice",
          decisionId: "decision:a",
          prompt: { "en-US": "Choose" },
          choices: [
            {
              choiceId: "choice:a",
              label: { "en-US": "Yes" },
              target: null,
              visibleWhen: {
                kind: "compare",
                variableKey: "ready",
                operator: "equals",
                value: true,
              },
              effects: [],
            },
          ],
        },
      },
    ],
  },
};
it("changes scene and choice effects independently while preserving graph and conditions", () => {
  const scene = { nodeId: "scene:a" };
  const choice = { ...scene, choiceId: "choice:a" };
  const first = replaceRepairEffects(
    content,
    scene,
    [],
    [{ kind: "add", key: "score", amount: -2.5 }]
  );
  const second = replaceRepairEffects(
    first,
    choice,
    [],
    [{ kind: "set", key: "ready", value: true }]
  );
  expect(repairEffects(second, scene)).toEqual([{ kind: "add", key: "score", amount: -2.5 }]);
  expect(repairEffects(second, choice)).toEqual([{ kind: "set", key: "ready", value: true }]);
  expect(second.graph.nodes[0].extra).toBe("keep");
  expect(
    (second.graph.nodes[0].exit as (typeof content.graph.nodes)[number]["exit"]).choices[0]
      .visibleWhen
  ).toEqual(content.graph.nodes[0].exit.choices[0].visibleWhen);
  expect(repairEffects(content, scene)).toEqual([]);
});
it.each(
  [
    [{ kind: "add", key: "ready", amount: 1 }],
    [{ kind: "set", key: "score", value: true }],
    [{ kind: "set", key: "missing", value: 0 }],
    Array(7).fill({ kind: "set", key: "score", value: 0 }),
  ].map((effects) => [effects])
)("rejects invalid state changes %j", (effects) => {
  expect(() => replaceRepairEffects(content, { nodeId: "scene:a" }, [], effects)).toThrow();
});
it("rejects stale or removed targets and supports explicit empty effects", () => {
  expect(() =>
    replaceRepairEffects(
      content,
      { nodeId: "scene:a" },
      [{ kind: "set", key: "score", value: 1 }],
      []
    )
  ).toThrow();
  expect(() => replaceRepairEffects(content, { nodeId: "missing" }, undefined, [])).toThrow();
  expect(() =>
    replaceRepairEffects(content, { nodeId: "scene:a", choiceId: "removed" }, undefined, [])
  ).toThrow();
  expect(
    repairEffects(replaceRepairEffects(content, { nodeId: "scene:a" }, [], []), {
      nodeId: "scene:a",
    })
  ).toEqual([]);
});
