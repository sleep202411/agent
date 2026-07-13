import { describe, expect, it } from "vitest";
import type { InteractiveFilmDraftContent, StoryGraphNode } from "@/lib/story-projects-api";
import {
  addWorldTextItem,
  countCharacterReferences,
  countStateVariableReferences,
  createStoryCharacter,
  createStoryStateVariable,
  deleteStoryCharacter,
  deleteStoryStateVariable,
  removeWorldTextItem,
  replaceStoryStateVariable,
  StoryWorldMutationError,
  type StoryWorldMutationErrorCode,
  type StoryWorldTextField,
  updateStoryCharacter,
  updateWorldTextItem,
} from "./story-world-mutations";

describe("story world mutations", () => {
  it("creates immutable character records with deterministic stable identifiers", () => {
    const original = draft({
      storyBible: {
        characters: [character("character:2")],
      },
    });

    const result = createStoryCharacter(original, { locale: " zh-CN " });

    expect(result.created).toEqual({
      id: "character:2-2",
      name: { "zh-CN": "" },
      role: "",
      summary: "",
      playable: false,
      continuityRules: [],
    });
    expect(result.content.storyBible.characters).toHaveLength(2);
    expect(original.storyBible.characters).toEqual([character("character:2")]);
  });

  it("rejects duplicate, empty, malformed, and over-capacity character creation", () => {
    const content = draft({ storyBible: { characters: [character("hero")] } });

    expectMutationCode(
      () => createStoryCharacter(content, { locale: "en-US", id: "hero" }),
      "DUPLICATE_CHARACTER_ID"
    );
    expectMutationCode(
      () => createStoryCharacter(content, { locale: "en-US", id: "" }),
      "INVALID_STABLE_ID"
    );
    expectMutationCode(() => createStoryCharacter(content, { locale: "x" }), "INVALID_LOCALE");
    expectMutationCode(
      () =>
        createStoryCharacter(
          draft({
            storyBible: {
              characters: Array.from({ length: 100 }, (_, index) =>
                character(`character:${index + 1}`)
              ),
            },
          }),
          { locale: "en-US" }
        ),
      "CHARACTER_LIMIT_REACHED"
    );
  });

  it("updates only mutable character fields without mutating the source", () => {
    const original = draft({ storyBible: { characters: [character("hero"), character("guide")] } });
    const next = updateStoryCharacter(original, "hero", {
      name: { "en-US": "Mira", "zh-CN": "米拉" },
      role: "Lead",
      summary: "Seeks the truth.",
      playable: true,
      continuityRules: ["Keeps the silver key"],
    });

    expect(next.storyBible.characters[0]).toEqual({
      id: "hero",
      name: { "en-US": "Mira", "zh-CN": "米拉" },
      role: "Lead",
      summary: "Seeks the truth.",
      playable: true,
      continuityRules: ["Keeps the silver key"],
    });
    expect(next.storyBible.characters[1]).toBe(original.storyBible.characters[1]);
    expect(original.storyBible.characters[0]).toEqual(character("hero"));
    expect(updateStoryCharacter(next, "hero", {})).toBe(next);
    expectMutationCode(() => updateStoryCharacter(next, "missing", {}), "CHARACTER_NOT_FOUND");
  });

  it("validates every character patch branch and ignores out-of-contract identity fields", () => {
    const content = draft({ storyBible: { characters: [character("hero")] } });

    expectMutationCode(
      () => updateStoryCharacter(content, "hero", { role: "r".repeat(161) }),
      "INVALID_CHARACTER"
    );
    expectMutationCode(
      () => updateStoryCharacter(content, "hero", { summary: "s".repeat(4_001) }),
      "INVALID_CHARACTER"
    );
    expectMutationCode(
      () => updateStoryCharacter(content, "hero", { name: { "en-US": "n".repeat(4_001) } }),
      "INVALID_CHARACTER"
    );
    expectMutationCode(
      () => updateStoryCharacter(content, "hero", { continuityRules: ["   "] }),
      "INVALID_CHARACTER"
    );
    expectMutationCode(
      () =>
        updateStoryCharacter(content, "hero", {
          continuityRules: Array.from({ length: 51 }, () => "Keep the scar"),
        }),
      "INVALID_CHARACTER"
    );

    const next = updateStoryCharacter(content, "hero", {
      id: "intruder",
      role: "Lead",
    } as never);
    expect(next.storyBible.characters[0]?.id).toBe("hero");
  });

  it("counts nested character references and blocks destructive deletion", () => {
    const content = referencedDraft();

    expect(countCharacterReferences(content, "hero")).toBe(4);
    expect(countCharacterReferences(content, "guide")).toBe(0);
    expectMutationCode(() => deleteStoryCharacter(content, "hero"), "CHARACTER_REFERENCED", 4);

    const next = deleteStoryCharacter(content, "guide");
    expect(next.storyBible.characters.map(({ id }) => id)).toEqual(["hero"]);
    expect(content.storyBible.characters.map(({ id }) => id)).toEqual(["hero", "guide"]);
    expectMutationCode(() => deleteStoryCharacter(content, "missing"), "CHARACTER_NOT_FOUND");
  });

  it("fails loudly instead of deleting multiple characters with a duplicate target ID", () => {
    const content = draft({
      storyBible: { characters: [character("hero"), character("hero")] },
    });

    expectMutationCode(() => deleteStoryCharacter(content, "hero"), "DUPLICATE_CHARACTER_ID");
    expect(content.storyBible.characters).toHaveLength(2);
  });

  it.each<{
    field: StoryWorldTextField;
    maximumItems: number;
    maximumLength: number;
  }>([
    { field: "locations", maximumItems: 200, maximumLength: 500 },
    { field: "props", maximumItems: 200, maximumLength: 500 },
    { field: "storyRules", maximumItems: 100, maximumLength: 2_000 },
  ])("adds, updates, removes, and enforces $field boundaries", (limits) => {
    const original = draft();
    const exact = "x".repeat(limits.maximumLength);
    const added = addWorldTextItem(original, limits.field, exact);
    const updated = updateWorldTextItem(added, limits.field, 0, "updated");
    const removed = removeWorldTextItem(updated, limits.field, 0);

    expect(added.storyBible[limits.field]).toEqual([exact]);
    expect(updated.storyBible[limits.field]).toEqual(["updated"]);
    expect(removed.storyBible[limits.field]).toEqual([]);
    expect(original.storyBible[limits.field]).toEqual([]);
    expect(updateWorldTextItem(added, limits.field, 0, exact)).toBe(added);
    expectMutationCode(
      () => addWorldTextItem(original, limits.field, `${exact}x`),
      "INVALID_WORLD_TEXT"
    );
    expectMutationCode(
      () =>
        addWorldTextItem(
          draft({
            storyBible: {
              [limits.field]: Array.from({ length: limits.maximumItems }, () => "full"),
            },
          }),
          limits.field,
          "overflow"
        ),
      "WORLD_TEXT_LIMIT_REACHED"
    );
  });

  it("requires integer in-range indices for world text updates and removals", () => {
    const content = draft({ storyBible: { locations: ["station"] } });

    for (const index of [-1, 0.5, 1, Number.NaN]) {
      expectMutationCode(
        () => updateWorldTextItem(content, "locations", index, "garden"),
        "WORLD_TEXT_INDEX_OUT_OF_RANGE"
      );
      expectMutationCode(
        () => removeWorldTextItem(content, "locations", index),
        "WORLD_TEXT_INDEX_OUT_OF_RANGE"
      );
    }
  });

  it("creates each state-variable branch with legal defaults and stable keys", () => {
    let content = draft({
      storyBible: {
        stateVariables: [{ key: "state:number-2", type: "number", initialValue: 2 }],
      },
    });
    const bool = createStoryStateVariable(content, { type: "boolean", key: "has-key" });
    content = bool.content;
    const number = createStoryStateVariable(content, { type: "number" });
    content = number.content;
    const string = createStoryStateVariable(content, { type: "string", key: "mood" });

    expect(bool.created).toEqual({ key: "has-key", type: "boolean", initialValue: false });
    expect(number.created).toEqual({ key: "state:number-3", type: "number", initialValue: 0 });
    expect(string.created).toEqual({ key: "mood", type: "string", initialValue: "" });
  });

  it("rejects invalid, duplicate, and over-capacity state-variable creation", () => {
    const content = draft({
      storyBible: {
        stateVariables: [{ key: "score", type: "number", initialValue: 0 }],
      },
    });

    expectMutationCode(
      () => createStoryStateVariable(content, { type: "number", key: "score" }),
      "DUPLICATE_STATE_VARIABLE_KEY"
    );
    expectMutationCode(
      () => createStoryStateVariable(content, { type: "number", key: "" }),
      "INVALID_STABLE_ID"
    );
    expectMutationCode(
      () => createStoryStateVariable(content, { type: "date" } as never),
      "INVALID_STATE_VARIABLE"
    );
    expectMutationCode(
      () =>
        createStoryStateVariable(
          draft({
            storyBible: {
              stateVariables: Array.from({ length: 200 }, (_, index) => ({
                key: `state:${index + 1}`,
                type: "boolean" as const,
                initialValue: false,
              })),
            },
          }),
          { type: "boolean" }
        ),
      "STATE_VARIABLE_LIMIT_REACHED"
    );
  });

  it("replaces state-variable union branches immutably while preserving the key", () => {
    const original = draft({
      storyBible: {
        stateVariables: [
          { key: "score", type: "number", initialValue: 0 },
          { key: "safe", type: "boolean", initialValue: false },
        ],
      },
    });
    const replacement = {
      key: "score",
      type: "string" as const,
      initialValue: "low",
      allowedValues: ["low", "high"],
    };
    const next = replaceStoryStateVariable(original, "score", replacement);

    expect(next.storyBible.stateVariables[0]).toBe(replacement);
    expect(next.storyBible.stateVariables[1]).toBe(original.storyBible.stateVariables[1]);
    expect(original.storyBible.stateVariables[0]).toEqual({
      key: "score",
      type: "number",
      initialValue: 0,
    });
    expect(replaceStoryStateVariable(next, "score", replacement)).toBe(next);
    expectMutationCode(
      () => replaceStoryStateVariable(original, "score", { ...replacement, key: "points" }),
      "STATE_VARIABLE_KEY_IMMUTABLE"
    );
    expectMutationCode(
      () => replaceStoryStateVariable(original, "missing", replacement),
      "STATE_VARIABLE_NOT_FOUND"
    );
  });

  it("accepts lock-time-invalid state-variable relationships while the draft is mutable", () => {
    const content = draft({
      storyBible: {
        stateVariables: [{ key: "value", type: "number", initialValue: 0 }],
      },
    });

    const editableIntermediateStates = [
      { key: "value", type: "number", initialValue: 2, minimum: 3 },
      { key: "value", type: "number", initialValue: 2, maximum: 1 },
      { key: "value", type: "number", initialValue: 2, minimum: 3, maximum: 1 },
      { key: "value", type: "string", initialValue: "x", allowedValues: ["y"] },
    ];

    editableIntermediateStates.forEach((variable) => {
      expect(
        replaceStoryStateVariable(content, "value", variable as never).storyBible.stateVariables[0]
      ).toEqual(variable);
    });
  });

  it("validates mutable-schema field constraints and strict state-variable union shapes", () => {
    const content = draft({
      storyBible: {
        stateVariables: [{ key: "value", type: "number", initialValue: 0 }],
      },
    });
    const invalidVariables = [
      { key: "value", type: "number", initialValue: Number.NaN },
      { key: "value", type: "number", initialValue: 2, minimum: Number.NEGATIVE_INFINITY },
      { key: "value", type: "number", initialValue: 2, maximum: Number.POSITIVE_INFINITY },
      { key: "value", type: "string", initialValue: "x", allowedValues: [] },
      {
        key: "value",
        type: "string",
        initialValue: "x",
        allowedValues: Array.from({ length: 101 }, () => "x"),
      },
      { key: "value", type: "string", initialValue: "x", allowedValues: ["x".repeat(2_001)] },
      { key: "value", type: "string", initialValue: "x", allowedValues: "x" },
      { key: "value", type: "string", initialValue: "x".repeat(2_001) },
      { key: "value", type: "boolean", initialValue: "false" },
      { key: "value", type: "boolean", initialValue: false, extra: true },
      { key: "value", type: "date", initialValue: "today" },
    ];

    invalidVariables.forEach((variable) => {
      expectMutationCode(
        () => replaceStoryStateVariable(content, "value", variable as never),
        "INVALID_STATE_VARIABLE"
      );
    });
  });

  it("counts deeply nested state-variable references and blocks destructive deletion", () => {
    const content = referencedDraft();

    expect(countStateVariableReferences(content, "score")).toBe(4);
    expect(countStateVariableReferences(content, "mood")).toBe(0);
    expectMutationCode(
      () => deleteStoryStateVariable(content, "score"),
      "STATE_VARIABLE_REFERENCED",
      4
    );

    const next = deleteStoryStateVariable(content, "mood");
    expect(next.storyBible.stateVariables.map(({ key }) => key)).toEqual(["score"]);
    expect(content.storyBible.stateVariables.map(({ key }) => key)).toEqual(["score", "mood"]);
    expectMutationCode(
      () => deleteStoryStateVariable(content, "missing"),
      "STATE_VARIABLE_NOT_FOUND"
    );
  });

  it("fails loudly instead of deleting multiple state variables with a duplicate target key", () => {
    const content = draft({
      storyBible: {
        stateVariables: [
          { key: "score", type: "number", initialValue: 0 },
          { key: "score", type: "number", initialValue: 1 },
        ],
      },
    });

    expectMutationCode(
      () => deleteStoryStateVariable(content, "score"),
      "DUPLICATE_STATE_VARIABLE_KEY"
    );
    expect(content.storyBible.stateVariables).toHaveLength(2);
  });
});

interface DraftOverrides {
  storyBible?: Partial<InteractiveFilmDraftContent["storyBible"]>;
  nodes?: StoryGraphNode[];
}

function draft(overrides: DraftOverrides = {}): InteractiveFilmDraftContent {
  return {
    storyBible: {
      logline: "",
      synopsis: "",
      worldview: "",
      storyRules: [],
      characters: [],
      locations: [],
      props: [],
      stateVariables: [],
      endings: [],
      ...overrides.storyBible,
    },
    graph: { entryNodeId: null, nodes: overrides.nodes ?? [] },
    clipPrompts: [],
    trailerPrompt: null,
    productionNotes: [],
  };
}

function character(id: string): InteractiveFilmDraftContent["storyBible"]["characters"][number] {
  return {
    id,
    name: { "en-US": "" },
    role: "",
    summary: "",
    playable: false,
    continuityRules: [],
  };
}

function referencedDraft(): InteractiveFilmDraftContent {
  return draft({
    storyBible: {
      characters: [character("hero"), character("guide")],
      stateVariables: [
        { key: "score", type: "number", initialValue: 0 },
        { key: "mood", type: "string", initialValue: "calm" },
      ],
    },
    nodes: [
      {
        kind: "router",
        nodeId: "gate",
        exit: {
          kind: "auto",
          routes: [
            {
              nextNodeId: "decision",
              priority: 0,
              when: {
                kind: "all",
                conditions: [
                  { kind: "relationship-at-least", characterId: "hero", value: 1 },
                  {
                    kind: "not",
                    condition: {
                      kind: "any",
                      conditions: [
                        { kind: "relationship-at-least", characterId: "hero", value: 2 },
                        { kind: "variable", key: "score", operator: "at_least", value: 3 },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      {
        kind: "clip",
        nodeId: "decision",
        clipKey: "DECISION",
        exit: {
          kind: "choice",
          decisionId: "choose",
          prompt: { "en-US": "Choose" },
          trigger: { kind: "media-ended" },
          choices: [
            {
              choiceId: "advance",
              label: { "en-US": "Advance" },
              visibleWhen: {
                kind: "any",
                conditions: [
                  { kind: "relationship-at-least", characterId: "hero", value: 3 },
                  {
                    kind: "not",
                    condition: {
                      kind: "variable",
                      key: "score",
                      operator: "less_than",
                      value: 10,
                    },
                  },
                ],
              },
              effects: [
                { kind: "adjust_relationship", characterId: "hero", amount: 1 },
                { kind: "set_variable", key: "score", value: 5 },
                { kind: "increment_variable", key: "score", amount: 1 },
              ],
              nextNodeId: "gate",
              afterSelect: { kind: "immediate" },
            },
          ],
        },
      },
    ],
  });
}

function expectMutationCode(
  action: () => unknown,
  code: StoryWorldMutationErrorCode,
  referenceCount?: number
): void {
  try {
    action();
    throw new Error(`Expected mutation ${code} to fail.`);
  } catch (error) {
    expect(error).toBeInstanceOf(StoryWorldMutationError);
    expect(error).toMatchObject({ code });
    if (referenceCount !== undefined) expect(error).toMatchObject({ referenceCount });
  }
}
