// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExperienceReleaseResult,
  FilmBuild,
  StoryCapability,
  StoryRevision,
  StoryWorkbench,
} from "@/lib/story-projects-api";

vi.mock("@/lib/story-projects-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/story-projects-api")>();
  return {
    ...actual,
    lockStoryRevision: vi.fn(),
    getStoryWorkbench: vi.fn(),
    createFilmBuild: vi.fn(),
    publishFilmBuild: vi.fn(),
  };
});

import {
  createFilmBuild,
  getStoryWorkbench,
  lockStoryRevision,
  publishFilmBuild,
} from "@/lib/story-projects-api";
import { useStoryPublication, type SavedDraftSnapshotRunner } from "./use-story-publication";

const messages = {
  storyStudio: {
    canvas: {
      publish: {
        errors: {
          workspaceRequired: "Select a workspace before publishing.",
          permissionDenied: "Your project role does not allow publishing.",
          saveFailed: "The latest changes could not be saved.",
          lockFailed: "The saved story could not be prepared for publication.",
          workbenchFailed: "The saved version could not be loaded for checking.",
          revisionMismatch: "The prepared version did not match the saved story.",
          productionContractMissing: "This story does not yet have playable content.",
          buildFailed: "The playable version could not be prepared.",
          buildNotReady: "This version is not ready to publish.",
          runtimeUnavailable: "The playable content is unavailable.",
          publishFailed: "The prepared version could not be published.",
          unexpected: "The current version could not be published.",
        },
      },
    },
  },
};

const capabilities: StoryCapability[] = ["story.edit", "story.build", "story.release"];

describe("useStoryPublication", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let publication: ReturnType<typeof useStoryPublication> | null;

  beforeEach(() => {
    publication = null;
    window.sessionStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(lockStoryRevision).mockResolvedValue(storyRevision());
    vi.mocked(getStoryWorkbench).mockResolvedValue(storyWorkbench());
    vi.mocked(createFilmBuild).mockResolvedValue(filmBuild());
    vi.mocked(publishFilmBuild).mockResolvedValue(releaseResult());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it("releases the saved-draft barrier after lock and before checking or publishing", async () => {
    const order: string[] = [];
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const withSavedDraftSnapshot: SavedDraftSnapshotRunner = async (submit) => {
      order.push("save");
      const locked = await submit(18);
      order.push("barrier-released");
      return locked;
    };
    vi.mocked(lockStoryRevision).mockImplementation(async () => {
      order.push("lock");
      return storyRevision();
    });
    vi.mocked(getStoryWorkbench).mockImplementation(async () => {
      order.push("check");
      return storyWorkbench();
    });
    vi.mocked(createFilmBuild).mockImplementation(async () => {
      order.push("prepare");
      return filmBuild();
    });
    vi.mocked(publishFilmBuild).mockImplementation(async () => {
      order.push("publish");
      return releaseResult();
    });
    await renderHook(withSavedDraftSnapshot);

    await act(async () => current().open());
    expect(current().state.status).toBe("confirming");
    await act(async () => current().confirm());

    expect(order).toEqual(["save", "lock", "barrier-released", "check", "prepare", "publish"]);
    expect(current().state.status).toBe("succeeded");
    expect(current().lastSucceeded).toMatchObject({
      lockedRevision: { sourceDraftRevision: 18 },
      build: { id: "build-1", sourceProductionRevision: 7 },
    });
    expect(getStoryWorkbench).toHaveBeenCalledWith("workspace-1", "project-1", "revision-1");
    expect(createFilmBuild).toHaveBeenCalledWith(
      "workspace-1",
      "project-1",
      {
        revisionId: "revision-1",
        expectedProductionRevision: 7,
        profile: "production",
        scope: { kind: "full" },
      },
      expect.any(String)
    );
    expect(publishFilmBuild).toHaveBeenCalledWith("workspace-1", "project-1", "build-1", {
      status: "published",
      setCurrent: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["story-studio", "current-release", "workspace-1", "project-1"],
    });
    expect(
      queryClient.getQueryData(["story-studio", "current-release", "workspace-1", "project-1"])
    ).toMatchObject({
      published: true,
      currentVersion: "v3",
      currentBuild: {
        id: "build-1",
        sourceRevisionId: "revision-1",
        sourceDraftRevision: 18,
        sourceProductionRevision: 7,
      },
    });

    await act(async () => current().close());
    expect(current().state.status).toBe("closed");
    expect(current().lastSucceeded?.build.id).toBe("build-1");
  });

  it("surfaces a specific backend lock failure verbatim", async () => {
    const upstreamMessage = "Complete trailer direction before publishing.";
    vi.mocked(lockStoryRevision).mockRejectedValue(new Error(upstreamMessage));
    await renderHook((submit) => submit(18));

    await act(async () => current().open());
    await act(async () => current().confirm());

    expect(current().state).toMatchObject({
      status: "failed",
      phase: "locking",
      code: "LOCK_FAILED",
      message: upstreamMessage,
    });
    expect(createFilmBuild).not.toHaveBeenCalled();
    expect(publishFilmBuild).not.toHaveBeenCalled();
  });

  it("keeps the confirmed publication when cache refreshes fail", async () => {
    vi.spyOn(queryClient, "invalidateQueries").mockRejectedValue(
      new Error("Workbench refresh is temporarily unavailable.")
    );
    await renderHook((submit) => submit(18));

    await act(async () => current().open());
    await act(async () => current().confirm());

    expect(current().state.status).toBe("succeeded");
    expect(current().lastSucceeded?.release).toEqual(releaseResult());
    await act(async () => current().close());
    expect(current().lastSucceeded?.lockedRevision.sourceDraftRevision).toBe(18);
    expect(
      queryClient.getQueryData(["story-studio", "current-release", "workspace-1", "project-1"])
    ).toMatchObject({ published: true, currentVersion: "v3" });
  });

  it("fails loud when publication is invoked without all required capabilities", async () => {
    await renderHook((submit) => submit(18), ["story.edit", "story.build"]);

    expect(current().canPublish).toBe(false);
    expect(current().disabledReason).toBe("Your project role does not allow publishing.");
    await act(async () => current().open());
    expect(current().state).toMatchObject({
      status: "failed",
      phase: "permission",
      code: "PERMISSION_DENIED",
    });
    expect(lockStoryRevision).not.toHaveBeenCalled();
  });

  async function renderHook(
    withSavedDraftSnapshot: SavedDraftSnapshotRunner,
    projectCapabilities: StoryCapability[] = capabilities
  ) {
    function Harness() {
      publication = useStoryPublication({
        workspaceId: "workspace-1",
        projectId: "project-1",
        capabilities: projectCapabilities,
        withSavedDraftSnapshot,
      });
      return <span>{publication.state.status}</span>;
    }

    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages}>
          <QueryClientProvider client={queryClient}>
            <Harness />
          </QueryClientProvider>
        </NextIntlClientProvider>
      );
    });
  }

  function current(): ReturnType<typeof useStoryPublication> {
    if (!publication) throw new Error("Publication hook has not rendered.");
    return publication;
  }
});

function storyRevision(): StoryRevision {
  return {
    id: "revision-1",
    number: 3,
    sourceDraftRevision: 18,
    schemaVersion: "interactive-film-draft-v2",
    contentHash: "story-hash",
    label: null,
    source: "creator",
    createdByUserId: "user-1",
    createdAt: "2026-07-16T12:00:00.000Z",
    projectId: "project-1",
    format: "interactive_film",
    content: {},
  } as StoryRevision;
}

function storyWorkbench(): StoryWorkbench {
  return {
    selectedRevision: storyRevision(),
    film: { productionRevision: 7 },
  } as StoryWorkbench;
}

function filmBuild(): FilmBuild {
  return {
    id: "build-1",
    projectId: "project-1",
    revisionId: "revision-1",
    number: 4,
    version: 1,
    profile: "production",
    scope: { kind: "full" },
    status: "ready",
    sourceProductionRevision: 7,
    inputHash: "input-hash",
    inputManifestHash: "input-manifest-hash",
    runtimeSchemaVersion: 2,
    runtimeJson: { schemaVersion: 2 },
    runtimeHash: "runtime-hash",
    assets: [],
    diagnostics: [],
    pathReport: null,
    publication: null,
    createdByUserId: "user-1",
    createdAt: "2026-07-16T12:00:00.000Z",
    completedAt: "2026-07-16T12:00:01.000Z",
  };
}

function releaseResult(): ExperienceReleaseResult {
  return {
    gameId: "jinling",
    contentVersion: "v3",
    status: "published",
    manifestUrl: "https://media.example.test/jinling/v3/manifest.json",
  };
}
