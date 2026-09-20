import { describe, expect, it } from "vitest";
import {
  StoryConditionSchema,
  StoryStateEffectSchema,
  compileStoryCondition,
  compileStoryEffects,
  measureStoryCondition,
  migrateStoryDraftStats,
  migrateStoryExit,
  migrateStoryReleaseStats,
  storyAutoExit,
  storyConditionTypeError,
  storyEffectTypeError,
  storyNodeTarget,
} from "./story-stats.js";

describe("story stats grammar", () => {
  it("compiles set/add effects and compare conditions into the runtime state machine", () => {
    expect(compileStoryEffects([{ kind: "add", key: "favorability.lin", amount: 10 }])).toEqual([
      {
        kind: "state.increment",
        path: "favorability.lin",
        amount: { kind: "literal", value: 10 },
      },
    ]);
    expect(
      compileStoryCondition({
        kind: "compare",
        variableKey: "favorability.lin",
        operator: "at-least",
        value: 80,
      })
    ).toEqual({
      kind: "compare",
      left: { kind: "state", path: "favorability.lin" },
      operator: "at-least",
      right: { kind: "literal", value: 80 },
    });
  });

  it("rejects boolean ordering and add-on-boolean at the type gate", () => {
    const variables = new Map(
      [{ key: "met.lin", valueType: "boolean" as const }].map((row) => [row.key, row])
    );
    expect(
      storyConditionTypeError(
        { kind: "compare", variableKey: "met.lin", operator: "at-least", value: 1 },
        variables
      )
    ).toMatch(/number variable/);
    expect(storyEffectTypeError({ kind: "add", key: "met.lin", amount: 1 }, variables)).toMatch(
      /number variable/
    );
    expect(StoryStateEffectSchema.safeParse({ kind: "add", key: "gold", amount: -5 }).success).toBe(
      true
    );
  });

  it("measures condition depth from the root", () => {
    const nested = StoryConditionSchema.parse({
      kind: "not",
      condition: {
        kind: "all",
        conditions: [
          { kind: "compare", variableKey: "gold", operator: "at-least", value: 1 },
          { kind: "compare", variableKey: "met.lin", operator: "equals", value: true },
        ],
      },
    });
    expect(measureStoryCondition(nested)).toEqual({ depth: 3, leaves: 2 });
  });

  it("migrates nextNodeId auto/choice exits and goto.nodeId", () => {
    expect(migrateStoryExit({ kind: "auto", nextNodeId: "inside" })).toEqual({
      kind: "auto",
      routes: [{ target: { kind: "node", nodeId: "inside" } }],
    });
    expect(migrateStoryExit({ kind: "auto", nextNodeId: null })).toEqual(storyAutoExit(null));
    const draft = migrateStoryDraftStats({
      storyBible: { logline: "", synopsis: "", characters: [] },
      graph: {
        entryNodeId: "a",
        nodes: [
          {
            kind: "clip",
            nodeId: "a",
            clipKey: "A",
            interactions: [
              {
                kind: "hotspot",
                interactionId: "tap",
                outcomes: { success: { kind: "goto", nodeId: "b" } },
              },
            ],
            exit: {
              kind: "choice",
              decisionId: "d",
              prompt: {},
              choices: [{ choiceId: "go", label: {}, nextNodeId: "b" }],
            },
          },
        ],
      },
      productionNotes: [],
    }) as {
      graph: {
        nodes: Array<{
          exit: { choices: Array<{ target: unknown }> };
          interactions: Array<{ outcomes: { success: unknown } }>;
        }>;
      };
    };
    expect(draft.graph.nodes[0]?.exit.choices[0]?.target).toEqual(storyNodeTarget("b"));
    expect(draft.graph.nodes[0]?.interactions[0]?.outcomes.success).toEqual({
      kind: "goto",
      target: { kind: "node", nodeId: "b" },
    });
  });

  it("removes retired numeric display bounds from stored drafts and releases", () => {
    const variable = {
      key: "gold",
      name: { "en-US": "Gold" },
      valueType: "number",
      initialValue: 0,
      minimum: 10,
      maximum: 5,
    };
    const draft = migrateStoryDraftStats({
      storyBible: { stateVariables: [variable] },
      graph: { nodes: [] },
    }) as { storyBible: { stateVariables: unknown[] } };
    const release = migrateStoryReleaseStats({
      stateVariables: [variable],
      nodes: [],
    }) as { stateVariables: unknown[] };
    const expected = {
      key: "gold",
      name: { "en-US": "Gold" },
      valueType: "number",
      initialValue: 0,
    };
    expect(draft.storyBible.stateVariables).toEqual([expected]);
    expect(release.stateVariables).toEqual([expected]);
    expect(variable.minimum).toBe(10);
  });
});
