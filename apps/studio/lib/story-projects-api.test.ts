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
import { storyAgentRunFixture } from "@/app/[locale]/story-studio/_components/project-canvas/story-agent-run.test-fixtures";
import {
  archiveStoryChapter,
  cancelStoryVideoGeneration,
  cancelStoryClipVideoUpload,
  completeStoryClipVideoUpload,
  createStoryProject,
  createStoryClipVideoGeneration,
  createStoryTrailerVideoGeneration,
  getStoryExperienceCurrentRelease,
  getUndoableStoryAgentRun,
  getStoryClipVideoUploadFinalization,
  getStoryWorkingPreview,
  listStoryProjects,
  putStoryCanvasLayout,
  putStoryClipCurrentVideo,
  putStoryTrailerCurrentVideo,
  retryStoryAgentRunAuthoring,
  retryStoryVideoGeneration,
  updateStoryChapter,
  type StoryClipVideoFinalization,
  type CreatableStoryFormat,
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

  it("reads the independent Story Agent Undo data head without replacing /active", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(null);
    const controller = new AbortController();

    await expect(
      getUndoableStoryAgentRun("workspace-1", "project / one", undefined, controller.signal)
    ).resolves.toBeNull();
    expect(api.get).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/agent-runs/undoable",
      {
        headers: { "x-fizz-workspace-id": "workspace-1" },
        signal: controller.signal,
      }
    );
  });

  it("re-arms drafting through the retry-authoring lifecycle route", async () => {
    const authoring = storyAgentRunFixture("authoring");
    vi.mocked(api.post).mockResolvedValueOnce(authoring);

    await expect(
      retryStoryAgentRunAuthoring("workspace-1", "project / one", "run / one")
    ).resolves.toMatchObject({ id: authoring.id, status: "authoring" });
    expect(api.post).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/agent-runs/run%20%2F%20one/retry-authoring",
      {
        data: {},
        headers: { "x-fizz-workspace-id": "workspace-1" },
      }
    );
  });

  it("propagates a non-retryable retry-authoring conflict verbatim", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      Object.assign(new Error("The run is not retryable."), {
        status: 409,
        code: "STORY_AGENT_RUN_NOT_RETRYABLE",
      })
    );

    await expect(
      retryStoryAgentRunAuthoring("workspace-1", "project-1", "run-1")
    ).rejects.toMatchObject({
      status: 409,
      code: "STORY_AGENT_RUN_NOT_RETRYABLE",
    });
  });

  it("rejects a retry-authoring response that violates the run contract", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ ok: true });

    await expect(
      retryStoryAgentRunAuthoring("workspace-1", "project-1", "run-1")
    ).rejects.toThrow();
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
        storyWorldNodePresent: false,
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
          storyWorldNodePresent: false,
          sessionId: "session-1",
        }),
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts one generation from the exact saved draft revision", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: "generation-1" });

    await createStoryClipVideoGeneration(
      "workspace-1",
      "project-1",
      "clip-1",
      {
        expectedDraftRevision: 18,
        expectedSelectionVersion: 3,
        prompt: "Slower camera",
        modelId: "seedance-2",
        mode: "multimodal_to_video",
        durationMs: 10_000,
        references: [],
      },
      "idempotency-1"
    );

    expect(api.post).toHaveBeenCalledWith(
      "/aurora/story-projects/project-1/clips/clip-1/generations",
      expect.objectContaining({
        data: {
          expectedDraftRevision: 18,
          expectedSelectionVersion: 3,
          prompt: "Slower camera",
          modelId: "seedance-2",
          mode: "multimodal_to_video",
          durationMs: 10_000,
          references: [],
        },
      })
    );
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

  it("cancels and retries a generation using its optimistic version", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "generation-1" });

    await cancelStoryVideoGeneration("workspace-1", "project-1", "generation / one", {
      expectedGenerationVersion: 4,
    });
    await retryStoryVideoGeneration(
      "workspace-1",
      "project-1",
      "generation / one",
      {
        expectedGenerationVersion: 5,
        expectedSelectionVersion: 6,
        target: { kind: "clip", graphNodeId: "clip-1", expectedDraftRevision: 18 },
      },
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
        data: {
          expectedGenerationVersion: 5,
          expectedSelectionVersion: 6,
          target: { kind: "clip", graphNodeId: "clip-1", expectedDraftRevision: 18 },
        },
      })
    );
  });

  it("uses the dedicated trailer generation and current-video routes", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: "trailer-generation-1" });
    vi.mocked(api.put).mockResolvedValueOnce({ id: "trailer-1" });

    await createStoryTrailerVideoGeneration(
      "workspace-1",
      "project-1",
      {
        expectedSelectionVersion: 2,
        prompt: "Project trailer",
        modelId: "seedance-2",
        mode: "multimodal_to_video",
        durationMs: 10_000,
        references: [],
      },
      "idempotency-trailer"
    );
    await putStoryTrailerCurrentVideo("workspace-1", "project-1", {
      expectedSelectionVersion: 6,
      assetId: null,
      variantId: null,
    });

    expect(api.post).toHaveBeenCalledWith(
      "/aurora/story-projects/project-1/trailer/generations",
      expect.objectContaining({
        data: expect.objectContaining({ expectedSelectionVersion: 2, modelId: "seedance-2" }),
      })
    );
    expect(api.put).toHaveBeenCalledWith(
      "/aurora/story-projects/project-1/trailer/current-video",
      expect.objectContaining({
        data: {
          expectedSelectionVersion: 6,
          assetId: null,
          variantId: null,
        },
      })
    );
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
      generatingClipCount: 0,
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
