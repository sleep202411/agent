import { beforeEach, expect, it, vi } from "vitest";
import { timelineUpload } from "./story-timeline-upload";
const h = vi.hoisted(() => ({
  pick: vi.fn(),
  upload: vi.fn(),
  confirm: vi.fn(),
  put: vi.fn(),
  generation: 1,
  video: vi.fn(),
}));
vi.mock("./story-timeline-video-upload", () => ({ uploadTimelineVideo: h.video }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/media-upload", () => ({
  uploadMobileMediaFile: h.upload,
  confirmMobileMediaUpload: h.confirm,
}));
vi.mock("@/lib/api-client", () => ({ api: { put: h.put } }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const projectId = "00000000-0000-4000-8000-000000000001";
const mediaAssetId = "00000000-0000-4000-8000-000000000002";
const scope = { projectId, chapterId: projectId, generation: 1 };
const confirmation = {
  storageKey: "staging-key",
  kind: "ai_reference_image" as const,
  contentType: "image/png" as const,
  scope: { storyProjectId: projectId },
};
const candidate = {
  asset: {
    id: mediaAssetId,
    kind: "image",
    status: "ready",
    moderationStatus: "approved",
    contentType: "image/png",
    previewUrl: "https://example.com/image.png",
  },
};
let raw: string | null;
const storage = {
  read: () => raw,
  write: vi.fn((value: string) => {
    raw = value;
  }),
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  raw = null;
  h.generation = 1;
  storage.write.mockImplementation((v) => {
    raw = v;
  });
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///image.png", name: "image.png", mimeType: "image/png", size: 4 }],
  });
  h.upload.mockImplementation(async (_file, options) => {
    options.beforeConfirm(confirmation);
    return { mediaAssetId, url: "https://example.com/image.png" };
  });
  h.confirm.mockResolvedValue({ mediaAssetId, url: "https://example.com/image.png" });
  h.put.mockResolvedValue(candidate);
});
it("uploads into the exact project and verifies registration before clearing recovery", async () => {
  h.put.mockImplementation(async () => {
    expect(raw).toContain("staging-key");
    return candidate;
  });
  const store = timelineUpload(scope, "user", storage);
  expect(await store.pick(signal())).toEqual(candidate);
  expect(h.upload.mock.calls[0][1]).toMatchObject({
    scope: { storyProjectId: projectId },
    maxBytes: 30 * 1024 * 1024,
  });
  expect(h.put).toHaveBeenCalledWith(
    `/story-projects/${projectId}/candidate-assets/${mediaAssetId}`,
    expect.objectContaining({ retry: false })
  );
  expect(store.read()).toBeNull();
});
it.each(["confirmation", "registration"])(
  "recovers lost %s without selecting or uploading bytes again",
  async (step) => {
    if (step === "confirmation")
      h.upload.mockImplementationOnce(async (_f, o) => {
        o.beforeConfirm(confirmation);
        throw Error("Lost reply");
      });
    else h.put.mockRejectedValueOnce(Error("Lost reply"));
    await expect(timelineUpload(scope, "user", storage).pick(signal())).rejects.toThrow(
      "Lost reply"
    );
    const recovered = timelineUpload(scope, "user", storage);
    await expect(recovered.pick(signal())).rejects.toThrow("pending");
    await expect(recovered.resume(signal())).resolves.toEqual(candidate);
    expect(h.pick).toHaveBeenCalledOnce();
    expect(h.upload).toHaveBeenCalledOnce();
    expect(h.confirm).toHaveBeenCalledWith(confirmation, expect.any(AbortSignal));
    expect(recovered.read()).toBeNull();
  }
);
it.each(["id", "kind", "contentType", "status", "moderationStatus"])(
  "retains recovery on mismatched %s receipt",
  async (field) => {
    const value = {
      id: projectId,
      kind: "video",
      contentType: "image/jpeg",
      status: "uploading",
      moderationStatus: "blocked",
    }[field];
    h.put.mockResolvedValue({ asset: { ...candidate.asset, [field]: value } });
    const store = timelineUpload(scope, "user", storage);
    await expect(store.pick(signal())).rejects.toThrow("verified");
    expect(store.read()).not.toBeNull();
  }
);
it("does not confirm or register when recovery cannot be stored", async () => {
  storage.write.mockImplementation(() => {
    throw Error("Disk full");
  });
  await expect(timelineUpload(scope, "user", storage).pick(signal())).rejects.toThrow("Disk full");
  expect(h.put).not.toHaveBeenCalled();
  expect(h.confirm).not.toHaveBeenCalled();
});
it.each(["corrupt", "foreign"])("does not overwrite %s recovery", async (mode) => {
  raw =
    mode === "corrupt"
      ? "broken"
      : JSON.stringify({
          version: 1,
          intent: {
            clientKey: "staging-key",
            name: "image.png",
            confirmation: { ...confirmation, scope: { storyProjectId: mediaAssetId } },
          },
        });
  await expect(timelineUpload(scope, "user", storage).pick(signal())).rejects.toThrow();
  expect(storage.write).not.toHaveBeenCalled();
  expect(h.pick).not.toHaveBeenCalled();
});
it("abandons account changes and cancellation after the picker", async () => {
  h.pick.mockImplementation(async () => {
    h.generation = 2;
    return { canceled: false, assets: [] };
  });
  await expect(timelineUpload(scope, "user", storage).pick(signal())).rejects.toThrow("expired");
  expect(h.upload).not.toHaveBeenCalled();
});
it.each(["size", "mime"])("rejects invalid image %s before upload", async (field) => {
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: "file:///image.png",
        name: "image.png",
        mimeType: field === "mime" ? "video/webm" : "image/png",
        size: field === "size" ? 31 * 1024 * 1024 : 4,
      },
    ],
  });
  await expect(timelineUpload(scope, "user", storage).pick(signal())).rejects.toThrow();
  expect(h.upload).not.toHaveBeenCalled();
});
it("accepts picker cancellation without writes", async () => {
  h.pick.mockResolvedValue({ canceled: true });
  expect(await timelineUpload(scope, "user", storage).pick(signal())).toBeNull();
  expect(storage.write).not.toHaveBeenCalled();
});

it.each(["abort", "account"])(
  "retains recovery when %s changes after candidate registration",
  async (mode) => {
    const controller = new AbortController();
    h.put.mockImplementation(async () => {
      if (mode === "abort") controller.abort();
      else h.generation = 2;
      return candidate;
    });
    await expect(timelineUpload(scope, "user", storage).pick(controller.signal)).rejects.toThrow();
    expect(JSON.parse(raw!).intent.confirmation).toEqual(confirmation);
  }
);

it("uploads video with file-backed transfer and recovers confirmation using its original kind", async () => {
  const videoConfirmation = {
    ...confirmation,
    kind: "ai_reference_video",
    contentType: "video/mp4",
  };
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: "file:///video.mp4",
        name: "video.mp4",
        mimeType: "video/mp4",
        size: 1024 * 1024 * 1024,
      },
    ],
  });
  h.video.mockImplementation(async (_f, _s, _signal, save) => {
    save(videoConfirmation);
    throw Error("Lost video confirmation");
  });
  const store = timelineUpload(scope, "user", storage);
  await expect(store.pick(signal())).rejects.toThrow("Lost video confirmation");
  expect(h.upload).not.toHaveBeenCalled();
  h.put.mockResolvedValue({
    asset: { ...candidate.asset, kind: "video", contentType: "video/mp4" },
  });
  await store.resume(signal());
  expect(h.confirm).toHaveBeenCalledWith(videoConfirmation, expect.any(AbortSignal));
  expect(store.read()).toBeNull();
});

it("restricts asset uploads to images even if a picker returns a video", async () => {
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///video.mp4", name: "video.mp4", mimeType: "video/mp4", size: 4 }],
  });
  await expect(timelineUpload(scope, "user", storage).pick(signal(), true)).rejects.toThrow(
    "Select an image"
  );
  expect(h.pick.mock.calls[0][0].type).toEqual(["image/jpeg", "image/png", "image/webp"]);
  expect(h.video).not.toHaveBeenCalled();
  expect(h.upload).not.toHaveBeenCalled();
});

it("uploads an encoded file without a picker and recovers after a lost registration reply", async () => {
  const videoConfirmation = {
    ...confirmation,
    kind: "ai_reference_video",
    contentType: "video/mp4",
  };
  const videoCandidate = {
    asset: { ...candidate.asset, kind: "video", contentType: "video/mp4" },
  };
  h.video.mockImplementation(async (_file, _scope, _signal, save) => {
    save(videoConfirmation);
    return { mediaAssetId };
  });
  h.put.mockRejectedValueOnce(Error("Lost registration reply"));
  const file = { uri: "file:///export.mp4", name: "timeline.mp4", type: "video/mp4", size: 1024 };
  await expect(timelineUpload(scope, "user", storage).upload(file, signal())).rejects.toThrow(
    "Lost registration"
  );
  const recovered = timelineUpload(scope, "user", storage);
  await expect(recovered.upload(file, signal())).rejects.toThrow("pending");
  h.put.mockResolvedValue(videoCandidate);
  await expect(recovered.resume(signal())).resolves.toEqual(videoCandidate);
  expect(h.video).toHaveBeenCalledOnce();
  expect(h.video).toHaveBeenCalledWith(file, scope, expect.any(AbortSignal), expect.any(Function));
  expect(h.pick).not.toHaveBeenCalled();
  expect(h.upload).not.toHaveBeenCalled();
  expect(recovered.read()).toBeNull();
});

it.each([0, -1, NaN, 2048 * 1024 * 1024 + 1])(
  "rejects invalid encoded file size %s before transfer",
  async (size) => {
    await expect(
      timelineUpload(scope, "user", storage).upload(
        {
          uri: "file:///export.mp4",
          name: "timeline.mp4",
          type: "video/mp4",
          size,
        },
        signal()
      )
    ).rejects.toThrow();
    expect(h.video).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
  }
);
