/**
 * Story Studio projects — same root as PC FizzAgent
 * (`POST|GET /aurora/story-projects` with explicit `workspaceId`).
 *
 * Paths omit `/aurora` — `auroraBaseUrl` already ends in `/aurora`.
 * StoryProject ids are sovereign (not PlatformProject / section ids).
 */

import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { getLocale } from "@/i18n";
import { api } from "@/lib/api-client";

const AURORA = { service: "aurora" as const };

const workspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  status: z.enum(["active", "suspended", "archived"]).optional(),
  role: z.enum(["owner", "admin", "billing", "editor", "viewer"]).optional(),
  accessScope: z.enum(["workspace", "project_only"]).optional(),
  crewRole: z.enum(["viewer", "editor"]).optional(),
});
export type StudioWorkspace = z.infer<typeof workspaceSchema>;
export function canCreateStudioProject(workspace: StudioWorkspace) {
  return (
    (workspace.status === undefined || workspace.status === "active") &&
    (workspace.crewRole === "editor" ||
      (workspace.accessScope === "workspace" &&
        ["owner", "admin", "editor"].includes(workspace.role ?? "")))
  );
}
function requireCurrent(generation: number, signal?: AbortSignal) {
  if (signal?.aborted || generation !== getAuthGeneration())
    throw new Error("Studio session expired or request cancelled.");
}
export async function loadAgentWorkspaces(signal?: AbortSignal): Promise<StudioWorkspace[]> {
  const generation = getAuthGeneration();
  requireCurrent(generation, signal);
  await storyProjectsApi.ensureDefaultWorkspace(signal);
  requireCurrent(generation, signal);
  const result = z
    .object({ workspaces: z.array(workspaceSchema) })
    .parse(await api.get("/workspaces", { ...AURORA, signal }));
  requireCurrent(generation, signal);
  if (new Set(result.workspaces.map((row) => row.id)).size !== result.workspaces.length)
    throw new Error("Duplicate Studio workspace entries.");
  return result.workspaces.filter((row) => row.status === undefined || row.status === "active");
}

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
  projectVersion?: number;
  capabilities?: StoryCapability[];
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

const projectPageSchema = z.object({
  items: z.array(
    z.object({
      capabilities: z
        .array(
          z.enum([
            "story.read",
            "story.edit",
            "story.generate",
            "story.review",
            "story.build",
            "story.release",
            "story.admin",
          ])
        )
        .optional(),
      id: z.string().uuid(),
      workspaceId: z.string().uuid(),
      title: z.string(),
      summary: z.string().nullable().optional(),
      updatedAt: z.string().datetime({ offset: true }).optional(),
      cover: z
        .object({
          kind: z.string().optional(),
          status: z.string().optional(),
          moderationStatus: z.string().nullable().optional(),
          previewUrl: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
      production: z
        .object({
          clipCount: z.number().int().nonnegative(),
          currentVideoCount: z.number().int().nonnegative(),
        })
        .optional(),
    })
  ),
  nextCursor: z.string().min(1).nullable(),
});

/** Ensure default workspace, list story projects (does not auto-create). */
export async function loadAgentProjects(
  signal?: AbortSignal,
  selectedWorkspaceId?: string
): Promise<{
  workspaceId: string;
  projects: StoryProjectSummary[];
}> {
  const generation = getAuthGeneration();
  const current = () => {
    if (signal?.aborted || generation !== getAuthGeneration())
      throw new Error("Project list session expired or request cancelled.");
  };
  current();
  const workspaceId =
    selectedWorkspaceId !== undefined
      ? z.string().uuid().parse(selectedWorkspaceId)
      : z
          .string()
          .uuid()
          .parse((await storyProjectsApi.ensureDefaultWorkspace(signal)).workspace.id);
  current();
  const projects: StoryProjectSummary[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    current();
    const page = projectPageSchema.parse(
      await storyProjectsApi.listStoryProjects(workspaceId, { limit: 100, cursor }, signal)
    );
    current();
    for (const project of page.items) {
      if (project.workspaceId !== workspaceId) throw new Error("Project list workspace mismatch.");
      // A project's updatedAt can change between pages. Retain its newest (first) row.
      if (!ids.has(project.id)) {
        ids.add(project.id);
        projects.push(project);
      }
    }
    if (page.nextCursor && (!page.items.length || cursors.has(page.nextCursor)))
      throw new Error("Project list pagination did not advance. Refresh to try again.");
    cursor = page.nextCursor ?? undefined;
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return { workspaceId, projects };
}

/**
 * Create a Story Studio project — same as PC:
 * `POST /aurora/story-projects` with `workspaceId` in the body.
 */
export async function createAgentProject(opts?: {
  workspaceId?: string;
  title?: string;
  summary?: string | null;
  signal?: AbortSignal;
}): Promise<{ project: StoryProjectSummary; chapterId: string }> {
  const generation = getAuthGeneration();
  requireCurrent(generation, opts?.signal);
  const workspaceId =
    opts?.workspaceId !== undefined
      ? z.string().uuid().parse(opts.workspaceId)
      : z
          .string()
          .uuid()
          .parse((await storyProjectsApi.ensureDefaultWorkspace(opts?.signal)).workspace.id);
  requireCurrent(generation, opts?.signal);
  const { workspace } = z
    .object({ workspace: workspaceSchema })
    .parse(await api.get(`/workspaces/${workspaceId}`, { ...AURORA, signal: opts?.signal }));
  requireCurrent(generation, opts?.signal);
  if (workspace.id !== workspaceId || !canCreateStudioProject(workspace))
    throw new Error("Workspace project creation permission is required.");
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
  requireCurrent(generation, opts?.signal);
  const project = workbench.project;
  if (project?.workspaceId !== workspaceId) throw new Error("Created project workspace mismatch.");
  const chapterId = workbench.chapter?.id?.trim() || workbench.chapters?.[0]?.id?.trim();
  if (!project?.id) {
    throw new Error("Story Studio did not return a project id");
  }
  if (!chapterId) {
    throw new Error("Story Studio did not return a chapter id");
  }
  return { project, chapterId };
}
