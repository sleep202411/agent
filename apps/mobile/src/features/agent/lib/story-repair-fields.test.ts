import { expect, it } from "vitest";
import {
  repairNodeLabels,
  repairBranches,
  addRepairChoice,
  arrangeRepairChoice,
  updateRepairChoiceText,
  repairChoicePrompt,
  repairTargets,
  replaceRepairTarget,
  replaceRepairEntry,
  sameRepairTarget,
} from "./story-repair-fields";
const content = {
  storyBible: { endings: [{ endingId: "end", title: { "en-US": "The end" } }] },
  graph: {
    entryNodeId: "clip:a",
    nodes: [
      {
        nodeId: "clip:a",
        name: "A",
        interactions: [{ keep: true }],
        exit: {
          kind: "choice",
          prompt: { "en-US": "Choose" },
          choices: [
            {
              choiceId: "c",
              label: { "en-US": "Go" },
              visibleWhen: { keep: true },
              effects: [{ keep: true }],
              target: null,
            },
          ],
        },
      },
      {
        nodeId: "clip:b",
        name: "B",
        exit: { kind: "auto", routes: [{ condition: { keep: true }, target: null }] },
      },
    ],
  },
};
it("changes only the selected target and preserves conditions, effects and other nodes", () => {
  const next = replaceRepairTarget(content, "clip:a", 0, { kind: "node", nodeId: "clip:b" });
  expect(next.graph.nodes[1]).toBe(content.graph.nodes[1]);
  expect(next.graph.nodes[0]).toEqual({
    ...content.graph.nodes[0],
    exit: {
      ...content.graph.nodes[0].exit,
      choices: [
        { ...content.graph.nodes[0].exit.choices![0], target: { kind: "node", nodeId: "clip:b" } },
      ],
    },
  });
  expect(content.graph.nodes[0].exit.choices![0].target).toBeNull();
});
it("supports existing endings and retains conditional continuation data", () => {
  const next = replaceRepairTarget(content, "clip:b", 0, { kind: "ending", endingId: "end" });
  expect(repairBranches(next, "clip:b", "en-US")[0]).toMatchObject({
    conditional: true,
    target: { kind: "ending", endingId: "end" },
  });
  expect(repairTargets(next, "en-US").map((row) => row.label)).toEqual(["A", "B", "The end"]);
});
it("rejects a deleted source, branch or destination", () => {
  expect(() =>
    replaceRepairTarget(content, "gone", 0, { kind: "node", nodeId: "clip:b" })
  ).toThrow();
  expect(() =>
    replaceRepairTarget(content, "clip:a", 9, { kind: "node", nodeId: "clip:b" })
  ).toThrow();
  expect(() =>
    replaceRepairTarget(content, "clip:a", 0, { kind: "node", nodeId: "foreign" })
  ).toThrow();
});

it("compares destination identity independently of JSON property order", () => {
  expect(
    sameRepairTarget({ nodeId: "clip:b", kind: "node" }, { kind: "node", nodeId: "clip:b" })
  ).toBe(true);
  expect(
    sameRepairTarget({ endingId: "end", kind: "ending" }, { kind: "ending", endingId: "end" })
  ).toBe(true);
  expect(sameRepairTarget(null, { kind: "node", nodeId: "clip:b" })).toBe(false);
});

it("repairs the chapter entry without changing any nodes or accepting a foreign node", () => {
  const next = replaceRepairEntry(content, "clip:b");
  expect(next.graph.entryNodeId).toBe("clip:b");
  expect(next.graph.nodes).toBe(content.graph.nodes);
  expect(content.graph.entryNodeId).toBe("clip:a");
  expect(() => replaceRepairEntry(content, "foreign")).toThrow();
});
it("adds a blank decision choice without changing existing branches or other locale labels", () => {
  const next = addRepairChoice(content, "clip:a", "choice:new", "zh-CN");
  expect(repairBranches(next, "clip:a", "zh-CN")).toHaveLength(2);
  const labelled = updateRepairChoiceText(next, "clip:a", "zh-CN", "新选项", 1);
  const prompted = updateRepairChoiceText(labelled, "clip:a", "zh-CN", "选择");
  expect(repairChoicePrompt(prompted, "clip:a", "en-US")).toBe("Choose");
  expect(repairChoicePrompt(prompted, "clip:a", "zh-CN")).toBe("选择");
  expect(repairBranches(prompted, "clip:a", "zh-CN")[1].label).toBe("新选项");
  expect(repairBranches(prompted, "clip:a", "en-US")[0].label).toBe("Go");
  expect(content.graph.nodes[0].exit.choices).toHaveLength(1);
});
it("enforces the official six-choice limit and unique stable choice IDs", () => {
  let next = content as Parameters<typeof addRepairChoice>[0];
  for (let i = 1; i < 6; i++) next = addRepairChoice(next, "clip:a", `choice:${i}`, "en-US");
  expect(() => addRepairChoice(next, "clip:a", "choice:overflow", "en-US")).toThrow();
  expect(() => addRepairChoice(content, "clip:a", "c", "en-US")).toThrow();
  expect(() => addRepairChoice(content, "clip:a", "bad id", "en-US")).toThrow();
  expect(() => addRepairChoice(content, "clip:b", "choice:auto", "en-US")).toThrow();
});
it("moves complete choices by identity and removes only the requested choice", () => {
  const original = addRepairChoice(content, "clip:a", "choice:second", "en-US");
  const moved = arrangeRepairChoice(original, "clip:a", "c", "down");
  expect(repairBranches(moved, "clip:a", "en-US").map((b) => b.choiceId)).toEqual([
    "choice:second",
    "c",
  ]);
  const rows = moved.graph.nodes[0].exit as { choices: unknown[] };
  expect(rows.choices[1]).toBe(content.graph.nodes[0].exit.choices![0]);
  const removed = arrangeRepairChoice(moved, "clip:a", "choice:second", "remove");
  expect(repairBranches(removed, "clip:a", "en-US").map((b) => b.choiceId)).toEqual(["c"]);
  expect(removed.graph.nodes[1]).toBe(content.graph.nodes[1]);
  expect(() => arrangeRepairChoice(removed, "clip:a", "gone", "remove")).toThrow();
  expect(
    repairBranches(arrangeRepairChoice(removed, "clip:a", "c", "up"), "clip:a", "en-US")
  ).toHaveLength(1);
});

it("distinguishes same-name copies consistently without renaming authored data", () => {
  const copies = {
    ...content,
    graph: {
      ...content.graph,
      nodes: [
        { ...content.graph.nodes[0], name: "Opening" },
        { ...content.graph.nodes[1], name: " Opening " },
        { nodeId: "clip:c", name: "Unique" },
      ],
    },
  };
  const before = JSON.stringify(copies);
  const labels = repairNodeLabels(copies);
  expect([...labels.values()]).toEqual(["Opening · 1", "Opening · 2", "Unique"]);
  expect(
    repairTargets(copies, "en-US")
      .slice(0, 3)
      .map((t) => t.label)
  ).toEqual([...labels.values()]);
  expect(JSON.stringify(copies)).toBe(before);
});
