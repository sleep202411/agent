import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiRequestError: class ApiRequestError extends Error {
    public code: number | string;
    public status: number;
    public responseBody?: string;

    constructor(code: number | string, message: string, status: number, responseBody?: string) {
      super(message);
      this.code = code;
      this.status = status;
      this.responseBody = responseBody;
    }
  },
}));

import { api, ApiRequestError } from "@/lib/api";
import {
  createStoryReferenceSlots,
  updateStoryReferenceSlot,
  createStoryReferenceVersion,
  reviewStoryReferenceVersion,
  approveStoryReferenceVersion,
  archiveStoryChapter,
  addStoryCandidateAsset,
  createStoryProject,
  getStoryCandidateAssets,
  getStoryWorkingPreview,
  listStoryProjects,
  putStoryCanvasLayout,
  importStoryPlot,
  removeStoryCandidateAsset,
  storyApiErrorMessage,
  updateStoryChapter,
  type StoryCandidateAsset,
  type StoryProjectSummary,
} from "./story-projects-api";

describe("storyApiErrorMessage", () => {
  it("surfaces structured validation issues instead of the generic Zod summary", () => {
    const error = new ApiRequestError(
      "HTTP_400",
      "Validation failed",
      400,
      JSON.stringify({
        message: "Validation failed",
        issues: [
          {
            path: "content.graph.nodes.12.interactions.0.trigger",
            message: 'Invalid input: expected "tap"',
            code: "invalid_value",
          },
          {
            path: "content.graph.nodes.12.interactions.0.rect",
            message: "Hotspot must stay within the video frame.",
            code: "custom",
          },
        ],
      })
    );

    expect(storyApiErrorMessage(error, "Could not save draft.")).toBe(
      'content.graph.nodes.12.interactions.0.trigger: Invalid input: expected "tap"; ' +
        "content.graph.nodes.12.interactions.0.rect: Hotspot must stay within the video frame."
    );
  });

  it("keeps the upstream message when no structured validation issue exists", () => {
    const error = new ApiRequestError("DRAFT_LOCKED", "Draft is locked.", 409);

    expect(storyApiErrorMessage(error, "Could not save draft.")).toBe("Draft is locked.");
  });
});

describe("current-draft Story production routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists film projects without a legacy format filter", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [storyProject()],
      nextCursor: null,
    });

    const page = await listStoryProjects({ workspaceId: "workspace-1", limit: 100 });

    expect(page.items).toHaveLength(1);
    expect(api.get).toHaveBeenCalledWith("/aurora/story-projects", {
      params: { workspaceId: "workspace-1", limit: 100 },
      requestScope: "project",
    });
  });

  it("rejects a partial creative profile from the API", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [
        {
          ...storyProject(),
          durationPreset: "short_5_15",
        },
      ],
      nextCursor: null,
    });

    await expect(listStoryProjects({ workspaceId: "workspace-1", limit: 100 })).rejects.toThrow(
      "Story Studio API contract is out of date."
    );
  });

  it("creates an empty project without pretending the Agent intake is already answered", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ project: storyProject() });

    await expect(
      createStoryProject({
        workspaceId: "workspace-1",
        title: "Moving Pictures",
        summary: null,
        defaultLocale: "en-US",
        visibility: "private",
      })
    ).resolves.toMatchObject({ frameProfile: "landscape_16_9" });
    expect(api.post).toHaveBeenCalledWith("/aurora/story-projects", {
      data: {
        workspaceId: "workspace-1",
        title: "Moving Pictures",
        summary: null,
        defaultLocale: "en-US",
        visibility: "private",
      },
    });
  });

  it("renames a chapter without sending a chapter-version token", async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({ id: "chapter-1" });

    await updateStoryChapter("project-1", "chapter-1", {
      title: "A New Name",
    });

    expect(api.patch).toHaveBeenCalledWith("/aurora/story-projects/project-1/chapters/chapter-1", {
      data: { title: "A New Name" },
      requestScope: "project",
    });
  });

  it("archives a chapter without sending a request body", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: "chapter-1" });

    await archiveStoryChapter("project-1", "chapter-1");

    expect(api.post).toHaveBeenCalledWith(
      "/aurora/story-projects/project-1/chapters/chapter-1/archive",
      { requestScope: "project" }
    );
  });

  it("forwards keepalive for the final canvas-layout pagehide flush", async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ revision: 8 });

    await putStoryCanvasLayout(
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

  it("posts a plot import with the current chapter draft and parsed plot", async () => {
    const draft = { revision: 8, content: { graph: { nodes: [] } } };
    vi.mocked(api.post).mockResolvedValueOnce({
      draft,
      importedNodeIds: ["import:ns:opening"],
    });
    const plot = {
      entryNodeId: "opening",
      assets: [],
      nodes: [{ id: "opening", type: "scene" as const, title: "Opening", next: null }],
    };

    await expect(
      importStoryPlot("project-1", "chapter-1", {
        expectedRevision: 7,
        content: {
          storyBible: { logline: "", synopsis: "", characters: [] },
          graph: { entryNodeId: null, nodes: [] },
          productionNotes: [],
        },
        sessionId: "session-1",
        locale: "en-US",
        mode: "append",
        plot: plot as never,
      })
    ).resolves.toEqual({ draft, importedNodeIds: ["import:ns:opening"] });

    expect(api.post).toHaveBeenCalledWith(
      "/aurora/story-projects/project-1/chapters/chapter-1/plot-import",
      expect.objectContaining({
        requestScope: "project",
        data: expect.objectContaining({
          expectedRevision: 7,
          sessionId: "session-1",
          locale: "en-US",
          mode: "append",
        }),
      })
    );
  });

  it("lists, adds, and removes project candidate assets by durable media id", async () => {
    const candidate = candidateAsset();
    const controller = new AbortController();
    vi.mocked(api.get).mockResolvedValueOnce([candidate]);
    vi.mocked(api.put).mockResolvedValueOnce(candidate);
    vi.mocked(api.delete).mockResolvedValueOnce({ mediaAssetId: candidate.asset.id });

    await expect(getStoryCandidateAssets("project / one", controller.signal)).resolves.toEqual([
      candidate,
    ]);
    await expect(
      addStoryCandidateAsset("project / one", candidate.asset.id, controller.signal)
    ).resolves.toEqual(candidate);
    await expect(
      removeStoryCandidateAsset("project / one", candidate.asset.id, controller.signal)
    ).resolves.toEqual({
      mediaAssetId: candidate.asset.id,
    });

    const path =
      "/aurora/story-projects/project%20%2F%20one/candidate-assets/00000000-0000-4000-8000-000000000011";
    expect(api.get).toHaveBeenCalledWith(
      "/aurora/story-projects/project%20%2F%20one/candidate-assets",
      {
        requestScope: "project",
        signal: controller.signal,
      }
    );
    expect(api.put).toHaveBeenCalledWith(path, {
      requestScope: "project",
      signal: controller.signal,
    });
    expect(api.delete).toHaveBeenCalledWith(path, {
      requestScope: "project",
      signal: controller.signal,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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

    await getStoryWorkingPreview("project-1");

    expect(api.get).toHaveBeenCalledWith("/aurora/story-projects/project-1/working-preview", {
      requestScope: "project",
    });
  });

  it("sends the clicked scene with the chapter being played", async () => {
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

    await getStoryWorkingPreview("project-1", "chapter-1", "clip:scene-1");

    expect(api.get).toHaveBeenCalledWith("/aurora/story-projects/project-1/working-preview", {
      params: { chapterId: "chapter-1", sceneId: "clip:scene-1" },
      requestScope: "project",
    });
  });
});

function storyProject(): StoryProjectSummary {
  return {
    canMove: true,
    id: "project-film",
    workspaceId: "workspace-1",
    frameProfile: "landscape_16_9",
    frameProfileMutable: true,
    durationPreset: null,
    visualStyle: null,
    creativeProfileConfirmedAt: null,
    status: "active",
    visibility: "private",
    title: "Moving Pictures",
    summary: null,
    defaultLocale: "en-US",
    cover: null,
    tags: [],
    storeListing: null,
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

it("passes cancellation through every reference mutation without changing version guards", async () => {
  const signal = new AbortController().signal;
  const slot = {
    key: "hero",
    kind: "character" as const,
    label: "Hero",
    description: "",
    required: true,
    rank: 10,
  };
  await createStoryReferenceSlots("p", { slots: [slot] }, "create-key", signal);
  await updateStoryReferenceSlot("p", "s", { expectedSlotVersion: 2, slot }, signal);
  await createStoryReferenceVersion(
    "p",
    "s",
    { expectedSlotVersion: 2, assetId: "a", variantId: "v", source: "upload" },
    "attach-key",
    signal
  );
  await reviewStoryReferenceVersion(
    "p",
    "s",
    "v",
    {
      expectedReviewRevision: 3,
      decision: "approve",
      checklist: { technical: "pass", identityContinuity: "pass", rights: "pass", safety: "pass" },
    },
    signal
  );
  await approveStoryReferenceVersion(
    "p",
    "s",
    { expectedSlotVersion: 2, referenceVersionId: "v", approveReviewId: "r" },
    signal
  );
  for (const call of [
    ...vi.mocked(api.post).mock.calls.slice(-4),
    ...vi.mocked(api.put).mock.calls.slice(-1),
  ])
    expect(call[1]).toEqual(expect.objectContaining({ signal, requestScope: "project" }));
  expect(vi.mocked(api.post).mock.calls.at(-1)?.[1]).toEqual(
    expect.objectContaining({
      data: { expectedSlotVersion: 2, referenceVersionId: "v", approveReviewId: "r" },
    })
  );
});
