import { beforeEach, expect, it, vi } from "vitest";
import { uploadCanvasFile, confirmCanvasUpload } from "./story-canvas-upload";
import type { CanvasUploadCheckpoint } from "../../../../canvas-editor/upload-schema";
const h = vi.hoisted(() => ({
  source: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  confirm: vi.fn(),
  read: vi.fn(),
  platformRead: vi.fn(),
  generation: 1,
}));
vi.mock("@/features/ip-author/selected-media", () => ({ selectedMedia: h.source }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
vi.mock("@/lib/media-upload", () => ({ confirmMobileMediaUpload: h.confirm }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./story-canvas-document", () => ({ readStoryCanvasDocument: h.read }));
vi.mock("./platform-canvas-document", () => ({ readPlatformCanvasDocument: h.platformRead }));
const id = "00000000-0000-4000-8000-000000000001";
const scope = { projectId: id, documentId: id, generation: 1 };
const file = { uri: "file:///scene.mp4", name: "scene.mp4", type: "video/mp4", size: 1 };
const signed = {
  uploadUrl: "https://storage.example/file",
  method: "PUT",
  storageKey: "key",
  headers: { "x-upload": "signed" },
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.source.mockResolvedValue({ size: 1024, put: h.put });
  h.post.mockResolvedValue(signed);
  h.put.mockResolvedValue({ ok: true });
  h.confirm.mockResolvedValue({
    mediaAssetId: id,
    variantId: id,
    url: "https://storage.example/file",
  });
});
it.each([
  ["image/png", "image"],
  ["video/mp4", "video"],
  ["audio/mpeg", "audio"],
] as const)(
  "imports %s with scoped signing and checkpoint before confirmation",
  async (type, kind) => {
    const saved = vi.fn();
    const abort = signal();
    h.confirm.mockImplementation(async (confirmation) => {
      expect(saved.mock.calls[0]?.[0].confirmation).toEqual(confirmation);
      return { mediaAssetId: id, variantId: id, url: "https://storage.example/file" };
    });
    const result = await uploadCanvasFile(scope, { ...file, type }, abort, saved);
    expect(result).toMatchObject({
      kind,
      mediaAssetId: id,
      name: file.name,
      url: "https://storage.example/file",
    });
    expect(h.post).toHaveBeenCalledWith(
      "/media/upload-url",
      expect.objectContaining({
        data: {
          kind: `ai_reference_${kind}`,
          contentType: type,
          fileName: file.name,
          sizeBytes: 1024,
          scope: { storyProjectId: id },
        },
      })
    );
    expect(h.put).toHaveBeenCalledWith(
      signed.uploadUrl,
      { "Content-Type": type, "x-upload": "signed" },
      abort
    );
  }
);
it("recovers an uncertain confirmation without uploading bytes again", async () => {
  let checkpoint: CanvasUploadCheckpoint | undefined;
  h.confirm.mockRejectedValueOnce(Error("Lost confirmation"));
  await expect(
    uploadCanvasFile(scope, file, signal(), (saved) => {
      checkpoint = saved;
    })
  ).rejects.toThrow("Lost confirmation");
  expect(checkpoint).toBeDefined();
  const result = await confirmCanvasUpload(scope, checkpoint!, signal());
  expect(result.mediaAssetId).toBe(id);
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.confirm).toHaveBeenCalledTimes(2);
});
it.each([0, -1, NaN, 2048 * 1024 * 1024 + 1])(
  "rejects invalid actual size %s before signing",
  async (size) => {
    h.source.mockResolvedValue({ size, put: h.put });
    await expect(uploadCanvasFile(scope, file, signal(), vi.fn())).rejects.toThrow("2048 MiB");
    expect(h.post).not.toHaveBeenCalled();
  }
);
it.each(["image/png", "audio/wav"])("applies the smaller %s limit", async (type) => {
  h.source.mockResolvedValue({ size: 31 * 1024 * 1024, put: h.put });
  await expect(uploadCanvasFile(scope, { ...file, type }, signal(), vi.fn())).rejects.toThrow(
    "MiB"
  );
  expect(h.put).not.toHaveBeenCalled();
});
it.each([
  { uploadUrl: "http://storage.example/file" },
  { headers: { Cookie: "private" } },
  { method: "POST" },
])("rejects invalid storage grant %j", async (change) => {
  h.post.mockResolvedValue({ ...signed, ...change });
  await expect(uploadCanvasFile(scope, file, signal(), vi.fn())).rejects.toThrow();
  expect(h.put).not.toHaveBeenCalled();
});
it("does not confirm failed bytes or a failed checkpoint write", async () => {
  h.put.mockResolvedValueOnce({ ok: false, status: 503 });
  const checkpoint = vi.fn();
  await expect(uploadCanvasFile(scope, file, signal(), checkpoint)).rejects.toThrow("503");
  expect(checkpoint).not.toHaveBeenCalled();
  await expect(
    uploadCanvasFile(scope, file, signal(), () => {
      throw Error("Disk full");
    })
  ).rejects.toThrow("Disk full");
  expect(h.confirm).not.toHaveBeenCalled();
});
it("rejects a foreign recovery project and account changes", async () => {
  let checkpoint: CanvasUploadCheckpoint | undefined;
  await uploadCanvasFile(scope, file, signal(), (saved) => {
    checkpoint = saved;
  });
  h.confirm.mockClear();
  await expect(
    confirmCanvasUpload(
      { ...scope, projectId: "00000000-0000-4000-8000-000000000002" },
      checkpoint!,
      signal()
    )
  ).rejects.toThrow("project mismatch");
  h.generation++;
  await expect(confirmCanvasUpload(scope, checkpoint!, signal())).rejects.toThrow("expired");
  expect(h.confirm).not.toHaveBeenCalled();
});
it("stops before PUT after permission denial", async () => {
  h.read.mockRejectedValue(Error("Denied"));
  await expect(uploadCanvasFile(scope, file, signal(), vi.fn())).rejects.toThrow("Denied");
  expect(h.post).not.toHaveBeenCalled();
  expect(h.put).not.toHaveBeenCalled();
});
it("uses the file extension when the picker omits MIME, matching Web", async () => {
  await uploadCanvasFile(scope, { ...file, type: "", name: "Scene.MOV" }, signal(), vi.fn());
  expect(h.post).toHaveBeenCalledWith(
    "/media/upload-url",
    expect.objectContaining({ data: expect.objectContaining({ contentType: "video/quicktime" }) })
  );
});
it("rejects unsupported file formats before reading or reserving storage", async () => {
  await expect(
    uploadCanvasFile(
      scope,
      { ...file, type: "application/pdf", name: "script.pdf" },
      signal(),
      vi.fn()
    )
  ).rejects.toThrow("supported");
  expect(h.source).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
});

const platformScope = { ...scope, kind: "platform" as const, workspaceId: id, sectionId: id };
it("signs and confirms platform uploads with workspace headers, retaining exact retry data", async () => {
  let saved!: CanvasUploadCheckpoint;
  let confirmations = 0;
  h.post.mockImplementation(async (path, options) => {
    expect(options.headers).toEqual({ "x-fizz-workspace-id": id });
    expect(options.data.scope).toBeUndefined();
    if (path === "/media/upload-url") return signed;
    expect(saved.confirmation.storageKey).toBe(options.data.storageKey);
    if (++confirmations === 1) throw Error("Lost confirmation");
    return { mediaAssetId: id, url: "https://storage.example/file" };
  });
  await expect(
    uploadCanvasFile(platformScope, file, signal(), (value) => {
      saved = value;
    })
  ).rejects.toThrow("Lost confirmation");
  expect(saved.confirmation.scope).toEqual({
    workspaceId: id,
    projectId: id,
    sectionId: id,
    documentId: id,
  });
  expect((await confirmCanvasUpload(platformScope, saved, signal())).mediaAssetId).toBe(id);
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledTimes(3);
  expect(h.platformRead).toHaveBeenCalledWith(platformScope, expect.any(AbortSignal), true);
  expect(h.read).not.toHaveBeenCalled();
  expect(h.confirm).not.toHaveBeenCalled();
});
it.each(["workspaceId", "projectId", "sectionId", "documentId"])(
  "rejects a platform upload checkpoint from another %s before dispatch",
  async (field) => {
    const saved = {
      name: "scene.mp4",
      createdAt: 1,
      confirmation: {
        storageKey: "key",
        kind: "ai_reference_video" as const,
        contentType: "video/mp4",
        scope: {
          workspaceId: id,
          projectId: id,
          sectionId: id,
          documentId: id,
          [field]: "00000000-0000-4000-8000-000000000002",
        },
      },
    };
    await expect(confirmCanvasUpload(platformScope, saved, signal())).rejects.toThrow("mismatch");
    expect(h.post).not.toHaveBeenCalled();
  }
);
it("blocks platform upload before signing if editor access is revoked", async () => {
  h.platformRead.mockRejectedValue(Error("Access revoked"));
  await expect(uploadCanvasFile(platformScope, file, signal(), vi.fn())).rejects.toThrow(
    "Access revoked"
  );
  expect(h.post).not.toHaveBeenCalled();
  expect(h.put).not.toHaveBeenCalled();
});
