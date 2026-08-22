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
  archiveStoryChapter,
  addStoryCandidateAsset,
  createStoryProject,
  getStoryExperienceCurrentRelease,
  getStoryCandidateAssets,
  getStoryProjectWorkspace,
  getStoryWorkingPreview,
  listStoryProjects,
  putStoryCanvasLayout,
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

    const page = await listStoryProjects("workspace-1", { limit: 100 });

    expect(page.items).toHaveLength(1);
    expect(api.get).toHaveBeenCalledWith("/aurora/story-projects", {
      params: { limit: 100 },
      headers: { "x-fizz-workspace-id": "workspace-1" },
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

    await expect(listStoryProjects("workspace-1", { limit: 100 })).rejects.toThrow(
      "Story Studio API contract is out of date."
    );
  });

  it("creates an empty project without pretending the Agent intake is already answered", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ project: storyProject() });

    await expect(
      createStoryProject("workspace-1", {
        title: "Moving Pictures",
        summary: null,
        defaultLocale: "en-US",
        visibility: "private",
      })
    ).resolves.toMatchObject({ frameProfile: "landscape_16_9" });
    expect(api.post).toHaveBeenCalledWith("/aurora/story-projects", {
      data: {
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

  it("resolves the project's owning workspace without passing a workspace scope", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ workspaceId: "workspace-owner" });

    await expect(getStoryProjectWorkspace("project / one")).resolves.toBe("workspace-owner");

    // Only that no per-call scope is sent — unlike its neighbours above, which
    // pass `{ headers: { "x-fizz-workspace-id" } }`. The ambient header `api`
    // attaches to every request is not observable here and is not claimed.
    expect(api.get).toHaveBeenCalledWith("/aurora/story-projects/project%20%2F%20one/workspace");
  });

  it("rejects a resolve response that carries no workspace id", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ workspaceId: "" });

    await expect(getStoryProjectWorkspace("project-1")).rejects.toThrow(
      "Story Studio API returned an invalid project workspace."
    );
  });
});

function storyProject(): StoryProjectSummary {
  return {
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
