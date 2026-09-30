import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { crewMember, fetchCrewMemberPage, type CrewMember } from "./crew-members-api";
export const memberPolicyKeys = z
  .array(z.enum(["admin", "finance"]))
  .max(2)
  .refine((v) => new Set(v).size === v.length, "Duplicate access policy.");
export type MemberPolicyKey = z.infer<typeof memberPolicyKeys>[number];
function current(generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Crew member session expired.");
}
export async function updateCrewMemberAccess(
  crewId: string,
  userId: string,
  generation: number,
  snapshot: CrewMember,
  policyKeys: MemberPolicyKey[]
) {
  const target = crewMember.parse(snapshot),
    data = memberPolicyKeys.parse(policyKeys);
  if (target.crewId !== crewId) throw new Error("Crew member scope mismatch.");
  if (target.isOwner) throw new Error("The Crew owner already has every permission.");
  current(generation);
  const signal = new AbortController().signal;
  const seen = new Set<string>();
  let cursor: string | null = null;
  let found = false;
  do {
    const page = await fetchCrewMemberPage(crewId, userId, generation, cursor, signal);
    if (!page.canManagePermissions)
      throw new Error("Crew member permission management access is required.");
    const fresh = page.items.find((m) => m.id === target.id);
    if (fresh) {
      if (
        fresh.userId !== target.userId ||
        fresh.version !== target.version ||
        fresh.isOwner !== target.isOwner
      )
        throw new Error("Crew member changed. Refresh before editing access.");
      found = true;
      break;
    }
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Crew member pagination did not advance.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  if (!found) throw new Error("Member is no longer active. Refresh the directory.");
  current(generation);
  const result = crewMember.parse(
    await api.patch(`/crews/${crewId}/members/${target.id}`, {
      service: "aurora",
      data: { policyKeys: data, expectedVersion: target.version },
    })
  );
  current(generation);
  if (
    result.id !== target.id ||
    result.crewId !== crewId ||
    result.userId !== target.userId ||
    result.isOwner !== target.isOwner ||
    result.version !== target.version + 1 ||
    [...result.policyKeys].sort().join("|") !== [...data].sort().join("|")
  )
    throw new Error("Member access update could not be verified. Refresh before retrying.");
  return result;
}
