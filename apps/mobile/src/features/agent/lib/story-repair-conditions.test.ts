import { expect, it } from "vitest";
import {
  buildRepairCondition,
  addRepairAutoRoute,
  repairAutoRoutes,
  replaceRepairAutoCondition,
  flattenRepairCondition,
  moveRepairAutoRoute,
  repairVariables,
  replaceChoiceCondition,
  replaceRepairAutoRoutes,
  validateRepairCondition,
} from "./story-repair-conditions";
import type { StoryCondition, StoryExitRoute } from "@repo/shared/story-stats";
const compare = { kind: "compare", variableKey: "score", operator: "at-least", value: 5 } as const;
const content = {
  storyBible: {
    stateVariables: [
      { key: "score", valueType: "number", name: { "en-US": "Score" } },
      { key: "ready", valueType: "boolean", name: { "en-US": "Ready" } },
    ],
    endings: [{ endingId: "end" }],
  },
  graph: {
    entryNodeId: "clip:a",
    nodes: [
      {
        nodeId: "clip:a",
        kind: "clip",
        interactions: [{ keep: true }],
        exit: {
          kind: "choice",
          choices: [
            {
              choiceId: "one",
              label: { "en-US": "One" },
              target: { kind: "node", nodeId: "clip:b" },
              effects: [{ kind: "add", key: "score", amount: 1 }],
            },
            { choiceId: "two", label: { "en-US": "Two" }, target: null },
          ],
        },
      },
      { nodeId: "clip:b", kind: "clip", exit: { kind: "auto", routes: [{ target: null }] } },
    ],
  },
};
it("uses official variable types and preserves localized names", () => {
  expect(repairVariables(content, "en-US")).toEqual([
    { key: "score", valueType: "number", label: "Score" },
    { key: "ready", valueType: "boolean", label: "Ready" },
  ]);
  expect(validateRepairCondition(content, compare)).toEqual(compare);
  expect(() => validateRepairCondition(content, { ...compare, variableKey: "gone" })).toThrow(
    "Unknown variable"
  );
  expect(() => validateRepairCondition(content, { ...compare, variableKey: "ready" })).toThrow(
    "requires a number"
  );
  expect(() => validateRepairCondition(content, { ...compare, value: true })).toThrow(
    "must match number"
  );
});
it("round trips flat groups and negation without flattening mixed nested conditions", () => {
  const condition: StoryCondition = {
    kind: "not",
    condition: { kind: "any", conditions: [compare, { ...compare, value: 10 }] },
  };
  expect(buildRepairCondition(content, flattenRepairCondition(condition)!)).toEqual(condition);
  expect(
    flattenRepairCondition({
      kind: "all",
      conditions: [compare, { kind: "not", condition: compare }],
    })
  ).toBeNull();
  expect(flattenRepairCondition({ malformed: true })).toBeNull();
  expect(
    buildRepairCondition(content, { combinator: "all", negated: false, compares: [] })
  ).toBeUndefined();
});
it("rejects over-deep conditions and excessive comparisons", () => {
  expect(() =>
    validateRepairCondition(content, {
      kind: "not",
      condition: { kind: "not", condition: { kind: "not", condition: compare } },
    })
  ).toThrow("three levels");
  expect(() =>
    buildRepairCondition(content, {
      combinator: "all",
      negated: false,
      compares: Array(13).fill(compare),
    })
  ).toThrow();
});
it("changes only the requested visibility condition and removes it explicitly", () => {
  const next = replaceChoiceCondition(content, "clip:a", "one", compare);
  const exit = next.graph.nodes[0].exit as { choices: Record<string, unknown>[] };
  expect(exit.choices[0]).toEqual({
    ...content.graph.nodes[0].exit.choices![0],
    visibleWhen: compare,
  });
  expect(exit.choices[1]).toBe(content.graph.nodes[0].exit.choices![1]);
  expect(next.graph.nodes[1]).toBe(content.graph.nodes[1]);
  const removed = replaceChoiceCondition(next, "clip:a", "one", undefined);
  expect(removed).toEqual(content);
  expect(() => replaceChoiceCondition(content, "clip:a", "gone", compare)).toThrow();
});
it("requires a single last fallback and preserves explicit route priority", () => {
  const routes: StoryExitRoute[] = [
    { when: compare, target: { kind: "node", nodeId: "clip:a" } },
    { when: { ...compare, value: 10 }, target: { kind: "ending", endingId: "end" } },
    { target: null },
  ];
  const reordered = moveRepairAutoRoute(routes, 0, 1);
  expect(reordered).toEqual([routes[1], routes[0], routes[2]]);
  expect(moveRepairAutoRoute(routes, 2, 0)).toBe(routes);
  expect(moveRepairAutoRoute(routes, 0, 2)).toBe(routes);
  const next = replaceRepairAutoRoutes(content, "clip:b", reordered);
  expect(next.graph.nodes[0]).toBe(content.graph.nodes[0]);
  expect(next.graph.nodes[1].exit).toEqual({ kind: "auto", routes: reordered });
  expect(() => replaceRepairAutoRoutes(content, "clip:b", [routes[2], routes[0]])).toThrow(
    "fallback"
  );
  expect(() => replaceRepairAutoRoutes(content, "clip:b", [routes[2], routes[2]])).toThrow(
    "fallback"
  );
  expect(() => replaceRepairAutoRoutes(content, "clip:b", [routes[0]])).toThrow("fallback");
});
it("rejects invalid route destinations, types, counts and stale nodes without mutating content", () => {
  const original = JSON.stringify(content);
  expect(() =>
    replaceRepairAutoRoutes(content, "clip:b", [{ target: { kind: "node", nodeId: "foreign" } }])
  ).toThrow();
  expect(() =>
    replaceRepairAutoRoutes(content, "clip:b", [
      { target: { kind: "ending", endingId: "foreign" } },
    ])
  ).toThrow();
  expect(() =>
    replaceRepairAutoRoutes(content, "clip:b", [
      { when: { ...compare, value: false }, target: null },
      { target: null },
    ])
  ).toThrow();
  expect(() =>
    replaceRepairAutoRoutes(content, "clip:b", Array(9).fill({ target: null }))
  ).toThrow();
  expect(() => replaceRepairAutoRoutes(content, "clip:a", [{ target: null }])).toThrow();
  expect(() => replaceRepairAutoRoutes(content, "gone", [{ target: null }])).toThrow();
  expect(JSON.stringify(content)).toBe(original);
});
it("adds conditional routes before the fallback and enforces the official limit", () => {
  let next = addRepairAutoRoute(content, "clip:b");
  const routes = repairAutoRoutes(next, "clip:b")!;
  expect(routes).toEqual([{ when: { ...compare, value: 0 }, target: null }, { target: null }]);
  for (let i = 2; i < 8; i++) next = addRepairAutoRoute(next, "clip:b");
  expect(repairAutoRoutes(next, "clip:b")).toHaveLength(8);
  expect(() => addRepairAutoRoute(next, "clip:b")).toThrow("eight routes");
  expect(() => addRepairAutoRoute({ ...content, storyBible: {} }, "clip:b")).toThrow(
    "state variable"
  );
});
it("updates and removes the exact conditional route without changing the fallback", () => {
  const next = addRepairAutoRoute(content, "clip:b");
  const route = repairAutoRoutes(next, "clip:b")![0];
  const updated = replaceRepairAutoCondition(next, "clip:b", 0, route, compare);
  expect(repairAutoRoutes(updated, "clip:b")![0].when).toEqual(compare);
  expect(() => replaceRepairAutoCondition(updated, "clip:b", 0, route, undefined)).toThrow(
    "changed"
  );
  const removed = replaceRepairAutoCondition(
    updated,
    "clip:b",
    0,
    repairAutoRoutes(updated, "clip:b")![0],
    undefined
  );
  expect(repairAutoRoutes(removed, "clip:b")).toEqual([{ target: null }]);
  expect(() => replaceRepairAutoCondition(removed, "clip:b", 0, { target: null }, compare)).toThrow(
    "changed"
  );
});
