import { expect, it } from "vitest";
import { removeRepairVariableReferences } from "./story-repair-variable-references";
import type { RepairContent } from "./story-repair-fields";
const compare = (variableKey: string) => ({
  kind: "compare",
  variableKey,
  operator: "equals",
  value: 1,
});
const effects = [
  { kind: "add", key: "gone", amount: 2 },
  { kind: "add", key: "keep", amount: 3 },
];
it("cleans all effect locations and nested conditions while preserving destinations and order", () => {
  const content: RepairContent = {
    storyBible: { logline: "Keep" },
    graph: {
      entryNodeId: "a",
      nodes: [
        {
          kind: "clip",
          nodeId: "a",
          onEnterEffects: effects,
          interactions: [
            {
              interactionId: "tap",
              outcomes: {
                success: { kind: "continue", effects },
                failure: { kind: "goto", target: { kind: "node", nodeId: "b" }, effects },
                timeout: { kind: "continue", effects: [effects[0]] },
              },
            },
          ],
          exit: {
            kind: "auto",
            routes: [
              {
                when: { kind: "not", condition: compare("gone") },
                target: { kind: "node", nodeId: "b" },
              },
              {
                when: { kind: "all", conditions: [compare("gone"), compare("keep")] },
                target: { kind: "node", nodeId: "c" },
              },
              { target: null },
            ],
          },
        },
        {
          kind: "decision",
          nodeId: "b",
          exit: {
            kind: "choice",
            choices: [
              {
                choiceId: "one",
                label: { "en-US": "One" },
                target: null,
                effects,
                visibleWhen: compare("gone"),
              },
              {
                choiceId: "two",
                target: null,
                visibleWhen: {
                  kind: "any",
                  conditions: [compare("gone"), { kind: "not", condition: compare("keep") }],
                },
              },
            ],
          },
        },
      ],
    },
  };
  const before = JSON.stringify(content);
  const next = removeRepairVariableReferences(content, new Set(["gone"]));
  expect(next.graph.nodes[0]).toMatchObject({
    onEnterEffects: [effects[1]],
    exit: {
      routes: [{ when: compare("keep"), target: { kind: "node", nodeId: "c" } }, { target: null }],
    },
    interactions: [
      {
        outcomes: {
          success: { kind: "continue", effects: [effects[1]] },
          failure: { kind: "goto", target: { kind: "node", nodeId: "b" }, effects: [effects[1]] },
          timeout: { kind: "continue" },
        },
      },
    ],
  });
  const choices = (next.graph.nodes[1].exit as { choices: Record<string, unknown>[] }).choices;
  expect(choices[0]).not.toHaveProperty("visibleWhen");
  expect(choices[0].effects).toEqual([effects[1]]);
  expect(choices[1].visibleWhen).toEqual({ kind: "not", condition: compare("keep") });
  expect(JSON.stringify(next)).not.toContain('"gone"');
  expect(JSON.stringify(content)).toBe(before);
  expect(next.storyBible).toBe(content.storyBible);
});
it("rejects unreadable conditions without modifying the original", () => {
  const content: RepairContent = {
    graph: {
      entryNodeId: null,
      nodes: [
        { nodeId: "a", exit: { kind: "auto", routes: [{ when: { broken: true }, target: null }] } },
      ],
    },
  };
  expect(() => removeRepairVariableReferences(content, new Set(["gone"]))).toThrow();
  expect(removeRepairVariableReferences(content, new Set())).toBe(content);
});
