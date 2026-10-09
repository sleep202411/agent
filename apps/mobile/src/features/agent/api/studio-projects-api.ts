/**
 * Story Studio projects — same root as PC FizzAgent
 * (`POST|GET /aurora/story-projects` with explicit `workspaceId`).
 *
 * Paths omit `/aurora` — `auroraBaseUrl` already ends in `/aurora`.
 * StoryProject ids are sovereign (not PlatformProject / section ids).
 */

import { getLocale } from "@/i18n";
import { api } from "@/lib/api-client";

const AURORA = { service: "aurora" as const };

export type StudioWorkspace = {
  id: string;
  name: string;
  isDefault: boolean;
};

/** Minimal StoryProject summary for Create / Agent OS (list + workbench). */
export type StoryProjectCover = {
  kind?: string;
  status?: string;
  moderationStatus?: string | null;
  previewUrl?: string | null;
};

export type StoryProjectProductionSummary = {
  clipCount: number;
  currentVideoCount: number;
};

export type StoryProjectSummary = {
  id: string;
  workspaceId: string;
  title: string;
  summary?: string | null;
  updatedAt?: string;
  cover?: StoryProjectCover | null;
  production?: StoryProjectProductionSummary;
};

export type StoryChapter = {
  id: string;
  projectId: string;
  title: string;
  rank?: number;
};

export type StoryCapability =
  | "story.read"
  | "story.edit"
  | "story.generate"
  | "story.review"
  | "story.build"
  | "story.release"
  | "story.admin";

export type StoryBillingBalance = {
  workspaceId: string;
  availablePoints: string;
  heldPoints: string;
  totalPoints: string;
};

export type StoryWorkbench = {
  project: StoryProjectSummary & {
    capabilities?: StoryCapability[];
  };
  chapters: StoryChapter[];
  chapter: StoryChapter;
  draft?: {
    revision?: number;
  };
  video?: {
    snapshotHash?: string;
  };
};

type StoryProjectPage = {
  items: StoryProjectSummary[];
  nextCursor: string | null;
};

/** FizzAgent / Story Studio Agent OS mode (PC uses the same). */
export const AGENT_OS_STORY_WORKBENCH_MODE = "story";

export const storyProjectsApi = {
  ensureDefaultWorkspace(signal?: AbortSignal) {
    return api.post<{ workspace: StudioWorkspace }>("/workspaces/default/ensure", {
      ...AURORA,
      data: {},
      signal,
      timeout: 30_000,
    });
  },

  listStoryProjects(
    workspaceId: string,
    query?: { status?: "active" | "archived"; limit?: number; cursor?: string },
    signal?: AbortSignal
  ) {
    return api.get<StoryProjectPage>("/story-projects", {
      ...AURORA,
      params: {
        workspaceId,
        status: query?.status ?? "active",
        limit: query?.limit ?? 100,
        cursor: query?.cursor,
      },
      signal,
      timeout: 30_000,
    });
  },

  createStoryProject(
    workspaceId: string,
    input: {
      title: string;
      defaultLocale: string;
      summary?: string | null;
      visibility?: "private" | "unlisted";
    },
    signal?: AbortSignal
  ) {
    return api.post<StoryWorkbench>("/story-projects", {
      ...AURORA,
      data: {
        workspaceId,
        title: input.title,
        defaultLocale: input.defaultLocale,
        summary: input.summary ?? null,
        visibility: input.visibility ?? "private",
      },
      signal,
      timeout: 60_000,
    });
  },

  getWorkbench(projectId: string, chapterId?: string, signal?: AbortSignal) {
    return api.get<StoryWorkbench>(`/story-projects/${encodeURIComponent(projectId)}/workbench`, {
      ...AURORA,
      params: chapterId ? { chapterId } : undefined,
      signal,
      timeout: 30_000,
    });
  },

  /** Project-payer compute balance. */
  getBillingBalance(projectId: string, signal?: AbortSignal) {
    return api.get<StoryBillingBalance>(
      `/story-projects/${encodeURIComponent(projectId)}/billing/balance`,
      {
        ...AURORA,
        signal,
        timeout: 30_000,
      }
    );
  },
};

/** First chapter for Agent OS `workbenchMode: "story"`. */
export async function resolveDefaultChapterId(
  projectId: string,
  signal?: AbortSignal
): Promise<string> {
  const workbench = await storyProjectsApi.getWorkbench(projectId, undefined, signal);
  const chapterId = workbench.chapter?.id?.trim() || workbench.chapters?.[0]?.id?.trim();
  if (!chapterId) {
    throw new Error("Story project has no chapter for Agent OS story mode");
  }
  return chapterId;
}

/** Ensure default workspace, list story projects (does not auto-create). */
export async function loadAgentProjects(signal?: AbortSignal): Promise<{
  workspaceId: string;
  projects: StoryProjectSummary[];
}> {
  const { workspace } = await storyProjectsApi.ensureDefaultWorkspace(signal);
  const page = await storyProjectsApi.listStoryProjects(workspace.id, { limit: 100 }, signal);
  return { workspaceId: workspace.id, projects: page.items ?? [] };
}

/**
 * Create a Story Studio project — same as PC:
 * `POST /aurora/story-projects` with `workspaceId` in the body.
 */
export async function createAgentProject(opts?: {
  title?: string;
  summary?: string | null;
  signal?: AbortSignal;
}): Promise<{ project: StoryProjectSummary; chapterId: string }> {
  const { workspace } = await storyProjectsApi.ensureDefaultWorkspace(opts?.signal);
  const workbench = await storyProjectsApi.createStoryProject(
    workspace.id,
    {
      title: opts?.title?.trim() || "Create",
      defaultLocale: getLocale(),
      summary: opts?.summary ?? null,
      visibility: "private",
    },
    opts?.signal
  );
  const project = workbench.project;
  const chapterId = workbench.chapter?.id?.trim() || workbench.chapters?.[0]?.id?.trim();
  if (!project?.id) {
    throw new Error("Story Studio did not return a project id");
  }
  if (!chapterId) {
    throw new Error("Story Studio did not return a chapter id");
  }
  return { project, chapterId };
}
