import { z } from "zod";
import { api } from "@/lib/api-client";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { loadAgentWorkspaces } from "@/features/agent/api/studio-projects-api";
import { generationSession } from "./jobs-api";
import { getGenerationProject } from "./projects-api";
import { loadLikenessGrants, likenessGrant } from "./likeness-grants-api";
import { PROJECT_LIKENESS_CONSENT_VERSION } from "./casting-accept-api";
const id = z.string().uuid();
const candidate = z.object({
  id,
  workspaceId: id,
  name: z.string(),
  status: z.enum(["active", "archived"]),
});
export type GrantProject = z.infer<typeof candidate> & { workspaceName: string };
export async function listLikenessGrantProjects(
  characterId: string,
  generation: number,
  signal: AbortSignal
): Promise<GrantProject[]> {
  const grants = await loadLikenessGrants(characterId, generation, signal);
  const workspaces = await loadAgentWorkspaces(signal);
  generationSession(generation, signal);
  const rows = (
    await Promise.all(
      workspaces.map(async (w) => {
        const projects = z.object({ projects: z.array(candidate) }).parse(
          await api.get(`/workspaces/${w.id}/projects`, {
            service: "aurora",
            signal,
            retry: false,
          })
        ).projects;
        if (projects.some((p) => p.workspaceId !== w.id))
          throw new Error("Project list does not match its workspace.");
        return projects
          .filter(
            (p) =>
              p.status === "active" &&
              !grants.some((g) => g.projectId === p.id && g.status === "active")
          )
          .map((p) => ({ ...p, workspaceName: w.name }));
      })
    )
  ).flat();
  generationSession(generation, signal);
  if (new Set(rows.map((p) => p.id)).size !== rows.length)
    throw new Error("Duplicate project candidates.");
  return rows;
}
const character = z.object({
  id,
  workspaceId: id,
  name: z.string(),
  kind: z.literal("real_person"),
  status: z.literal("active"),
  updatedAt: z.string(),
});
export async function reviewLikenessGrant(
  characterId: string,
  project: GrantProject,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  id.parse(characterId);
  candidate.parse(project);
  const grants = await loadLikenessGrants(characterId, generation, signal);
  if (grants.some((g) => g.projectId === project.id && g.status === "active"))
    throw new Error("This project is already authorized. Refresh the history.");
  const likeness = character.parse(
    await api.get(`/characters/${characterId}`, { service: "aurora", signal, retry: false })
  );
  generationSession(generation, signal);
  if (likeness.id !== characterId)
    throw new Error("Likeness response does not match your selection.");
  const fresh = await getGenerationProject(
    project.workspaceId,
    { kind: "platform", id: project.id },
    generation,
    signal
  );
  if (!fresh.canGenerate)
    throw new Error("Project editor permission is required to authorize this project.");
  return { character: likeness, project: { ...project, name: fresh.title } };
}
export type GrantReview = Awaited<ReturnType<typeof reviewLikenessGrant>>;
const create = z.object({
  clientKey: id,
  character,
  project: candidate.extend({ workspaceName: z.string() }),
  consent: z.object({
    version: z.literal(PROJECT_LIKENESS_CONSENT_VERSION),
    adultAttested: z.literal(true),
  }),
});
export type LikenessGrantCreate = z.infer<typeof create>;
export const likenessGrantCreateBox = (userId: string, generation: number, characterId: string) =>
  pendingRequest(
    create,
    generation,
    durableRecord("likeness-grant-create", userId, id.parse(characterId))
  );
export function prepareLikenessGrant(
  review: GrantReview,
  clientKey: string,
  read: boolean,
  adult: boolean
) {
  if (!read || !adult)
    throw new Error("Read the consent and attest to your own adult likeness before authorizing.");
  return create.parse({
    ...review,
    clientKey,
    consent: { version: PROJECT_LIKENESS_CONSENT_VERSION, adultAttested: true },
  });
}
export async function createLikenessGrant(
  command: LikenessGrantCreate,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  const intent = create.parse(command),
    box = likenessGrantCreateBox(userId, generation, intent.character.id);
  if (box.read())
    throw new Error(
      "The original authorization needs review. It will not be submitted again automatically."
    );
  const fresh = await reviewLikenessGrant(intent.character.id, intent.project, generation, signal);
  if (
    JSON.stringify(fresh.character) !== JSON.stringify(intent.character) ||
    fresh.project.name !== intent.project.name
  )
    throw new Error("The likeness or project changed. Review the consent again.");
  box.save(intent);
  const receipt = likenessGrant.parse(
    await api.post(`/characters/${intent.character.id}/grants`, {
      service: "aurora",
      signal,
      retry: false,
      data: { projectId: intent.project.id, consent: intent.consent },
    })
  );
  generationSession(generation, signal);
  if (receipt.projectId !== intent.project.id || receipt.status !== "active")
    throw new Error(
      "Authorization receipt does not match the selected project. Review the history."
    );
  box.clear(intent.clientKey);
  return receipt;
}
