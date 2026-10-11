import { expect, it } from "vitest";
import {
  parseRepairPointPrice,
  readRepairPointPrice,
  replaceRepairPointPrice,
} from "./story-repair-price";
const content = {
  storyBible: { keep: true },
  graph: {
    entryNodeId: "a",
    nodes: [
      {
        nodeId: "a",
        kind: "clip",
        communityPointPrice: 5,
        clipKey: "SCENE_A",
        exit: { kind: "auto", routes: [{ target: null }] },
      },
      { nodeId: "b", kind: "decision" },
    ],
  },
};
it("uses official integer pricing limits without accepting scientific notation or fractions", () => {
  for (const text of ["", " ", "-1", "1.5", "1e2", "Infinity", "2147483648"])
    expect(parseRepairPointPrice(text)).toBeNull();
  expect(parseRepairPointPrice(" 2147483647 ")).toBe(2147483647);
  expect(parseRepairPointPrice("0")).toBe(0);
});
it("preserves graph data and removes the price field for free access", () => {
  const next = replaceRepairPointPrice(content, "a", 5, 12);
  expect(readRepairPointPrice(next, "a")).toBe(12);
  expect(content.graph.nodes[0].communityPointPrice).toBe(5);
  expect(next.graph.nodes[0].exit).toBe(content.graph.nodes[0].exit);
  const free = replaceRepairPointPrice(next, "a", 12, 0);
  expect(free.graph.nodes[0]).not.toHaveProperty("communityPointPrice");
  expect(free.storyBible).toBe(content.storyBible);
  expect(free.graph.entryNodeId).toBe("a");
});
it("rejects stale prices, decisions and deleted scenes", () => {
  expect(() => replaceRepairPointPrice(content, "a", 4, 1)).toThrow("changed");
  expect(() => replaceRepairPointPrice(content, "b", 0, 1)).toThrow("no longer");
  expect(() => replaceRepairPointPrice(content, "missing", 0, 1)).toThrow("no longer");
  expect(() => replaceRepairPointPrice(content, "a", 5, NaN)).toThrow("Invalid");
});
