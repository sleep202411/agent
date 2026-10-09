import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { createAgentProject, loadAgentProjects } from "@/features/agent/api/studio-projects-api";

function current(generation: number, signal: AbortSignal) {
  if (signal.aborted || generation !== getAuthGeneration())
    throw new Error("Film session expired or request cancelled.");
}
async function linkedWorkspace(crewId: string, generation: number, signal: AbortSignal) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  current(generation, signal);
  const result = z
    .object({
      page: z.object({ crewId: z.string() }),
      studioWorkspace: z.object({ id: z.string().uuid() }).nullable(),
    })
    .parse(await api.get(`/crews/${crewId}/production-overview`, { service: "aurora", signal }));
  current(generation, signal);
  if (result.page.crewId !== crewId) throw new Error("Film Crew scope mismatch.");
  return result.studioWorkspace?.id ?? null;
}
export async function loadCrewFilms(crewId: string, generation: number, signal: AbortSignal) {
  const workspaceId = await linkedWorkspace(crewId, generation, signal);
  if (!workspaceId) return { workspaceId: null, projects: [] };
  const result = await loadAgentProjects(signal, workspaceId);
  current(generation, signal);
  if (result.workspaceId !== workspaceId) throw new Error("Film workspace scope mismatch.");
  return result;
}
export async function createCrewFilm(
  crewId: string,
  workspaceId: string,
  title: string,
  generation: number,
  signal: AbortSignal
) {
  const name = z.string().trim().min(1).max(180).parse(title);
  if ((await linkedWorkspace(crewId, generation, signal)) !== workspaceId)
    throw new Error("The linked workspace changed. Refresh before creating a film.");
  // Shared creation flow rechecks workspace editor permission immediately before POST.
  const result = await createAgentProject({ workspaceId, title: name, signal });
  current(generation, signal);
  return result.project;
}
