import { beforeEach, expect, it, vi } from "vitest";
import { durableRecord } from "@/lib/durable-record";
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
it("keeps a prepared deletion recoverable even after its node disappeared", () => {
  const deletion = {
    edit: { nodeId: "n", kind: "remove" as const, value: "" },
    ...canvasEditBaseline(snapshot, { nodeId: "n", kind: "remove" }),
    command: { clientKey: "00000000-0000-4000-8000-000000000001", yjsUpdateBase64: "AAA=" },
  };
  canvasDraftStore(scope, "user", storage).write(deletion);
  expect(canvasDraftStore(scope, "user", storage).read()).toEqual(deletion);
});
it("detects deletion dependency changes without conflicting on unrelated fields", () => {
  const state = {
    ...snapshot,
    nodes: {
      ...snapshot.nodes,
      b: {
        id: "b",
        type: "prompt",
        data: {
          prompt: "Keep",
          references: { images: [{ edgeId: "nb", url: "old" }] },
        },
      },
    },
    edges: { nb: { id: "nb", source: "n", target: "b" } },
  };
  const baseline = (s: typeof snapshot | typeof state) =>
    canvasEditBaseline(s, { nodeId: "n", kind: "remove" }).baseValue;
  const before = baseline(state);
  state.nodes.b.data.prompt = "Unrelated edit";
  expect(baseline(state)).toBe(before);
  state.nodes.b.data.references.images[0].url = "Changed input";
  expect(baseline(state)).not.toBe(before);
  expect(baseline({ ...snapshot, edges: state.edges })).not.toBe(baseline(snapshot));
});
it("canonicalizes deletion baselines across object key ordering", () => {
  const a = canvasEditBaseline(snapshot, { nodeId: "n", kind: "remove" });
  const b = canvasEditBaseline(
    { ...snapshot, nodes: { n: { data: snapshot.nodes.n.data, type: "prompt", id: "n" } } },
    { nodeId: "n", kind: "remove" }
  );
  expect(a).toEqual(b);
});
it("tracks shot membership and order without blocking unrelated field edits", () => {
  const board = {
    ...snapshot,
    nodes: {
      a: { id: "a", type: "shot", data: { order: "V", dialogue: "Original" } },
      b: { id: "b", type: "shot", data: { order: "k" } },
    },
  };
  const edit = { nodeId: "a", kind: "reorderShot" as const };
  const baseline = canvasEditBaseline(board, edit);
  board.nodes.a.data.dialogue = "Concurrent dialogue";
  expect(canvasEditBaseline(board, edit)).toEqual(baseline);
  board.nodes.b.data.order = "F";
  expect(canvasEditBaseline(board, edit)).not.toEqual(baseline);
  const store = canvasDraftStore(scope, "user", storage);
  store.write({ ...baseline, edit: { ...edit, value: "2" } });
  expect(store.read()?.edit.value).toBe("2");
  expect(() => store.write({ ...baseline, edit: { ...edit, value: "0" } })).toThrow();
  expect(() => canvasEditBaseline(snapshot, { nodeId: "n", kind: "reorderShot" })).toThrow(
    "does not support"
  );
});

it("isolates platform drafts by workspace, project, chapter, document and account", () => {
  vi.mocked(durableRecord).mockReturnValue(storage);
  const platform = {
    ...scope,
    kind: "platform" as const,
    workspaceId: "workspace",
    sectionId: "section",
  };
  canvasDraftStore(platform, "user").write(draft);
  expect(durableRecord).toHaveBeenLastCalledWith(
    "platform-canvas-draft",
    "user",
    "workspace:project:section:doc"
  );
  expect(canvasDraftStore(platform, "user").read()).toEqual(draft);
  canvasDraftStore(scope, "user");
  expect(durableRecord).toHaveBeenLastCalledWith("story-canvas-draft", "user", "project:doc");
});
