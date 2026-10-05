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
it("preserves reference drafts and detects target mode changes while ignoring prompt text", () => {
  const snapshot = {
    ...fixture(),
    nodes: {
      ...fixture().nodes,
      card: {
        id: "card",
        type: "prompt",
        data: { modelId: "model", mode: "image_to_image", prompt: "Original", references: {} },
      },
    },
  };
  const edit = {
    ...attach,
    nodeId: "card",
    target: {
      modelId: "model",
      mode: "image_to_image",
      fields: [{ field: "images", kind: "image" as const, maxItems: 2 }],
    },
  };
  const baseline = canvasMediaBaseline(snapshot, edit);
  const draft = {
    edit,
    reference: true as const,
    title: "Reference",
    baseline,
    command: { clientKey: edgeId, yjsUpdateBase64: "AAA=" },
  };
  const store = canvasMediaDraftStore(scope, "user", storage);
  store.write(draft);
  expect(canvasMediaDraftStore(scope, "user", storage).read()).toEqual(draft);
  snapshot.nodes.card.data.prompt = "Unrelated remote prompt";
  expect(canvasMediaBaseline(snapshot, edit)).toBe(baseline);
  snapshot.nodes.card.data.mode = "text_to_image";
  expect(canvasMediaBaseline(snapshot, edit)).not.toBe(baseline);
});
it("tracks the selected imported reference without binding removal to array position", () => {
  const snapshot = {
    ...fixture(),
    nodes: {
      ...fixture().nodes,
      card: {
        id: "card",
        type: "prompt",
        data: {
          references: {
            images: [
              { id: "one", url: "https://example.test/one" },
              { id: "two", url: "https://example.test/two" },
            ],
          },
        },
      },
    },
  };
  const edit = {
    action: "removeReference",
    nodeId: "card",
    field: "images",
    referenceId: "one",
  } as const;
  const baseline = canvasMediaBaseline(snapshot, edit);
  canvasMediaDraftStore(scope, "user", storage).write({
    reference: true,
    edit,
    title: "Remove",
    baseline,
  });
  expect(canvasMediaDraftStore(scope, "user", storage).read()?.edit).toEqual(edit);
  snapshot.nodes.card.data.references.images.reverse();
  expect(canvasMediaBaseline(snapshot, edit)).toBe(baseline);
  snapshot.nodes.card.data.references.images[1]!.url = "https://example.test/changed";
  expect(canvasMediaBaseline(snapshot, edit)).not.toBe(baseline);
  snapshot.nodes.card.data.references.images.pop();
  expect(() => canvasMediaBaseline(snapshot, edit)).toThrow("identity changed");
});
