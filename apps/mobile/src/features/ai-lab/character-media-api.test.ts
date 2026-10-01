import { beforeEach, it, expect, vi } from "vitest";
import {
  prepareCharacterMedia,
  submitCharacterMedia,
  reconcileCharacterMedia,
  characterMediaBox,
  characterUploadStore,
  uploadCharacterMedia,
  finishCharacterUpload,
  previewCharacterMedia,
} from "./character-media-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  workspaces: vi.fn(),
  pick: vi.fn(),
  selected: vi.fn(),
  put: vi.fn(),
  access: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post, patch: h.patch, delete: h.delete },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/features/agent/api/studio-projects-api", () => ({
  loadAgentWorkspaces: h.workspaces,
  canCreateStudioProject: (w: { role: string }) => w.role === "editor",
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(ns + user + id) ?? null,
    write: (v: string) => h.records.set(ns + user + id, v),
  }),
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("@/features/ip-author/selected-media", () => ({ selectedMedia: h.selected }));
vi.mock("@/features/crew-assets/api", () => ({ fetchCrewAssetAccess: h.access }));
const id = "11111111-1111-4111-8111-111111111111",
  workspaceId = "22222222-2222-4222-8222-222222222222",
  key = "33333333-3333-4333-8333-333333333333",
  asset = "44444444-4444-4444-8444-444444444444",
  second = "55555555-5555-4555-8555-555555555555";
const media = { id: key, mediaAssetId: asset, mediaKind: "image" as const, sortOrder: 0 };
const detail = {
  id,
  workspaceId,
  kind: "virtual" as const,
  name: "Hero",
  description: null,
  coverAssetId: null,
  status: "active" as const,
  createdByUserId: "actor",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  mediaCounts: { image: 1, video: 0, audio: 0 },
  media: [media],
};
const signal = () => new AbortController().signal;
const signed = {
  uploadUrl: "https://storage.test/put",
  method: "PUT",
  headers: {},
  storageKey: "staging/key",
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.workspaces.mockResolvedValue([{ id: workspaceId, role: "editor" }]);
  h.get.mockResolvedValue(detail);
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///image.png", name: "image.png", mimeType: "image/png" }],
  });
  h.selected.mockResolvedValue({ size: 100, put: h.put });
  h.put.mockResolvedValue({ ok: true });
  h.access.mockResolvedValue({ url: "https://storage.test/read" });
  h.post.mockResolvedValue(signed);
});
it("validates image cover identity and complete nonduplicated media order", () => {
  expect(() => prepareCharacterMedia(detail, { kind: "cover", assetId: second }, key)).toThrow(
    "attached image"
  );
  expect(() => prepareCharacterMedia(detail, { kind: "order", order: [key, key] }, key)).toThrow(
    "complete"
  );
  expect(() => prepareCharacterMedia(detail, { kind: "remove", mediaId: second }, key)).toThrow(
    "attached"
  );
  expect(() =>
    prepareCharacterMedia(detail, { kind: "attach", assetId: asset, mediaKind: "image" }, key)
  ).toThrow("already");
});
it("rejects stale ordering and lost edit permission before mutation", async () => {
  const intent = prepareCharacterMedia(detail, { kind: "cover", assetId: asset }, key);
  h.get.mockResolvedValueOnce({ ...detail, media: [{ ...media, sortOrder: 2 }] });
  await expect(submitCharacterMedia(intent, "actor", 1, signal())).rejects.toThrow("changed");
  h.workspaces.mockResolvedValueOnce([{ id: workspaceId, role: "viewer" }]);
  await expect(submitCharacterMedia(intent, "actor", 1, signal())).rejects.toThrow("editor");
  expect(h.patch).not.toHaveBeenCalled();
});
it("persists exact cover intent and validates receipt before clearing", async () => {
  const intent = prepareCharacterMedia(detail, { kind: "cover", assetId: asset }, key);
  h.patch.mockImplementation(async (path, { data, retry }) => {
    expect(path).toBe(`/characters/${id}`);
    expect(data).toEqual({ coverAssetId: asset });
    expect(retry).toBe(false);
    expect(characterMediaBox("actor", 1, id).read()).toEqual(intent);
    return { ...detail, coverAssetId: asset };
  });
  await submitCharacterMedia(intent, "actor", 1, signal());
  expect(characterMediaBox("actor", 1, id).read()).toBeNull();
  h.patch.mockResolvedValueOnce(detail);
  await expect(submitCharacterMedia(intent, "actor", 1, signal())).rejects.toThrow("receipt");
  expect(characterMediaBox("actor", 1, id).read()).not.toBeNull();
});
it("keeps lost removals and only reconciles a readable matching current state", async () => {
  const intent = prepareCharacterMedia(detail, { kind: "remove", mediaId: key }, key);
  h.delete.mockRejectedValueOnce(Error("Lost reply"));
  await expect(submitCharacterMedia(intent, "actor", 1, signal())).rejects.toThrow("Lost");
  await expect(submitCharacterMedia(intent, "actor", 1, signal())).rejects.toThrow("original");
  expect(characterMediaBox("other", 1, id).read()).toBeNull();
  h.get.mockRejectedValueOnce(Error("Not found"));
  await expect(reconcileCharacterMedia("actor", 1, id, signal())).rejects.toThrow("Not found");
  expect(characterMediaBox("actor", 1, id).read()).not.toBeNull();
  h.get.mockResolvedValue({ ...detail, media: [] });
  await reconcileCharacterMedia("actor", 1, id, signal());
  expect(characterMediaBox("actor", 1, id).read()).toBeNull();
  expect(h.delete).toHaveBeenCalledTimes(1);
});
it("uploads with the official workspace header and saves no signed URL", async () => {
  const result = await uploadCharacterMedia(workspaceId, id, "image", "actor", 1, key, signal());
  expect(result?.storageKey).toBe("staging/key");
  expect(h.post).toHaveBeenCalledWith(
    "/media/upload-url",
    expect.objectContaining({
      headers: { "x-fizz-workspace-id": workspaceId },
      data: {
        kind: "ai_reference_image",
        contentType: "image/png",
        fileName: "image.png",
        sizeBytes: 100,
      },
      retry: false,
    })
  );
  expect(h.put).toHaveBeenCalledWith(
    "https://storage.test/put",
    { "Content-Type": "image/png" },
    expect.any(AbortSignal)
  );
  expect(characterUploadStore("actor", 1, id).read()).toEqual(result);
  expect([...h.records.values()].join("")).not.toContain("https://");
});
it("enforces file limits, credential-free storage and enrollment before upload", async () => {
  h.selected.mockResolvedValueOnce({ size: 31 * 1024 ** 2, put: h.put });
  await expect(
    uploadCharacterMedia(workspaceId, id, "image", "actor", 1, key, signal())
  ).rejects.toThrow("30 MiB");
  expect(h.post).not.toHaveBeenCalled();
  h.post.mockResolvedValueOnce({ ...signed, headers: { Authorization: "secret" } });
  await expect(
    uploadCharacterMedia(workspaceId, id, "image", "actor", 1, key, signal())
  ).rejects.toThrow("credentials");
  expect(h.put).not.toHaveBeenCalled();
  h.get.mockResolvedValueOnce({ ...detail, kind: "real_person", status: "draft" });
  await expect(
    uploadCharacterMedia(workspaceId, id, "image", "actor", 1, key, signal())
  ).rejects.toThrow("identity");
});
it("accepts library video masters above generation limits and preserves the 2 GiB cap", async () => {
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///movie.mov", name: "movie.mov", mimeType: "video/quicktime" }],
  });
  h.selected.mockResolvedValue({ size: 1024 ** 3, put: h.put });
  await uploadCharacterMedia(workspaceId, id, "video", "actor", 1, key, signal());
  expect(characterUploadStore("actor", 1, id).read()?.kind).toBe("video");
  characterUploadStore("actor", 1, id).clear(key);
  h.selected.mockResolvedValue({ size: 2 * 1024 ** 3 + 1, put: h.put });
  await expect(
    uploadCharacterMedia(workspaceId, id, "video", "actor", 1, key, signal())
  ).rejects.toThrow("2048");
});
it("resumes confirmation then attachment without repicking or uploading bytes", async () => {
  await uploadCharacterMedia(workspaceId, id, "image", "actor", 1, key, signal());
  h.post.mockRejectedValueOnce(Error("Confirm reply lost"));
  await expect(finishCharacterUpload("actor", 1, id, signal())).rejects.toThrow("Confirm");
  expect(characterUploadStore("actor", 1, id).read()?.assetId).toBeUndefined();
  const attached = {
    ...detail,
    media: [...detail.media, { ...media, id: second, mediaAssetId: second, sortOrder: 1 }],
  };
  h.post
    .mockResolvedValueOnce({ mediaAssetId: second, storageKey: "verified/final" })
    .mockResolvedValueOnce(attached);
  expect(await finishCharacterUpload("actor", 1, id, signal())).toEqual(attached);
  expect(characterUploadStore("actor", 1, id).read()).toBeNull();
  expect(h.pick).toHaveBeenCalledTimes(1);
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledWith(
    "/media/confirm",
    expect.objectContaining({
      headers: { "x-fizz-workspace-id": workspaceId },
      data: { storageKey: "staging/key", kind: "ai_reference_image", contentType: "image/png" },
    })
  );
});
it("does not replay an uncertain attach after later removal", async () => {
  await uploadCharacterMedia(workspaceId, id, "image", "actor", 1, key, signal());
  h.post
    .mockResolvedValueOnce({ mediaAssetId: second, storageKey: "verified/final" })
    .mockRejectedValueOnce(Error("Lost attach"));
  await expect(finishCharacterUpload("actor", 1, id, signal())).rejects.toThrow("Lost");
  const calls = h.post.mock.calls.length;
  await expect(finishCharacterUpload("actor", 1, id, signal())).rejects.toThrow("uncertain");
  expect(h.post).toHaveBeenCalledTimes(calls);
  h.get.mockResolvedValue({
    ...detail,
    media: [...detail.media, { ...media, id: second, mediaAssetId: second, sortOrder: 1 }],
  });
  await finishCharacterUpload("actor", 1, id, signal());
  expect(characterUploadStore("actor", 1, id).read()).toBeNull();
  expect(h.post).toHaveBeenCalledTimes(calls);
});
it("checks current attachment before private preview and retains late-account requests", async () => {
  await expect(previewCharacterMedia(workspaceId, id, second, 1, signal())).rejects.toThrow(
    "attached"
  );
  expect(h.access).not.toHaveBeenCalled();
  expect(await previewCharacterMedia(workspaceId, id, key, 1, signal())).toEqual({
    url: "https://storage.test/read",
    kind: "image",
  });
  h.patch.mockImplementation(async () => {
    h.generation = 2;
    return { ...detail, coverAssetId: asset };
  });
  await expect(
    submitCharacterMedia(
      prepareCharacterMedia(detail, { kind: "cover", assetId: asset }, key),
      "actor",
      1,
      signal()
    )
  ).rejects.toThrow();
  h.generation = 1;
  expect(characterMediaBox("actor", 1, id).read()).not.toBeNull();
});
