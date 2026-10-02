import { beforeEach, expect, it, vi } from "vitest";
import { uploadPlatformProjectCover } from "./platform-project-cover-upload";
const h = vi.hoisted(() => ({
  generation: 1,
  pick: vi.fn(),
  media: vi.fn(),
  put: vi.fn(),
  read: vi.fn(),
  post: vi.fn(),
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
vi.mock("@/features/ip-author/selected-media", () => ({ selectedMedia: h.media }));
vi.mock("./platform-projects-api", () => ({
  readPlatformProject: h.read,
  canEditPlatformProject: (p: { role: string }) => p.role === "editor",
}));
const id = "11111111-1111-4111-8111-111111111111",
  workspaceId = "22222222-2222-4222-8222-222222222222";
const project = {
  id,
  workspaceId,
  role: "editor" as const,
  version: 2,
  name: "Film",
  description: "",
  status: "active" as const,
  visibility: "private" as const,
  updatedAt: "2026-10-02T00:00:00Z",
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///image.jpg", name: "image.jpg", mimeType: "image/jpeg", size: 999 }],
  });
  h.media.mockResolvedValue({ size: 4, put: h.put });
  h.put.mockResolvedValue({ ok: true });
  h.read.mockResolvedValue(project);
  h.post
    .mockResolvedValueOnce({
      uploadUrl: "https://storage.example/image",
      method: "PUT",
      storageKey: "key",
      headers: { "x-storage": "signed" },
    })
    .mockResolvedValueOnce({ mediaAssetId: id });
});
it("uses actual bytes and the same workspace for signing and confirmation", async () => {
  const s = signal();
  expect(await uploadPlatformProjectCover(project, 1, s)).toBe(id);
  expect(h.post).toHaveBeenNthCalledWith(
    1,
    "/media/upload-url",
    expect.objectContaining({
      headers: { "x-fizz-workspace-id": workspaceId },
      data: {
        kind: "ai_reference_image",
        contentType: "image/jpeg",
        fileName: "image.jpg",
        sizeBytes: 4,
      },
    })
  );
  expect(h.post).toHaveBeenNthCalledWith(
    2,
    "/media/confirm",
    expect.objectContaining({
      headers: { "x-fizz-workspace-id": workspaceId },
      data: { storageKey: "key", kind: "ai_reference_image", contentType: "image/jpeg" },
    })
  );
  expect(h.put).toHaveBeenCalledWith(
    "https://storage.example/image",
    { "Content-Type": "image/jpeg", "x-storage": "signed" },
    s
  );
});
it("cancellation reserves no storage", async () => {
  h.pick.mockResolvedValue({ canceled: true });
  expect(await uploadPlatformProjectCover(project, 1, signal())).toBeNull();
  expect(h.post).not.toHaveBeenCalled();
});
it.each([0, 30 * 1024 ** 2 + 1])(
  "rejects invalid actual size %s before reservation",
  async (size) => {
    h.media.mockResolvedValue({ size, put: h.put });
    await expect(uploadPlatformProjectCover(project, 1, signal())).rejects.toThrow("30 MiB");
    expect(h.post).not.toHaveBeenCalled();
  }
);
it("rechecks project access after selecting an image", async () => {
  h.read.mockResolvedValue({ ...project, role: "viewer" });
  await expect(uploadPlatformProjectCover(project, 1, signal())).rejects.toThrow("permission");
  expect(h.post).not.toHaveBeenCalled();
});
it("does not continue in another account", async () => {
  h.pick.mockImplementation(async () => {
    h.generation = 2;
    return { canceled: true };
  });
  await expect(uploadPlatformProjectCover(project, 1, signal())).rejects.toThrow("account");
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects credential-bearing storage instructions", async () => {
  h.post.mockReset().mockResolvedValue({
    uploadUrl: "https://storage.example/image",
    method: "PUT",
    storageKey: "key",
    headers: { Authorization: "secret" },
  });
  await expect(uploadPlatformProjectCover(project, 1, signal())).rejects.toThrow("credentials");
  expect(h.put).not.toHaveBeenCalled();
});
