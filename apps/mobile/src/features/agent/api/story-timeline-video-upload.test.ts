import { beforeEach, expect, it, vi } from "vitest";
import { uploadTimelineVideo } from "./story-timeline-video-upload";
const h = vi.hoisted(() => ({
  source: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  confirm: vi.fn(),
  generation: 1,
}));
vi.mock("@/features/ip-author/selected-media", () => ({ selectedMedia: h.source }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
vi.mock("@/lib/media-upload", () => ({ confirmMobileMediaUpload: h.confirm }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const projectId = "00000000-0000-4000-8000-000000000001";
const scope = { projectId, chapterId: projectId, generation: 1 };
const file = { uri: "file:///video.mp4", name: "video.mp4", type: "video/mp4", size: 1 };
const signed = {
  uploadUrl: "https://storage.example/video",
  method: "PUT",
  storageKey: "key",
  headers: { "x-upload": "signed" },
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.source.mockResolvedValue({ size: 1024 * 1024 * 1024, put: h.put });
  h.post.mockResolvedValue(signed);
  h.put.mockResolvedValue({ ok: true });
  h.confirm.mockResolvedValue({ mediaAssetId: projectId, url: "https://storage.example/video" });
});
it("uses actual file size, scoped signing, direct PUT and durable checkpoint before confirm", async () => {
  const saved = vi.fn();
  const signal = new AbortController().signal;
  h.confirm.mockImplementation(async (data) => {
    expect(saved).toHaveBeenCalledWith(data);
    return { mediaAssetId: projectId };
  });
  await uploadTimelineVideo(file, scope, signal, saved);
  expect(h.post).toHaveBeenCalledWith(
    "/media/upload-url",
    expect.objectContaining({
      data: {
        kind: "ai_reference_video",
        contentType: "video/mp4",
        fileName: "video.mp4",
        sizeBytes: 1024 * 1024 * 1024,
        scope: { storyProjectId: projectId },
      },
    })
  );
  expect(h.put).toHaveBeenCalledWith(
    signed.uploadUrl,
    { "Content-Type": "video/mp4", "x-upload": "signed" },
    signal
  );
  expect(saved).toHaveBeenCalledWith({
    storageKey: "key",
    kind: "ai_reference_video",
    contentType: "video/mp4",
    scope: { storyProjectId: projectId },
  });
});
it.each([0, -1, NaN, 2 * 1024 * 1024 * 1024 + 1])(
  "rejects invalid actual size %s before signing",
  async (size) => {
    h.source.mockResolvedValue({ size, put: h.put });
    await expect(
      uploadTimelineVideo(file, scope, new AbortController().signal, vi.fn())
    ).rejects.toThrow("2 GiB");
    expect(h.post).not.toHaveBeenCalled();
  }
);
it.each(["url", "credentials", "method"])("rejects invalid signing %s", async (field) => {
  h.post.mockResolvedValue({
    ...signed,
    ...(field === "url"
      ? { uploadUrl: "http://storage.example/video" }
      : field === "method"
        ? { method: "POST" }
        : { headers: { Authorization: "secret" } }),
  });
  await expect(
    uploadTimelineVideo(file, scope, new AbortController().signal, vi.fn())
  ).rejects.toThrow();
  expect(h.put).not.toHaveBeenCalled();
  expect(h.confirm).not.toHaveBeenCalled();
});
it("does not save or confirm failed bytes", async () => {
  h.put.mockResolvedValue({ ok: false, status: 503 });
  const save = vi.fn();
  await expect(
    uploadTimelineVideo(file, scope, new AbortController().signal, save)
  ).rejects.toThrow("503");
  expect(save).not.toHaveBeenCalled();
  expect(h.confirm).not.toHaveBeenCalled();
});
it("does not confirm if checkpoint cannot be saved", async () => {
  await expect(
    uploadTimelineVideo(file, scope, new AbortController().signal, () => {
      throw Error("Disk full");
    })
  ).rejects.toThrow("Disk full");
  expect(h.confirm).not.toHaveBeenCalled();
});
it.each(["abort", "account"])("stops after signing when %s changes", async (mode) => {
  const c = new AbortController();
  h.post.mockImplementation(async () => {
    if (mode === "abort") c.abort();
    else h.generation = 2;
    return signed;
  });
  await expect(uploadTimelineVideo(file, scope, c.signal, vi.fn())).rejects.toThrow();
  expect(h.put).not.toHaveBeenCalled();
});
