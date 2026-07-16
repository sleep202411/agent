import { beforeEach, describe, expect, it, vi } from "vitest";

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
  createFilmClipGeneration,
  createFilmTrailerGeneration,
  getStoryWorkingPreview,
  listStoryVideoLibrary,
  putFilmClipCurrentVideo,
  putFilmTrailerCurrentVideo,
  retryFilmVideoGeneration,
} from "./story-projects-api";

describe("current-draft Story production routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("loads the ephemeral working preview from the project authoring head", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      draftRevision: 18,
      runtime: null,
      diagnostics: [],
      pathReport: null,
    });

    await getStoryWorkingPreview("workspace-1", "project-1", 18);

    expect(api.get).toHaveBeenCalledWith(
      "/aurora/story-projects/project-1/working-preview",
      expect.objectContaining({ params: { expectedDraftRevision: 18 } })
    );
  });
});

function videoLibraryItem() {
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
