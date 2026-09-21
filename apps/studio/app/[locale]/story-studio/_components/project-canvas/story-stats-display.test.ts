import { describe, expect, it } from "vitest";
import {
  formatStoryConditionChip,
  formatStoryEffectChip,
  formatStoryEffectsChip,
  storyEffectKindOption,
  storyRetargetEffectKind,
} from "./story-stats-display";

const names = new Map([
  ["favorability.lin", "Favorability · Lin"],
  ["gold", "Gold"],
  ["met.lin", "Met Lin"],
]);

describe("story stats display chips", () => {
  it("formats add/set effects with the player-facing name", () => {
    expect(formatStoryEffectChip({ kind: "add", key: "favorability.lin", amount: 10 }, names)).toBe(
      "Favorability · Lin +10"
    );
    expect(formatStoryEffectChip({ kind: "add", key: "gold", amount: -5 }, names)).toBe("Gold -5");
    expect(formatStoryEffectChip({ kind: "set", key: "met.lin", value: true }, names)).toBe(
      "Met Lin = true"
    );
    expect(
      formatStoryEffectsChip(
        [
          { kind: "add", key: "favorability.lin", amount: 2 },
          { kind: "set", key: "met.lin", value: true },
        ],
        names
      )
    ).toBe("Favorability · Lin +2, Met Lin = true");
  });

  it("formats compare and boolean combinators", () => {
    expect(
      formatStoryConditionChip(
        { kind: "compare", variableKey: "favorability.lin", operator: "at-least", value: 80 },
        names
      )
    ).toBe("Favorability · Lin ≥ 80");
    expect(
      formatStoryConditionChip(
        {
          kind: "all",
          conditions: [
            { kind: "compare", variableKey: "gold", operator: "greater-than", value: 0 },
            { kind: "compare", variableKey: "met.lin", operator: "equals", value: true },
          ],
        },
        names
      )
    ).toBe("Gold > 0 ∧ Met Lin = true");
    expect(
      formatStoryConditionChip(
        {
          kind: "not",
          condition: { kind: "compare", variableKey: "met.lin", operator: "equals", value: false },
        },
        names
      )
    ).toBe("¬(Met Lin = false)");
  });

  it("falls back to the technical key when no display name is registered", () => {
    expect(formatStoryEffectChip({ kind: "add", key: "courage", amount: 1 }, names)).toBe(
      "courage +1"
    );
  });

  it("keeps nested condition grouping visible in a read-only label", () => {
    expect(
      formatStoryConditionChip(
        {
          kind: "all",
          conditions: [
            { kind: "compare", variableKey: "gold", operator: "at-least", value: 2 },
            {
              kind: "any",
              conditions: [
                { kind: "compare", variableKey: "met.lin", operator: "equals", value: true },
                { kind: "compare", variableKey: "gold", operator: "at-least", value: 5 },
              ],
            },
          ],
        },
        names
      )
    ).toBe("Gold ≥ 2 ∧ (Met Lin = true ∨ Gold ≥ 5)");
  });
});

describe("story effect ui kind", () => {
  it("maps negative add amounts to the subtract option", () => {
    expect(storyEffectKindOption({ kind: "add", key: "gold", amount: -3 })).toBe("subtract");
    expect(storyEffectKindOption({ kind: "add", key: "gold", amount: 3 })).toBe("add");
    expect(storyEffectKindOption({ kind: "add", key: "gold", amount: 0 })).toBe("add");
    expect(storyEffectKindOption({ kind: "set", key: "gold", value: 5 })).toBe("set");
  });

  it("retargets between add and subtract by flipping the sign", () => {
    expect(
      storyRetargetEffectKind({ kind: "add", key: "gold", amount: 3 }, "subtract", {
        valueType: "number",
      })
    ).toEqual({ kind: "add", key: "gold", amount: -3 });
    expect(
      storyRetargetEffectKind({ kind: "add", key: "gold", amount: -3 }, "add", {
        valueType: "number",
      })
    ).toEqual({ kind: "add", key: "gold", amount: 3 });
    expect(
      storyRetargetEffectKind({ kind: "add", key: "gold", amount: 0 }, "subtract", {
        valueType: "number",
      })
    ).toEqual({ kind: "add", key: "gold", amount: 0 });
  });

  it("defaults to magnitude 1 when converting from set", () => {
    expect(
      storyRetargetEffectKind({ kind: "set", key: "gold", value: 99 }, "subtract", {
        valueType: "number",
      })
    ).toEqual({ kind: "add", key: "gold", amount: -1 });
    expect(
      storyRetargetEffectKind({ kind: "set", key: "gold", value: 99 }, "add", {
        valueType: "number",
      })
    ).toEqual({ kind: "add", key: "gold", amount: 1 });
    expect(
      storyRetargetEffectKind({ kind: "add", key: "gold", amount: -4 }, "set", {
        valueType: "number",
      })
    ).toEqual({ kind: "set", key: "gold", value: 0 });
    expect(
      storyRetargetEffectKind({ kind: "set", key: "gold", value: 7 }, "set", {
        valueType: "number",
      })
    ).toEqual({ kind: "set", key: "gold", value: 7 });
  });

  it("forces boolean variables to set true regardless of the requested kind", () => {
    for (const kind of ["add", "subtract", "set"] as const) {
      expect(
        storyRetargetEffectKind({ kind: "add", key: "flag", amount: -2 }, kind, {
          valueType: "boolean",
        })
      ).toEqual({ kind: "set", key: "flag", value: true });
    }
  });
});
