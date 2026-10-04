import { beforeEach, expect, it, vi } from "vitest";
import { canvasGroupBaseline, canvasGroupDraftStore } from "./story-canvas-group-draft";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const scope = { projectId: "project", documentId: "doc", generation: 1 };
let raw: string | null;
const storage = {
  read: () => raw,
  write: (value: string) => {
    raw = value;
  },
};
function fixture() {
  return {
    meta: {},
    edges: {},
    assets: {},
    groups: { group: { id: "group", nodeIds: ["a", "b"], color: "red" } },
    nodes: {
      a: { id: "a", type: "note", position: { x: 0, y: 0 }, data: { text: "Original" } },
      b: { id: "b", type: "note", position: { x: 50, y: 0 }, data: { text: "Other" } },
      c: { id: "c", type: "note", position: { x: 100, y: 0 }, data: { text: "Outside" } },
    },
  };
}
beforeEach(() => {
  raw = null;
  h.generation = 1;
});
it("keeps node selection across closing and reopening the panel", () => {
  const draft = { stage: "selection" as const, nodeIds: ["a", "c"] };
  canvasGroupDraftStore(scope, "user", storage).write(draft);
  expect(canvasGroupDraftStore(scope, "user", storage).read()).toEqual(draft);
});
it("keeps exact action bytes and group identity for lost-response recovery", () => {
  const edit = { operation: "color" as const, groupId: "group", color: "blue" as const };
  const draft = {
    stage: "action" as const,
    edit,
    baseline: canvasGroupBaseline(fixture(), edit),
    command: { clientKey: "00000000-0000-4000-8000-000000000001", yjsUpdateBase64: "AAA=" },
  };
  canvasGroupDraftStore(scope, "user", storage).write(draft);
  expect(canvasGroupDraftStore(scope, "user", storage).read()).toEqual(draft);
});
it("rejects corrupt recovery records and expired accounts without clearing storage", () => {
  raw = "corrupt";
  expect(() => canvasGroupDraftStore(scope, "user", storage).read()).toThrow();
  expect(raw).toBe("corrupt");
  h.generation++;
  expect(() => canvasGroupDraftStore(scope, "user", storage).write(null)).toThrow("expired");
  expect(raw).toBe("corrupt");
});
it("ignores unrelated content and positions for membership changes", () => {
  const snapshot = fixture(),
    edit = { operation: "add" as const, groupId: "group", nodeIds: ["c"] };
  const baseline = canvasGroupBaseline(snapshot, edit);
  snapshot.nodes.a.data.text = "Concurrent";
  snapshot.nodes.c.position.x = 200;
  expect(canvasGroupBaseline(snapshot, edit)).toBe(baseline);
  snapshot.groups.group.nodeIds = ["a", "c"];
  expect(canvasGroupBaseline(snapshot, edit)).not.toBe(baseline);
});
it("detects selected node deletion and group disappearance", () => {
  const snapshot = fixture();
  const edit = { operation: "add" as const, groupId: "group", nodeIds: ["missing"] };
  expect(() => canvasGroupBaseline(snapshot, edit)).toThrow();
  expect(() => canvasGroupBaseline(snapshot, { operation: "ungroup", groupId: "gone" })).toThrow(
    "changed"
  );
});
it("checks every moved member position but allows concurrent group recoloring and text", () => {
  const snapshot = fixture(),
    edit = { operation: "move" as const, groupId: "group", delta: { x: 80, y: 0 } };
  const baseline = canvasGroupBaseline(snapshot, edit);
  snapshot.groups.group.color = "blue";
  snapshot.nodes.a.data.text = "Concurrent";
  snapshot.nodes.c.position.x = 300;
  expect(canvasGroupBaseline(snapshot, edit)).toBe(baseline);
  snapshot.nodes.b.position.y = 80;
  expect(canvasGroupBaseline(snapshot, edit)).not.toBe(baseline);
});
it("detects a newly occupied group ID before creating a saved selection", () => {
  const snapshot = fixture(),
    groupId = "group-00000000-0000-4000-8000-000000000001";
  const edit = { operation: "create" as const, groupId, nodeIds: ["a", "c"] };
  const baseline = canvasGroupBaseline(snapshot, edit);
  Object.assign(snapshot.groups, { [groupId]: { nodeIds: [] } });
  expect(canvasGroupBaseline(snapshot, edit)).not.toBe(baseline);
});
