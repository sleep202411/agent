import { z } from "zod";
import { api } from "@/lib/api-client";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { generationSession } from "./jobs-api";
const id = z.string().uuid();
const likeness = z.object({
  id,
  workspaceId: id,
  name: z.string(),
  kind: z.enum(["virtual", "real_person"]),
  status: z.enum(["draft", "pending_verification", "active", "disabled", "revoked"]),
});
export type Likeness = z.infer<typeof likeness>;
export const likenessGrant = z.object({
  id,
  projectId: id,
  projectName: z.string(),
  status: z.enum(["active", "revoked"]),
  createdAt: z.string().datetime({ offset: true }),
  revokedAt: z.string().datetime({ offset: true }).nullable(),
});
export type LikenessGrant = z.infer<typeof likenessGrant>;
export async function loadLikenesses(workspaceId: string, generation: number, signal: AbortSignal) {
  generationSession(generation, signal);
  id.parse(workspaceId);
  const rows = z.object({ items: z.array(likeness) }).parse(
    await api.get("/characters", {
      service: "aurora",
      params: { workspaceId },
      signal,
      retry: false,
    })
  ).items;
  generationSession(generation, signal);
  if (
    rows.some((r) => r.workspaceId !== workspaceId) ||
    new Set(rows.map((r) => r.id)).size !== rows.length
  )
    throw new Error("Likeness library does not match the selected workspace.");
  return rows.filter((r) => r.kind === "real_person");
}
export async function loadLikenessGrants(
  characterId: string,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  id.parse(characterId);
  const rows = z.object({ items: z.array(likenessGrant) }).parse(
    await api.get(`/characters/${characterId}/grants`, {
      service: "aurora",
      signal,
      retry: false,
    })
  ).items;
  generationSession(generation, signal);
  if (
    new Set(rows.map((r) => r.id)).size !== rows.length ||
    new Set(rows.filter((r) => r.status === "active").map((r) => r.projectId)).size !==
      rows.filter((r) => r.status === "active").length
  )
    throw new Error("Conflicting project authorization records. Refresh before continuing.");
  return rows;
}
const withdrawal = z.object({
  clientKey: id,
  characterId: id,
  characterName: z.string(),
  grant: likenessGrant.refine((g) => g.status === "active"),
});
export type LikenessWithdrawal = z.infer<typeof withdrawal>;
export const likenessWithdrawalBox = (userId: string, generation: number, characterId: string) =>
  pendingRequest(
    withdrawal,
    generation,
    durableRecord("likeness-withdrawal", userId, id.parse(characterId))
  );
export function prepareLikenessWithdrawal(
  character: Likeness,
  grant: LikenessGrant,
  clientKey: string
) {
  if (character.kind !== "real_person") throw new Error("Choose your own real-person likeness.");
  return withdrawal.parse({
    clientKey,
    characterId: character.id,
    characterName: character.name,
    grant,
  });
}
export async function withdrawLikenessGrant(
  command: LikenessWithdrawal,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  const intent = withdrawal.parse(command),
    box = likenessWithdrawalBox(userId, generation, intent.characterId);
  if (box.read()) throw new Error("The previous withdrawal needs review before another request.");
  const rows = await loadLikenessGrants(intent.characterId, generation, signal),
    fresh = rows.find((r) => r.id === intent.grant.id);
  if (!fresh || JSON.stringify(fresh) !== JSON.stringify(intent.grant))
    throw new Error("This authorization changed. Refresh and review it again.");
  box.save(intent);
  // The official route targets a project, not a grant ID. Never automatically replay it:
  // a newly granted authorization could have appeared after the original withdrawal.
  z.object({ ok: z.literal(true) }).parse(
    await api.delete(`/characters/${intent.characterId}/grants/${intent.grant.projectId}`, {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  generationSession(generation, signal);
  box.clear(intent.clientKey);
}
/** Read-only reconciliation acknowledges only the original grant, never a replacement. */
export async function reconcileLikenessWithdrawal(
  userId: string,
  generation: number,
  characterId: string,
  signal: AbortSignal
) {
  const box = likenessWithdrawalBox(userId, generation, characterId),
    intent = box.read();
  if (!intent) return false;
  const rows = await loadLikenessGrants(characterId, generation, signal),
    original = rows.find((r) => r.id === intent.grant.id);
  if (
    original?.status !== "revoked" ||
    !original.revokedAt ||
    original.projectId !== intent.grant.projectId ||
    original.createdAt !== intent.grant.createdAt
  )
    return false;
  box.clear(intent.clientKey);
  return true;
}
