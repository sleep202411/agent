// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { getStoryProjectWorkspace, getStoryWorkbench } from "@/lib/story-projects-api";
import { listWorkspaces, type WorkspaceRef } from "@/lib/collab/projects-api";
import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  WorkspaceProvider,
  useWorkspace,
} from "@/app/_components/workspace-context";
import {
  resolveStoryCanvasProjectionSurface,
  resolveStoryProjectionReadiness,
  storyProjectionQueryOptions,
} from "./project-canvas/story-canvas-edit-policy";
import { StoryProjectWorkspaceGate } from "./story-project-workspace-gate";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: 13687 }, loading: false }),
}));

vi.mock("@/lib/collab/projects-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/collab/projects-api")>();
  return {
    ...actual,
    ensurePersonalWorkspace: vi.fn(),
    listWorkspaces: vi.fn(),
  };
});

vi.mock("@/lib/story-projects-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/story-projects-api")>();
  return {
    ...actual,
    getStoryProjectWorkspace: vi.fn(),
    getStoryWorkbench: vi.fn(),
  };
});

const PROJECT_ID = "019f6f94-0000-4000-8000-000000000001";
const PERSONAL_WORKSPACE = "019eb3d0-0000-4000-8000-0000000000aa";
const OWNER_WORKSPACE = "019eb3d0-0000-4000-8000-0000000000bb";

const PERSONAL: WorkspaceRef = {
  id: PERSONAL_WORKSPACE,
  name: "Personal",
  type: "personal",
  role: "owner",
  defaultProjectId: null,
};
const OWNER_TEAM: WorkspaceRef = {
  id: OWNER_WORKSPACE,
  name: "Jinling",
  type: "team",
  role: "viewer",
  defaultProjectId: null,
};

/**
 * An invited member opening a shared project link: no persisted workspace
 * selection, so the provider's personal fallback is the active workspace and
 * every workspace-scoped read of the project misses.
 */
describe("Shared story-project link workspace gate", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  /** Every projection surface the project route rendered, in order. */
  let renderedSurfaces: string[];

  function ProjectRoute() {
    const { activeWorkspace } = useWorkspace();
    const workspaceId = activeWorkspace?.id ?? null;
    const workbenchQuery = useQuery(
      storyProjectionQueryOptions({
        kind: "workbench",
        workspaceId,
        projectId: PROJECT_ID,
        chapterId: null,
        queryFn: () => getStoryWorkbench(workspaceId as string, PROJECT_ID),
      })
    );
    const readiness = resolveStoryProjectionReadiness({
      hasWorkspace: Boolean(workspaceId),
      workbenchFetchedAfterMount: workbenchQuery.isFetchedAfterMount,
      workbenchError: workbenchQuery.isError,
      layoutFetchedAfterMount: workbenchQuery.isFetchedAfterMount,
      layoutError: workbenchQuery.isError,
    });
    const surface = resolveStoryCanvasProjectionSurface(
      readiness,
      workbenchQuery.data !== undefined
    );
    renderedSurfaces.push(surface);
    return <span data-role="route" data-surface={surface} data-workspace={workspaceId ?? "none"} />;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    renderedSurfaces = [];
    vi.mocked(listWorkspaces).mockReset().mockResolvedValue([PERSONAL, OWNER_TEAM]);
    vi.mocked(getStoryProjectWorkspace).mockReset().mockResolvedValue(OWNER_WORKSPACE);
    vi.mocked(getStoryWorkbench)
      .mockReset()
      .mockImplementation(async (workspaceId) => {
        if (workspaceId !== OWNER_WORKSPACE) throw projectNotFound();
        return { project: { id: PROJECT_ID } } as never;
      });
    queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  });

  it("opens a shared link against the workspace the project lives in", async () => {
    await mount();
    await settle();

    expect(surface()).toBe("canvas");
    expect(routeWorkspace()).toBe(OWNER_WORKSPACE);
    // The route never saw the invitee's personal workspace, so it never issued
    // the read that 404s — no flash of the not-found surface.
    expect(renderedSurfaces).not.toContain("error");
    expect(vi.mocked(getStoryWorkbench).mock.calls.map(([workspaceId]) => workspaceId)).toEqual([
      OWNER_WORKSPACE,
    ]);
    // Persisted exactly like a manual switch, so a refresh keeps working.
    expect(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe(OWNER_WORKSPACE);
  });

  it("refreshes a stale workspace list once so the switch cannot silently no-op", async () => {
    // A session that was already open when the invite landed holds a list that
    // predates the membership; selecting an unlisted workspace is a no-op.
    vi.mocked(listWorkspaces)
      .mockReset()
      .mockResolvedValueOnce([PERSONAL])
      .mockResolvedValue([PERSONAL, OWNER_TEAM]);

    await mount();
    await settle();

    expect(listWorkspaces).toHaveBeenCalledTimes(2);
    expect(surface()).toBe("canvas");
    expect(routeWorkspace()).toBe(OWNER_WORKSPACE);
    expect(renderedSurfaces).not.toContain("error");
  });

  it("lands on the no-access state and resolves at most once when the caller has no access", async () => {
    vi.mocked(getStoryProjectWorkspace).mockReset().mockRejectedValue(projectNotFound());

    await mount();
    await settle();

    expect(surface()).toBe("error");
    expect(routeWorkspace()).toBe(PERSONAL_WORKSPACE);
    expect(getStoryProjectWorkspace).toHaveBeenCalledTimes(1);

    // Navigating to another route of the same project remounts the gate; the
    // failed resolve is the answer, not a transient, so it is never retried.
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    await settle();

    expect(surface()).toBe("error");
    expect(getStoryProjectWorkspace).toHaveBeenCalledTimes(1);
  });

  it("stops waiting when the refreshed list still does not contain the resolved workspace", async () => {
    vi.mocked(listWorkspaces).mockReset().mockResolvedValue([PERSONAL]);

    await mount();
    await settle();

    // One refresh, then the list is authoritative: the route owns the outcome
    // rather than the gate spinning forever.
    expect(listWorkspaces).toHaveBeenCalledTimes(2);
    expect(surface()).toBe("error");
  });

  async function mount() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <WorkspaceProvider>
            <StoryProjectWorkspaceGate projectId={PROJECT_ID}>
              <ProjectRoute />
            </StoryProjectWorkspaceGate>
          </WorkspaceProvider>
        </QueryClientProvider>
      );
    });
  }

  async function settle() {
    for (let pass = 0; pass < 8; pass += 1) {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 5));
      });
    }
  }

  function route(): Element | null {
    return container.querySelector('[data-role="route"]');
  }

  function surface(): string {
    return route()?.getAttribute("data-surface") ?? "gate";
  }

  function routeWorkspace(): string {
    return route()?.getAttribute("data-workspace") ?? "none";
  }
});

function projectNotFound(): ApiRequestError {
  return new ApiRequestError("STORY_PROJECT_NOT_FOUND", "Story project not found.", 404);
}
