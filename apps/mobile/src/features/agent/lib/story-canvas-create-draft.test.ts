import { durableRecord } from "@/lib/durable-record";
import { beforeEach, expect, it, vi } from "vitest";
import { canvasCreateDraftStore, canvasAppendPosition } from "./story-canvas-create-draft";
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
  nodeId: "00000000-0000-4000-8000-000000000001",
  type: "video" as const,
  name: "Scene",
  text: "雨中的城市",
};
beforeEach(() => {
  raw = null;
  h.generation = 1;
});
it("keeps the same node identity and content after reopening", () => {
  canvasCreateDraftStore(scope, "user", storage).write(draft);
  expect(canvasCreateDraftStore(scope, "user", storage).read()).toEqual(draft);
});
it("retains exact prepared bytes and key across retries", () => {
  const command = { clientKey: "00000000-0000-4000-8000-000000000002", yjsUpdateBase64: "AAA=" };
  canvasCreateDraftStore(scope, "user", storage).write({ ...draft, command });
  expect(canvasCreateDraftStore(scope, "user", storage).read()).toEqual({ ...draft, command });
});
it("does not overwrite corrupted or retired-account drafts", () => {
  raw = "corrupt";
  expect(() => canvasCreateDraftStore(scope, "user", storage).read()).toThrow();
  expect(raw).toBe("corrupt");
  const store = canvasCreateDraftStore(scope, "user", storage);
  store.write(draft);
  h.generation++;
  expect(() => store.write(null)).toThrow("expired");
  expect(() => store.read()).toThrow("expired");
  expect(raw).toContain("Scene");
});
it("places new cards after existing positions and leaves the layout unchanged", () => {
  const snapshot = {
    nodes: { a: { position: { x: 80, y: 700 }, width: 700 }, b: { position: { x: -200, y: 0 } } },
    meta: {},
    edges: {},
    groups: {},
    assets: {},
  };
  const original = JSON.stringify(snapshot);
  expect(canvasAppendPosition(snapshot)).toEqual({ x: 860, y: 0 });
  expect(JSON.stringify(snapshot)).toBe(original);
  expect(canvasAppendPosition({ ...snapshot, nodes: {} })).toEqual({ x: 0, y: 0 });
  expect(canvasAppendPosition({ ...snapshot, nodes: { legacy: {} } })).toEqual({ x: 560, y: 0 });
});
it("rejects nonfinite placement rather than persisting unusable coordinates", () => {
  expect(() =>
    canvasAppendPosition({
      nodes: { a: { position: { x: Infinity, y: 0 } } },
      meta: {},
      edges: {},
      groups: {},
      assets: {},
    })
  ).toThrow();
});
it("keeps library source identity and frozen update after reopening", () => {
  const library = {
    ...draft,
    type: "libraryAsset" as const,
    assetId: "asset",
    command: { clientKey: "00000000-0000-4000-8000-000000000002", yjsUpdateBase64: "AAA=" },
  };
  canvasCreateDraftStore(scope, "user", storage).write(library);
  expect(canvasCreateDraftStore(scope, "user", storage).read()).toEqual(library);
  expect(() =>
    canvasCreateDraftStore(scope, "user", storage).write({ ...library, assetId: undefined })
  ).toThrow();
  expect(canvasCreateDraftStore(scope, "user", storage).read()).toEqual(library);
});

it("isolates platform creation drafts and rejects another chapter's upload checkpoint", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const platform = {
    kind: "platform" as const,
    projectId: id,
    workspaceId: id,
    documentId: id,
    sectionId: id,
    generation: 1,
  };
  vi.mocked(durableRecord).mockReturnValue(storage);
  const store = canvasCreateDraftStore(platform, "user");
  store.write(draft);
  expect(durableRecord).toHaveBeenLastCalledWith(
    "platform-canvas-create-draft",
    "user",
    `${id}:${id}:${id}:${id}`
  );
  expect(store.read()).toEqual(draft);
  const upload = {
    name: "photo.png",
    createdAt: 1,
    confirmation: {
      storageKey: "key",
      contentType: "image/png",
      kind: "ai_reference_image" as const,
      scope: { workspaceId: id, projectId: id, sectionId: id, documentId: id },
    },
  };
  store.write({ ...draft, type: "uploadedAsset", upload });
  expect(store.read()?.upload).toEqual(upload);
  expect(() =>
    canvasCreateDraftStore(
      { ...platform, sectionId: "00000000-0000-4000-8000-000000000002" },
      "user",
      storage
    ).read()
  ).toThrow("mismatch");
  expect(() =>
    canvasCreateDraftStore({ projectId: id, documentId: id, generation: 1 }, "user", storage).read()
  ).toThrow("mismatch");
});
