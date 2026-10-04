import { beforeEach, expect, it, vi } from "vitest";
import { canvasMediaBaseline, canvasMediaDraftStore } from "./story-canvas-media-draft";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const scope = { projectId: "project", documentId: "doc", generation: 1 };
const edgeId = "00000000-0000-4000-8000-000000000001";
const attach = { action: "attach" as const, nodeId: "shot", sourceId: "image", edgeId };
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
    assets: {},
    groups: {},
    edges: {} as Record<string, unknown>,
    nodes: {
      shot: {
        id: "shot",
        type: "shot",
        data: {
          order: "V",
          dialogue: "Original",
          references: { frame: [{ edgeId: "old", url: "keep" }] },
          preferredFrameEdgeId: "old",
        },
      },
      image: { id: "image", type: "image", data: { src: "https://example.test/one", width: 512 } },
    },
  };
}
beforeEach(() => {
  raw = null;
  h.generation = 1;
});
it("keeps the connection identity, source and exact prepared operation across reopening", () => {
  const draft = {
    edit: attach,
    title: "Shot",
    baseline: canvasMediaBaseline(fixture(), attach),
    command: { clientKey: edgeId, yjsUpdateBase64: "AAA=" },
  };
  canvasMediaDraftStore(scope, "user", storage).write(draft);
  expect(canvasMediaDraftStore(scope, "user", storage).read()).toEqual(draft);
});
it("preserves corruption and refuses expired account writes", () => {
  raw = "corrupt";
  expect(() => canvasMediaDraftStore(scope, "user", storage).read()).toThrow();
  expect(raw).toBe("corrupt");
  const store = canvasMediaDraftStore(scope, "user", storage);
  h.generation++;
  expect(() => store.write(null)).toThrow("expired");
  expect(() => store.read()).toThrow("expired");
  expect(raw).toBe("corrupt");
});
it("ignores unrelated dialogue and ordering but detects changed source media", () => {
  const snapshot = fixture(),
    baseline = canvasMediaBaseline(snapshot, attach);
  snapshot.nodes.shot.data.dialogue = "Remote";
  snapshot.nodes.shot.data.order = "k";
  expect(canvasMediaBaseline(snapshot, attach)).toBe(baseline);
  snapshot.nodes.image.data.src = "https://example.test/new";
  expect(canvasMediaBaseline(snapshot, attach)).not.toBe(baseline);
});
it("detects newly reserved capacity and source kind changes", () => {
  const snapshot = fixture(),
    baseline = canvasMediaBaseline(snapshot, attach);
  snapshot.edges.pending = { id: "pending", source: "image", target: "shot" };
  expect(canvasMediaBaseline(snapshot, attach)).not.toBe(baseline);
  const reserved = canvasMediaBaseline(snapshot, attach);
  snapshot.nodes.image.type = "videoAsset";
  expect(canvasMediaBaseline(snapshot, attach)).not.toBe(reserved);
});
it("detects detach target changes, including removal of its edge", () => {
  const snapshot = fixture(),
    edit = { action: "detach" as const, nodeId: "shot", edgeId: "old" };
  snapshot.edges.old = { id: "old", source: "image", target: "shot" };
  const baseline = canvasMediaBaseline(snapshot, edit);
  delete snapshot.edges.old;
  expect(canvasMediaBaseline(snapshot, edit)).not.toBe(baseline);
});
it("checks preferred-frame changes independently of source outputs", () => {
  const snapshot = fixture(),
    edit = { action: "prefer" as const, nodeId: "shot", edgeId: "old" };
  const baseline = canvasMediaBaseline(snapshot, edit);
  snapshot.nodes.image.data.src = "new";
  expect(canvasMediaBaseline(snapshot, edit)).toBe(baseline);
  snapshot.nodes.shot.data.preferredFrameEdgeId = "other";
  expect(canvasMediaBaseline(snapshot, edit)).not.toBe(baseline);
});
it("rejects missing shots or attach sources rather than fabricating baselines", () => {
  expect(() => canvasMediaBaseline(fixture(), { ...attach, nodeId: "missing" })).toThrow();
  expect(() => canvasMediaBaseline(fixture(), { ...attach, sourceId: "missing" })).toThrow();
});
