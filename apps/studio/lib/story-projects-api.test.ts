import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiRequestError: class ApiRequestError extends Error {},
}));

import { api } from "@/lib/api";
import {
  cancelFilmVideoGeneration,
  cancelStoryClipVideoUpload,
  completeStoryClipVideoUpload,
  createFilmClipGeneration,
  createFilmTrailerGeneration,
  getStoryExperienceCurrentRelease,
  getStoryClipVideoUploadFinalization,
  getStoryWorkingPreview,
  listStoryVideoLibrary,
  putFilmClipCurrentVideo,
  putFilmTrailerCurrentVideo,
  retryFilmVideoGeneration,
  type StoryClipVideoFinalization,
  type StoryVideoLibraryItem,
  waitForStoryClipVideoUploadFinalization,
} from "./story-projects-api";

describe("current-draft Story production routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts one generation from the exact saved draft revision", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: "generation-1" });

    await createFilmClipGeneration(
      "workspace-1",
      "project-1",
      "clip-1",
      { expectedDraftRevision: 18, modelId: "seedance-2", variationNote: "slower camera" },
      "idempotency-1"
    );

    expect(api.post).toHaveBeenCalledWith(
      "/aurora/story-projects/project-1/clips/clip-1/generations",
      expect.objectContaining({
        data: {
          expectedDraftRevision: 18,
          modelId: "seedance-2",
          variationNote: "slower camera",
        },
      })
    );
  });

  it("binds one current video with both authoring revisions", async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ id: "clip-1" });

    await putFilmClipCurrentVideo("workspace-1", "project / one", "clip / one", {
      expectedDraftRevision: 18,
      expectedCurrentVideoRevision: 3,
      assetId: "00000000-0000-4000-8000-000000000001",
      variantId: "00000000-0000-4000-8000-000000000002",
    });

    expect(api.put).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/clips/clip%20%2F%20one/current-video",
      {
        data: {
          expectedDraftRevision: 18,
          expectedCurrentVideoRevision: 3,
          assetId: "00000000-0000-4000-8000-000000000001",
          variantId: "00000000-0000-4000-8000-000000000002",
        },
        headers: { "x-fizz-workspace-id": "workspace-1" },
      }
    );
  });

  it("lists reusable workspace videos through the project-scoped library", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [videoLibraryItem()],
      nextCursor: "next-page",
    });

    const page = await listStoryVideoLibrary("workspace-1", "project / one", {
      cursor: "cursor / one",
      limit: 24,
    });

    expect(page.nextCursor).toBe("next-page");
    expect(page.items).toHaveLength(1);
    expect(api.get).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/video-library",
      {
        params: { cursor: "cursor / one", limit: 24 },
        headers: { "x-fizz-workspace-id": "workspace-1" },
      }
    );
  });

  it("starts abortable asynchronous clip-video finalization", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(videoFinalization("queued"));
    const controller = new AbortController();

    const finalization = await completeStoryClipVideoUpload(
      "workspace-1",
      "project / one",
      {
        mediaAssetId: "00000000-0000-4000-8000-000000000001",
      },
      controller.signal
    );

    expect(finalization.status).toBe("queued");
    expect(api.post).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/video-library/uploads/complete",
      {
        data: { mediaAssetId: "00000000-0000-4000-8000-000000000001" },
        headers: { "x-fizz-workspace-id": "workspace-1" },
        signal: controller.signal,
      }
    );
  });

  it("accepts an idempotent ready response without polling", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(videoFinalization("ready"));

    const finalization = await completeStoryClipVideoUpload("workspace-1", "project-1", {
      mediaAssetId: "00000000-0000-4000-8000-000000000001",
    });
    const item = await waitForStoryClipVideoUploadFinalization(
      "workspace-1",
      "project-1",
      finalization
    );

    expect(item.variantKey).toBe("original");
    expect(api.get).not.toHaveBeenCalled();
  });

  it("polls the project-scoped finalization resource", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(videoFinalization("ready"));
    const controller = new AbortController();

    const finalization = await getStoryClipVideoUploadFinalization(
      "workspace-1",
      "project / one",
      "00000000-0000-4000-8000-000000000001",
      controller.signal
    );

    expect(finalization.item?.variantKey).toBe("original");
    expect(api.get).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/video-library/uploads/00000000-0000-4000-8000-000000000001",
      {
        headers: { "x-fizz-workspace-id": "workspace-1" },
        signal: controller.signal,
      }
    );
  });

  it("cancels an abandoned upload with a fresh bounded request", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({
      mediaAssetId: "00000000-0000-4000-8000-000000000001",
      status: "cancelled",
      pollAfterMs: null,
      item: null,
      error: {
        code: "STORY_VIDEO_UPLOAD_CANCELLED",
        message: "The Story video upload was cancelled.",
      },
    });

    await cancelStoryClipVideoUpload(
      "workspace-1",
      "project / one",
      "00000000-0000-4000-8000-000000000001"
    );

    expect(api.delete).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/video-library/uploads/00000000-0000-4000-8000-000000000001",
      {
        headers: { "x-fizz-workspace-id": "workspace-1" },
        timeout: 5_000,
      }
    );
  });

  it("waits through queued and processing states and returns the ready library item", async () => {
    vi.useFakeTimers();
    vi.mocked(api.get)
      .mockResolvedValueOnce(videoFinalization("processing"))
      .mockResolvedValueOnce(videoFinalization("ready"));
    const statuses: string[] = [];

    const pending = waitForStoryClipVideoUploadFinalization(
      "workspace-1",
      "project-1",
      videoFinalization("queued"),
      { onStatus: (state) => statuses.push(state.status) }
    );
    await vi.advanceTimersByTimeAsync(1_500);
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(pending).resolves.toMatchObject({ variantKey: "original" });
    expect(statuses).toEqual(["queued", "processing", "ready"]);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("surfaces the terminal processing error verbatim", async () => {
    await expect(
      waitForStoryClipVideoUploadFinalization(
        "workspace-1",
        "project-1",
        videoFinalization("failed")
      )
    ).rejects.toMatchObject({
      code: "VIDEO_PROBE_FAILED",
      message: "The uploaded file is not a valid video.",
    });
  });

  it("stops polling immediately when the caller aborts", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = waitForStoryClipVideoUploadFinalization(
      "workspace-1",
      "project-1",
      videoFinalization("queued"),
      { signal: controller.signal }
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(api.get).not.toHaveBeenCalled();
  });

  it("does not return an already-ready item after the caller has aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      waitForStoryClipVideoUploadFinalization(
        "workspace-1",
        "project-1",
        videoFinalization("ready"),
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails loud when the video library violates its ready-original contract", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [
        {
          ...videoLibraryItem(),
          checksumSha256: null,
        },
      ],
      nextCursor: null,
    });

    await expect(listStoryVideoLibrary("workspace-1", "project-1")).rejects.toThrow(
      "invalid video library item"
    );
  });

  it.each([
    { createdAt: "not-a-date" },
    { asset: { ...videoLibraryItem().asset, previewUrl: 42 } },
    { variantKey: "proxy" },
  ])("rejects malformed video library fields: %o", async (patch) => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [{ ...videoLibraryItem(), ...patch }],
      nextCursor: null,
    });

    await expect(listStoryVideoLibrary("workspace-1", "project-1")).rejects.toThrow(
      "invalid video library item"
    );
  });

  it("cancels and retries a generation using its optimistic version", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "generation-1" });

    await cancelFilmVideoGeneration("workspace-1", "project-1", "generation / one", {
      expectedGenerationVersion: 4,
    });
    await retryFilmVideoGeneration(
      "workspace-1",
      "project-1",
      "generation / one",
      { expectedGenerationVersion: 5, variationNote: "steadier camera" },
      "idempotency-retry"
    );

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      "/aurora/story-projects/project-1/generations/generation%20%2F%20one/cancel",
      expect.objectContaining({ data: { expectedGenerationVersion: 4 } })
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/aurora/story-projects/project-1/generations/generation%20%2F%20one/retry",
      expect.objectContaining({
        data: { expectedGenerationVersion: 5, variationNote: "steadier camera" },
      })
    );
  });

  it("uses the dedicated trailer generation and current-video routes", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: "trailer-generation-1" });
    vi.mocked(api.put).mockResolvedValueOnce({ id: "trailer-1" });

    await createFilmTrailerGeneration(
      "workspace-1",
      "project-1",
      "revision / one",
      { expectedTrailerVersion: 2, modelId: "seedance-2" },
      "idempotency-trailer"
    );
    await putFilmTrailerCurrentVideo("workspace-1", "project-1", "revision / one", {
      expectedCurrentVideoRevision: 6,
      assetId: null,
      variantId: null,
    });

    expect(api.post).toHaveBeenCalledWith(
      "/aurora/story-projects/project-1/revisions/revision%20%2F%20one/trailer/generations",
      expect.objectContaining({ data: { expectedTrailerVersion: 2, modelId: "seedance-2" } })
    );
    expect(api.put).toHaveBeenCalledWith(
      "/aurora/story-projects/project-1/revisions/revision%20%2F%20one/trailer/current-video",
      expect.objectContaining({
        data: {
          expectedCurrentVideoRevision: 6,
          assetId: null,
          variantId: null,
        },
      })
    );
  });

  it("loads the ephemeral working preview from the latest saved authoring head", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      draftRevision: 18,
      runtime: null,
      diagnostics: [],
      pathReport: null,
    });

    await getStoryWorkingPreview("workspace-1", "project-1");

    expect(api.get).toHaveBeenCalledWith("/aurora/story-projects/project-1/working-preview", {
      headers: { "x-fizz-workspace-id": "workspace-1" },
    });
  });

  it("loads Java-authoritative current release identity for the project", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      projectId: "project / one",
      gameId: "project / one",
      published: true,
      currentVersion: "build:build-1",
      manifestUrl: "https://media.example.test/manifest.json",
      currentBuild: {
        id: "build-1",
        sourceRevisionId: "revision-1",
        sourceDraftRevision: 18,
        sourceProductionRevision: 7,
      },
      checkedAt: "2026-07-16T12:00:00.000Z",
    });

    await getStoryExperienceCurrentRelease("workspace-1", "project / one");

    expect(api.get).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/releases/current",
      { headers: { "x-fizz-workspace-id": "workspace-1" } }
    );
  });
});

function videoLibraryItem(): StoryVideoLibraryItem {
  return {
    asset: {
      id: "asset-1",
      kind: "video",
      status: "ready",
      moderationStatus: "approved",
      contentType: "video/mp4",
      width: 1920,
      height: 1080,
      durationSeconds: 12,
      checksumSha256: "asset-checksum",
      previewUrl: "https://example.test/video.mp4",
    },
    variantId: "variant-1",
    variantKey: "original",
    contentType: "video/mp4",
    width: 1920,
    height: 1080,
    durationSeconds: 12,
    checksumSha256: "variant-checksum",
    createdAt: "2026-07-15T12:00:00.000Z",
  };
}

function videoFinalization(
  status: "queued" | "processing" | "ready" | "failed"
): StoryClipVideoFinalization {
  const mediaAssetId = "00000000-0000-4000-8000-000000000001";
  if (status === "queued" || status === "processing") {
    return {
      mediaAssetId,
      status,
      pollAfterMs: 1_500,
      item: null,
      error: null,
    };
  }
  if (status === "ready") {
    return {
      mediaAssetId,
      status,
      pollAfterMs: null,
      item: videoLibraryItem(),
      error: null,
    };
  }
  return {
    mediaAssetId,
    status,
    pollAfterMs: null,
    item: null,
    error: {
      code: "VIDEO_PROBE_FAILED",
      message: "The uploaded file is not a valid video.",
    },
  };
}
