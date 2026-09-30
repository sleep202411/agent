import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { crewMember, fetchCrewMemberPage, type CrewMember } from "./crew-members-api";
const crewOwnership = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  version: z.number().int().nonnegative(),
});
function current(generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Crew member session expired.");
}
export async function transferCrewOwnership(
  crewId: string,
  userId: string,
  generation: number,
  snapshot: CrewMember,
  removeOldOwner: boolean
) {
  const target = crewMember.parse(snapshot);
  z.boolean().parse(removeOldOwner);
  if (target.crewId !== crewId) throw new Error("Crew member scope mismatch.");
  if (target.isOwner || target.userId === userId)
    throw new Error("Choose another active member as the new owner.");
  current(generation);
  const signal = new AbortController().signal;
  const seen = new Set<string>();
  let cursor: string | null = null;
  let found = false;
  do {
    const page = await fetchCrewMemberPage(crewId, userId, generation, cursor, signal);
    if (!page.canTransferOwnership)
      throw new Error("Crew ownership transfer permission is required.");
    const fresh = page.items.find((m) => m.id === target.id);
    if (fresh) {
      if (
        fresh.userId !== target.userId ||
        fresh.version !== target.version ||
        fresh.isOwner !== target.isOwner
      )
        throw new Error("Crew member changed. Refresh before transferring ownership.");
      found = true;
      break;
    }
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Crew member pagination did not advance.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  if (!found) throw new Error("Member is no longer active. Refresh the directory.");
  current(generation);
  const before = crewOwnership.parse(await api.get(`/crews/${crewId}`, { service: "aurora" }));
  current(generation);
  if (before.id !== crewId || before.ownerUserId !== userId)
    throw new Error("Crew ownership changed. Refresh before transferring.");
  const result = crewOwnership.parse(
    await api.post(`/crews/${crewId}/transfer-owner`, {
      service: "aurora",
      data: { toUserId: target.userId, removeOldOwner, expectedVersion: before.version },
    })
  );
  current(generation);
  if (
    result.id !== crewId ||
    result.ownerUserId !== target.userId ||
    result.version !== before.version + 1
  )
    throw new Error("Ownership transfer could not be verified. Refresh before another attempt.");
  return result;
}
