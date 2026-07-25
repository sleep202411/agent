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
  archiveStoryChapter,
  addStoryCandidateAsset,
  cancelStoryClipVideoUpload,
  completeStoryClipVideoUpload,
  createStoryProject,
  getStoryExperienceCurrentRelease,
  getStoryCandidateAssets,
  getStoryProductionCanvas,
  getStoryClipVideoUploadFinalization,
  getStoryWorkingPreview,
  listStoryProjects,
  putStoryCanvasLayout,
  putStoryProductionCanvas,
  putStoryClipCurrentVideo,
  removeStoryCandidateAsset,
  updateStoryChapter,
  type StoryClipVideoFinalization,
  type StoryCandidateAsset,
  type CreatableStoryFormat,
  type StoryProductionCanvas,
  type StoryProjectSummary,
  type StoryVideoLibraryItem,
  waitForStoryClipVideoUploadFinalization,
} from "./story-projects-api";

describe("current-draft Story production routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists cinematic and text-adventure projects without a format filter", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [storyProject("interactive_film"), storyProject("text_adventure")],
      nextCursor: null,
    });

    const page = await listStoryProjects("workspace-1", { limit: 100 });

    expect(page.items.map((project) => project.format)).toEqual([
      "interactive_film",
      "text_adventure",
    ]);
    expect(api.get).toHaveBeenCalledWith("/aurora/story-projects", {
      params: { limit: 100 },
      headers: { "x-fizz-workspace-id": "workspace-1" },
    });
  });

  it("creates a text-adventure project without a video frame contract", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ project: storyProject("text_adventure") });

    await expect(
      createStoryProject("workspace-1", {
        format: "text_adventure",
        title: "The Archive",
        summary: null,
        defaultLocale: "en-US",
        visibility: "private",
      })
    ).resolves.toMatchObject({ format: "text_adventure", frameProfile: null });
    expect(api.post).toHaveBeenCalledWith("/aurora/story-projects", {
      data: {
        format: "text_adventure",
        title: "The Archive",
        summary: null,
        defaultLocale: "en-US",
        visibility: "private",
      },
      headers: { "x-fizz-workspace-id": "workspace-1" },
    });
  });

  it("creates an interactive-film project with its required frame contract", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ project: storyProject("interactive_film") });

    await expect(
      createStoryProject("workspace-1", {
        format: "interactive_film",
        frameProfile: "portrait_9_16",
        title: "Moving Pictures",
        summary: null,
        defaultLocale: "en-US",
        visibility: "private",
      })
    ).resolves.toMatchObject({ format: "interactive_film", frameProfile: "portrait_9_16" });
    expect(api.post).toHaveBeenCalledWith("/aurora/story-projects", {
      data: {
        format: "interactive_film",
        frameProfile: "portrait_9_16",
        title: "Moving Pictures",
        summary: null,
        defaultLocale: "en-US",
        visibility: "private",
      },
      headers: { "x-fizz-workspace-id": "workspace-1" },
    });
  });

  it("renames a chapter without sending a chapter-version token", async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({ id: "chapter-1" });

    await updateStoryChapter("workspace-1", "project-1", "chapter-1", {
      title: "A New Name",
    });

    expect(api.patch).toHaveBeenCalledWith("/aurora/story-projects/project-1/chapters/chapter-1", {
      data: { title: "A New Name" },
      headers: { "x-fizz-workspace-id": "workspace-1" },
    });
  });

  it("archives a chapter without sending a request body", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: "chapter-1" });

    await archiveStoryChapter("workspace-1", "project-1", "chapter-1");

    expect(api.post).toHaveBeenCalledWith(
      "/aurora/story-projects/project-1/chapters/chapter-1/archive",
      { headers: { "x-fizz-workspace-id": "workspace-1" } }
    );
  });

  it("forwards keepalive for the final canvas-layout pagehide flush", async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ revision: 8 });

    await putStoryCanvasLayout(
      "workspace-1",
      "project-1",
      "chapter-1",
      {
        expectedRevision: 7,
        nodePositions: { "clip:opening": { x: 120, y: 240 } },
        sessionId: "session-1",
      },
      { keepalive: true }
    );

    expect(api.put).toHaveBeenCalledWith(
      "/aurora/story-projects/project-1/chapters/chapter-1/canvas-layout",
      expect.objectContaining({
        keepalive: true,
        data: expect.objectContaining({
          expectedRevision: 7,
          sessionId: "session-1",
        }),
      })
    );
  });

  it("reads and writes the project-wide production canvas independently of chapters", async () => {
    const content = {
      nodes: [
        {
          id: "note-1",
          type: "note",
          position: { x: 10, y: 20 },
          data: { text: "Continuity" },
        },
        {
          id: "note-2",
          type: "note",
          position: { x: 280, y: 20 },
          data: { text: "Lighting reference" },
        },
      ],
      edges: [],
      assets: [],
      groups: [{ id: "opening", nodeIds: ["note-1", "note-2"], color: "slate" }],
    } satisfies StoryProductionCanvas["content"];
    const controller = new AbortController();
    const response = productionCanvas("project / one", content);
    vi.mocked(api.get).mockResolvedValueOnce(response);
    vi.mocked(api.put).mockResolvedValueOnce(response);

    await getStoryProductionCanvas("workspace-1", "project / one", controller.signal);
    await putStoryProductionCanvas("workspace-1", "project / one", content, "session-1", {
      keepalive: true,
    });

    expect(api.get).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/production-canvas",
      {
        headers: { "x-fizz-workspace-id": "workspace-1" },
        signal: controller.signal,
      }
    );
    expect(api.put).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/production-canvas",
      {
        data: {
          schemaVersion: "story-production-canvas-v2",
          content,
          sessionId: "session-1",
        },
        headers: { "x-fizz-workspace-id": "workspace-1" },
        keepalive: true,
      }
    );
  });

  it("rejects a production canvas response with dangling graph references", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      productionCanvas("project-1", {
        nodes: [],
        edges: [
          {
            id: "edge-1",
            source: "missing-source",
            target: "missing-target",
          },
        ],
        assets: [],
        groups: [],
      })
    );

    await expect(getStoryProductionCanvas("workspace-1", "project-1")).rejects.toThrow(
      "invalid production canvas"
    );
  });

  it("lists, adds, and removes project candidate assets by durable media id", async () => {
    const candidate = candidateAsset();
    const controller = new AbortController();
    vi.mocked(api.get).mockResolvedValueOnce([candidate]);
    vi.mocked(api.put).mockResolvedValueOnce(candidate);
    vi.mocked(api.delete).mockResolvedValueOnce({ mediaAssetId: candidate.asset.id });

    await expect(
      getStoryCandidateAssets("workspace-1", "project / one", controller.signal)
    ).resolves.toEqual([candidate]);
    await expect(
      addStoryCandidateAsset("workspace-1", "project / one", candidate.asset.id)
    ).resolves.toEqual(candidate);
    await expect(
      removeStoryCandidateAsset("workspace-1", "project / one", candidate.asset.id)
    ).resolves.toEqual({ mediaAssetId: candidate.asset.id });

    const path =
      "/aurora/story-projects/project%20%2F%20one/candidate-assets/00000000-0000-4000-8000-000000000011";
    expect(api.get).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/candidate-assets",
      {
        headers: { "x-fizz-workspace-id": "workspace-1" },
        signal: controller.signal,
      }
    );
    expect(api.put).toHaveBeenCalledWith(path, {
      headers: { "x-fizz-workspace-id": "workspace-1" },
    });
    expect(api.delete).toHaveBeenCalledWith(path, {
      headers: { "x-fizz-workspace-id": "workspace-1" },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("binds one current video with both authoring revisions", async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ id: "clip-1" });

    await putStoryClipCurrentVideo("workspace-1", "project / one", "clip / one", {
      expectedDraftRevision: 18,
      expectedSelectionVersion: 3,
      assetId: "00000000-0000-4000-8000-000000000001",
      variantId: "00000000-0000-4000-8000-000000000002",
    });

    expect(api.put).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/clips/clip%20%2F%20one/current-video",
      {
        data: {
          expectedDraftRevision: 18,
          expectedSelectionVersion: 3,
          assetId: "00000000-0000-4000-8000-000000000001",
          variantId: "00000000-0000-4000-8000-000000000002",
        },
        headers: { "x-fizz-workspace-id": "workspace-1" },
      }
    );
  });

  it("accepts a candidate video whose advisory duration is absent", async () => {
    const candidate = candidateAsset();
    vi.mocked(api.get).mockResolvedValueOnce([
      {
        ...candidate,
        videoVariant: {
          ...candidate.videoVariant!,
          durationSeconds: null,
        },
      },
    ]);

    await expect(getStoryCandidateAssets("workspace-1", "project-1")).resolves.toEqual([
      expect.objectContaining({
        videoVariant: expect.objectContaining({ durationSeconds: null }),
      }),
    ]);
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

  it("loads the ephemeral working preview from the latest saved authoring head", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      draftRevision: 18,
      contentHash: "b".repeat(64),
      videoSnapshotHash: "a".repeat(64),
      runtimeSchemaVersion: 2,
      runtime: null,
      diagnostics: [],
      pathReport: null,
      sources: [],
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
        sourceDraftRevision: 18,
        videoSnapshotHash: "a".repeat(64),
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

function storyProject(format: CreatableStoryFormat): StoryProjectSummary {
  return {
    id: `project-${format}`,
    workspaceId: "workspace-1",
    format,
    frameProfile: format === "text_adventure" ? null : "portrait_9_16",
    status: "active",
    visibility: "private",
    title: format === "text_adventure" ? "The Archive" : "Moving Pictures",
    summary: null,
    defaultLocale: "en-US",
    cover: null,
    tags: [],
    sourceIpId: null,
    projectVersion: 0,
    draftRevision: 0,
    production: {
      referenceSlotCount: 0,
      approvedReferenceCount: 0,
      clipCount: 0,
      currentVideoCount: 0,
      latestBuildStatus: null,
    },
    capabilities: ["story.read", "story.edit"],
    createdAt: "2026-07-19T12:00:00.000Z",
    updatedAt: "2026-07-19T12:00:00.000Z",
  };
}

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

function candidateAsset(): StoryCandidateAsset {
  return {
    asset: {
      id: "00000000-0000-4000-8000-000000000011",
      kind: "video",
      status: "ready",
      moderationStatus: "approved",
      contentType: "video/mp4",
      width: 1920,
      height: 1080,
      durationSeconds: 12,
      checksumSha256: "asset-checksum",
      previewUrl: "https://example.test/candidate.mp4",
    },
    videoVariant: {
      id: "00000000-0000-4000-8000-000000000012",
      variantKey: "original",
      contentType: "video/mp4",
      width: 1920,
      height: 1080,
      durationSeconds: 12,
      checksumSha256: "a".repeat(64),
    },
    addedByUserId: "user-1",
    addedAt: "2026-07-23T12:00:00.000Z",
  };
}

function productionCanvas(
  projectId: string,
  content: StoryProductionCanvas["content"]
): StoryProductionCanvas {
  return {
    projectId,
    schemaVersion: "story-production-canvas-v2",
    content,
    updatedByUserId: "user-1",
    updatedBySessionId: "session-1",
    createdAt: "2026-07-23T12:00:00.000Z",
    updatedAt: "2026-07-23T12:00:00.000Z",
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
