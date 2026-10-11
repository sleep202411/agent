import { expect, it } from "vitest";
import {
  captureRepairHistory,
  emptyRepairHistory,
  stepRepairHistory,
} from "./story-repair-history";
const content = (name: string) => ({ graph: { entryNodeId: "a", nodes: [{ nodeId: "a", name }] } });
it("groups nearby typing in one field and separates other edits", () => {
  let h = captureRepairHistory(emptyRepairHistory(), content("A"), "a:name", 1000);
  h = captureRepairHistory(h, content("AB"), "a:name", 1500);
  expect(h.past).toHaveLength(1);
  h = captureRepairHistory(h, content("ABC"), "a:description", 1600);
  expect(h.past).toHaveLength(2);
  h = captureRepairHistory(h, content("D"), "a:description", 2400);
  expect(h.past).toHaveLength(3);
});
it("plans reversible steps without consuming history before persistence", () => {
  const a = content("A"),
    b = content("B");
  const h = captureRepairHistory(emptyRepairHistory(), a);
  const undo = stepRepairHistory(h, b, "undo")!;
  expect(undo.content).toBe(a);
  expect(h.past).toHaveLength(1);
  const redo = stepRepairHistory(undo.history, a, "redo")!;
  expect(redo.content).toBe(b);
  expect(redo.history.future).toEqual([]);
  expect(captureRepairHistory(undo.history, a).future).toEqual([]);
  expect(stepRepairHistory(emptyRepairHistory(), a, "undo")).toBeNull();
});
it("keeps the official 100-entry session limit", () => {
  let h = emptyRepairHistory();
  for (let i = 0; i < 120; i++) h = captureRepairHistory(h, content(String(i)));
  expect(h.past).toHaveLength(100);
  expect(h.past[0].graph.nodes[0].name).toBe("20");
});
