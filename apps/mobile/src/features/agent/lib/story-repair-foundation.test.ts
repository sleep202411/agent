import { expect, it } from "vitest";
import { readRepairFoundation, updateRepairFoundation } from "./story-repair-foundation";
const content = {
  graph: { entryNodeId: null, nodes: [] },
  storyBible: {
    logline: "Before",
    synopsis: "Keep",
    characters: [{ id: "person" }],
    endings: [{ endingId: "ending" }],
    stateVariables: [],
  },
};
it("updates only the authored field without changing graph or other foundation data", () => {
  const changed = updateRepairFoundation(content, "logline", "  New\nline  ");
  expect(changed.graph).toBe(content.graph);
  expect(changed.storyBible).toEqual({ ...content.storyBible, logline: "  New\nline  " });
  expect(content.storyBible.logline).toBe("Before");
  expect(readRepairFoundation(updateRepairFoundation(changed, "synopsis", ""))).toEqual({
    logline: "  New\nline  ",
    synopsis: "",
  });
});
it("enforces the authoritative limits without silently truncating text", () => {
  for (const [field, limit] of [
    ["logline", 1000],
    ["synopsis", 20000],
  ] as const) {
    expect(
      readRepairFoundation(updateRepairFoundation(content, field, "x".repeat(limit)))[field]
    ).toHaveLength(limit);
    expect(() => updateRepairFoundation(content, field, "x".repeat(limit + 1))).toThrow();
  }
});
it("rejects malformed existing values instead of overwriting them", () => {
  for (const bible of [null, [], { logline: 3 }, { synopsis: [] }]) {
    expect(() =>
      updateRepairFoundation({ ...content, storyBible: bible }, "logline", "New")
    ).toThrow();
  }
});
