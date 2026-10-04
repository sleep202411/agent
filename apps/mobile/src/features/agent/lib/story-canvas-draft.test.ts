import { beforeEach, expect, it, vi } from "vitest";
import { canvasDraftStore, canvasEditBaseline } from "./story-canvas-draft";
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
const draft = {
  nodeType: "prompt",
  baseValue: "Original",
  edit: { nodeId: "n", kind: "prompt" as const, value: "New prompt" },
};
const snapshot = {
  meta: {},
  edges: {},
  groups: {},
  assets: {},
  nodes: {
    n: {
      id: "n",
      type: "prompt",
      data: { prompt: "Original", name: "Name", label: "Not generation title" },
    },
  },
};
beforeEach(() => {
  raw = null;
  h.generation = 1;
});
it("preserves baseline and unsent text across reopening", () => {
  canvasDraftStore(scope, "user", storage).write(draft);
  expect(canvasDraftStore(scope, "user", storage).read()).toEqual(draft);
});
it("keeps prepared bytes and mutation ID together with the draft", () => {
  const command = { clientKey: "00000000-0000-4000-8000-000000000001", yjsUpdateBase64: "AAA=" };
  const store = canvasDraftStore(scope, "user", storage);
  store.write({ ...draft, command });
  expect(store.read()).toEqual({ ...draft, command });
  store.write(null);
  expect(store.read()).toBeNull();
});
it("rejects corrupted drafts instead of overwriting recovery data", () => {
  raw = '{"version":1,"draft":{"edit":{}}}';
  expect(() => canvasDraftStore(scope, "user", storage).read()).toThrow();
  expect(raw).toContain('"edit":{}');
});
it("rejects reads and clears from retired accounts", () => {
  const store = canvasDraftStore(scope, "user", storage);
  store.write(draft);
  h.generation++;
  expect(() => store.read()).toThrow("expired");
  expect(() => store.write(null)).toThrow("expired");
  expect(raw).toContain("New prompt");
});
it("uses the generation name field and detects changed prompt baselines", () => {
  expect(canvasEditBaseline(snapshot, { nodeId: "n", kind: "rename" })).toEqual({
    nodeType: "prompt",
    baseValue: "Name",
  });
  expect(canvasEditBaseline(snapshot, draft.edit).baseValue).toBe("Original");
  expect(
    canvasEditBaseline(
      { ...snapshot, nodes: { n: { ...snapshot.nodes.n, data: { prompt: "Remote edit" } } } },
      draft.edit
    ).baseValue
  ).not.toBe(draft.baseValue);
});
it("rejects missing nodes and locked prompts", () => {
  expect(() => canvasEditBaseline(snapshot, { nodeId: "gone", kind: "prompt" })).toThrow();
  expect(() =>
    canvasEditBaseline(
      { ...snapshot, nodes: { n: { ...snapshot.nodes.n, data: { locked: true } } } },
      draft.edit
    )
  ).toThrow("does not support");
});
