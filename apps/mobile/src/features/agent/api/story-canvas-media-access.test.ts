import { beforeEach, expect, it, vi } from "vitest";
import { loadCanvasMediaAccess } from "./story-canvas-media-access";
const h = vi.hoisted(() => ({ get: vi.fn(), read: vi.fn(), platformRead: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./story-canvas-document", () => ({ readStoryCanvasDocument: h.read }));
vi.mock("./platform-canvas-document", () => ({ readPlatformCanvasDocument: h.platformRead }));
const id = "11111111-1111-4111-8111-111111111111";
const scope = { projectId: id, documentId: id, generation: 1 };
const asset = {
  id: "entry",
  kind: "video" as const,
  url: "https://old.test/video",
  mediaAssetId: id,
};
const access = {
  assetId: id,
  variantKey: "original",
  url: "https://media.test/fresh",
  expiresAt: null,
};
const load = () => loadCanvasMediaAccess(scope, asset, new AbortController().signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue(access);
});
it("requests fresh original access using the canvas document grant", async () => {
  expect(await load()).toEqual({ url: access.url, expiresAt: null });
  expect(h.get).toHaveBeenCalledWith(
    `/media/assets/${id}/access`,
    expect.objectContaining({ params: { documentId: id, variantKey: "original" }, retry: false })
  );
  expect(h.read.mock.invocationCallOrder[0]).toBeLessThan(h.get.mock.invocationCallOrder[0]!);
});
it.each([
  { assetId: "22222222-2222-4222-8222-222222222222" },
  { variantKey: "thumbnail" },
  { url: "file:///private/movie" },
  { url: "https://user:secret@media.test/video" },
  { expiresAt: "2020-01-01T00:00:00Z" },
])("rejects unsafe or mismatched access %j", async (bad) => {
  h.get.mockResolvedValue({ ...access, ...bad });
  await expect(load()).rejects.toThrow();
});
it("does not fall back to a cached URL when document access is denied", async () => {
  h.read.mockRejectedValue(Error("Access revoked"));
  await expect(load()).rejects.toThrow("Access revoked");
  expect(h.get).not.toHaveBeenCalled();
});
it("retires responses after account changes", async () => {
  h.get.mockImplementation(async () => {
    h.generation++;
    return access;
  });
  await expect(load()).rejects.toThrow("expired");
});
it("supports URL-only canvas media without attaching API credentials", async () => {
  expect(
    await loadCanvasMediaAccess(
      scope,
      { ...asset, mediaAssetId: undefined },
      new AbortController().signal
    )
  ).toEqual({ url: asset.url, expiresAt: null });
  expect(h.get).not.toHaveBeenCalled();
});

const platformScope = { ...scope, kind: "platform" as const, workspaceId: id, sectionId: id };
it("validates platform section ownership before requesting its document media grant", async () => {
  const signal = new AbortController().signal;
  expect(await loadCanvasMediaAccess(platformScope, asset, signal)).toEqual({
    url: access.url,
    expiresAt: null,
  });
  expect(h.platformRead).toHaveBeenCalledWith(platformScope, signal);
  expect(h.read).not.toHaveBeenCalled();
  expect(h.platformRead.mock.invocationCallOrder[0]).toBeLessThan(
    h.get.mock.invocationCallOrder[0]!
  );
});
it("does not request or reuse media after platform access is revoked", async () => {
  h.platformRead.mockRejectedValue(Error("Access revoked"));
  await expect(
    loadCanvasMediaAccess(platformScope, asset, new AbortController().signal)
  ).rejects.toThrow("Access revoked");
  expect(h.get).not.toHaveBeenCalled();
  expect(h.read).not.toHaveBeenCalled();
});
