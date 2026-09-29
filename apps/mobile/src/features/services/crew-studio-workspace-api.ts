import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const crewIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const studioWorkspace = z.object({ id: z.string().uuid(), name: z.string() });
const overviewSchema = z.object({
  page: z.object({ crewId: crewIdSchema }),
  studioWorkspace: studioWorkspace.nullable(),
  studioProject: studioWorkspace.extend({ workspace: studioWorkspace }).nullable(),
  capabilities: z.object({ linkWorkspace: z.boolean() }),
});
export type CrewStudioWorkspaceState = {
  crewId: string;
  workspace: z.infer<typeof studioWorkspace> | null;
  legacyProject: z.infer<typeof overviewSchema>["studioProject"];
  options: z.infer<typeof studioWorkspace>[];
};
function current(generation: number, signal?: AbortSignal) {
  if (generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Studio workspace session expired or request cancelled.");
}
export async function fetchCrewStudioWorkspace(
  crewId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
): Promise<CrewStudioWorkspaceState> {
  crewIdSchema.parse(crewId);
  current(generation, signal);
  const member = z
    .object({ userId: z.string() })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  current(generation, signal);
  if (member.userId !== userId) throw new Error("Crew membership account mismatch.");
  const overview = overviewSchema.parse(
    await api.get(`/crews/${crewId}/production-overview`, { service: "aurora", signal })
  );
  current(generation, signal);
  if (overview.page.crewId !== crewId) throw new Error("Studio workspace Crew scope mismatch.");
  if (!overview.capabilities.linkWorkspace)
    throw new Error("Only a Crew administrator can link a Studio workspace.");
  const options = z
    .array(studioWorkspace)
    .parse(
      await api.get(`/crews/${crewId}/studio-workspace-options`, { service: "aurora", signal })
    );
  current(generation, signal);
  if (new Set(options.map((row) => row.id)).size !== options.length)
    throw new Error("Duplicate Studio workspace options.");
  return {
    crewId,
    workspace: overview.studioWorkspace,
    legacyProject: overview.studioProject,
    options,
  };
}
async function freshSnapshot(
  snapshot: CrewStudioWorkspaceState,
  userId: string,
  generation: number
) {
  const fresh = await fetchCrewStudioWorkspace(
    snapshot.crewId,
    userId,
    generation,
    new AbortController().signal
  );
  if (
    fresh.workspace?.id !== snapshot.workspace?.id ||
    fresh.legacyProject?.id !== snapshot.legacyProject?.id
  )
    throw new Error("The Crew Studio link changed. Refresh before continuing.");
  return fresh;
}
export async function linkCrewStudioWorkspace(
  snapshot: CrewStudioWorkspaceState,
  userId: string,
  generation: number,
  workspaceId: string | null
) {
  z.string().uuid().nullable().parse(workspaceId);
  const fresh = await freshSnapshot(snapshot, userId, generation);
  if (workspaceId && !fresh.options.some((row) => row.id === workspaceId))
    throw new Error("This workspace is no longer available to link.");
  current(generation);
  // The server locks linking and enforces exclusive ownership, but offers no compare-and-set parameter.
  const result = z.object({ studioWorkspace: studioWorkspace.nullable() }).parse(
    await api.patch(`/crews/${fresh.crewId}/studio-workspace`, {
      service: "aurora",
      data: { workspaceId },
    })
  );
  current(generation);
  if ((result.studioWorkspace?.id ?? null) !== workspaceId)
    throw new Error("Studio workspace change could not be verified. Refresh before trying again.");
  return result.studioWorkspace;
}
export async function initializeCrewStudioWorkspace(
  snapshot: CrewStudioWorkspaceState,
  userId: string,
  generation: number
) {
  const fresh = await freshSnapshot(snapshot, userId, generation);
  if (fresh.workspace || fresh.legacyProject)
    throw new Error("Review the existing Studio link before initializing a workspace.");
  current(generation);
  const result = z
    .object({ studioWorkspace, created: z.boolean() })
    .parse(
      await api.post(`/crews/${fresh.crewId}/studio-workspace/initialize`, { service: "aurora" })
    );
  current(generation);
  // created=false is valid when another request initialized this Crew under the server lock.
  return result;
}
