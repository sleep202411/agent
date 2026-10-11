import { expect, it } from "vitest";
import {
  allocateRepairVariableKey,
  readRepairVariables,
  replaceRepairVariables,
} from "./story-repair-variables";
const variable = {
  key: "state_1",
  name: { "en-US": "Score", "zh-CN": "分数" },
  valueType: "number" as const,
  initialValue: 0,
  note: "Keep",
};
const content = {
  storyBible: { logline: "Keep", stateVariables: [variable] },
  graph: {
    entryNodeId: null,
    nodes: [
      {
        kind: "clip",
        nodeId: "clip:a",
        interactions: [],
        exit: { kind: "auto", routes: [{ target: null }] },
        onEnterEffects: [{ kind: "add", key: "state_1", amount: 1 }],
      },
    ],
  },
};
it("preserves graph references, localized names and stable keys when applying edits", () => {
  const next = replaceRepairVariables(
    content,
    [variable],
    [{ ...variable, initialValue: -2.5 }],
    "en-US"
  );
  expect(next.graph).toBe(content.graph);
  expect(readRepairVariables(next)[0]).toEqual({ ...variable, initialValue: -2.5 });
  expect((next.storyBible as typeof content.storyBible).logline).toBe("Keep");
});
it("allocates distinct keys and rejects duplicate or unsafe keys", () => {
  expect(allocateRepairVariableKey([{ key: "state_1" }, { key: "state_3" }])).toBe("state_2");
  expect(() =>
    replaceRepairVariables(content, [variable], [variable, variable], "en-US")
  ).toThrow();
  expect(() =>
    replaceRepairVariables(content, [variable], [{ ...variable, key: "__proto__" }], "en-US")
  ).toThrow();
});
it("enforces official count, type and default-language constraints", () => {
  expect(() =>
    replaceRepairVariables(
      content,
      [variable],
      Array.from({ length: 65 }, (_, i) => ({ ...variable, key: `state_${i}` })),
      "en-US"
    )
  ).toThrow();
  expect(() =>
    replaceRepairVariables(content, [variable], [{ ...variable, valueType: "boolean" }], "en-US")
  ).toThrow();
  expect(() =>
    replaceRepairVariables(
      content,
      [variable],
      [{ ...variable, name: { "zh-CN": "分数" } }],
      "en-US"
    )
  ).toThrow();
});
it("rejects stale edits and removes references during explicit deletion", () => {
  expect(() => replaceRepairVariables(content, [], [], "en-US")).toThrow();
  const next = replaceRepairVariables(content, [variable], [], "en-US");
  expect(readRepairVariables(next)).toEqual([]);
  expect(next.graph.nodes[0]).not.toHaveProperty("onEnterEffects");
  expect(content.graph.nodes[0].onEnterEffects).toHaveLength(1);
});
