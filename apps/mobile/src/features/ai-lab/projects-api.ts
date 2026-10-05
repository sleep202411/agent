import { z } from "zod";
import { api } from "@/lib/api-client";
import { generationSession } from "./jobs-api";
import { loadAgentProjects } from "@/features/agent/api/studio-projects-api";
import { generationProjectScope, type GenerationScope } from "./generation-scope";

export type GenerationProject = GenerationScope & {
  kind: "platform" | "story";
  id: string;
  title: string;
  canGenerate: boolean;
};
export const projectSelection = z.object({
  kind: z.enum(["platform", "story"]),
  id: z.string().uuid(),
});
export type ProjectSelection = z.infer<typeof projectSelection>;
const platform = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  status: z.enum(["active", "archived"]),
  role: z.enum(["owner", "admin", "editor", "viewer"]).optional(),
});
const story = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  status: z.enum(["active", "archived"]),
  capabilities: z.array(z.string()),
});
export async function listGenerationProjects(
  workspaceId: string,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  z.string().uuid().parse(workspaceId);
  const [raw, stories] = await Promise.all([
    api.get(`/workspaces/${workspaceId}/projects`, { service: "aurora", signal, retry: false }),
    loadAgentProjects(signal, workspaceId),
  ]);
  generationSession(generation, signal);
  const projects = z.object({ projects: z.array(platform) }).parse(raw).projects;
  if (projects.some((p) => p.workspaceId !== workspaceId))
    throw new Error("Project list workspace mismatch.");
  const rows = [
    ...projects
      .filter((p) => p.status === "active")
      .map((p) => ({ kind: "platform" as const, id: p.id, title: p.name })),
    ...stories.projects.map((p) => ({ kind: "story" as const, id: p.id, title: p.title })),
  ];
  if (new Set(rows.map((p) => `${p.kind}:${p.id}`)).size !== rows.length)
    throw new Error("Duplicate generation projects.");
  return rows;
}
/** Never derive project generation permission from a workspace's role or a cached list. */
export async function getGenerationProject(
  workspaceId: string,
  selection: ProjectSelection,
  generation: number,
  signal: AbortSignal
): Promise<GenerationProject> {
  generationSession(generation, signal);
  const selected = projectSelection.parse(selection);
  const raw = await api.get(
    `/${selected.kind === "platform" ? "projects" : "story-projects"}/${selected.id}`,
    { service: "aurora", signal, retry: false }
  );
  generationSession(generation, signal);
  const row =
    selected.kind === "platform"
      ? z.object({ project: platform }).parse(raw).project
      : story.parse(raw);
  if (row.id !== selected.id || row.workspaceId !== workspaceId || row.status !== "active")
    throw new Error("The selected project is unavailable in this workspace.");
  const scope = generationProjectScope.parse({
    workspaceId,
    ...(selected.kind === "platform" ? { projectId: row.id } : { storyProjectId: row.id }),
  });
  return {
    ...scope,
    kind: selected.kind,
    id: row.id,
    title: "name" in row ? row.name : row.title,
    canGenerate:
      "capabilities" in row
        ? row.capabilities.includes("story.generate")
        : ["owner", "admin", "editor"].includes(row.role ?? ""),
  };
}

/** Resolve the workspace from the authoritative Story project before canvas entry. */
export async function getStoryCanvasGenerationProject(
  projectId: string,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  const id = z.string().uuid().parse(projectId);
  const row = story.parse(
    await api.get(`/story-projects/${id}`, { service: "aurora", signal, retry: false })
  );
  generationSession(generation, signal);
  if (row.id !== id || !row.capabilities.includes("story.edit"))
    throw Error("Canvas editing permission is required.");
  if (row.status !== "active")
    throw Error("The selected project is unavailable in this workspace.");
  return {
    ...generationProjectScope.parse({ workspaceId: row.workspaceId, storyProjectId: id }),
    kind: "story" as const,
    id,
    title: row.title,
    canGenerate: row.capabilities.includes("story.generate"),
  };
}
