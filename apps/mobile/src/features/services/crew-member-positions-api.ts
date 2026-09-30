import { z } from "zod";
import { isPresetPosition } from "@repo/shared/crew";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { crewMember, fetchCrewMemberPage, type CrewMember } from "./crew-members-api";
export const memberPositionInput = z
  .object({
    categoryKey: z.string().refine(isPresetPosition, "Choose a standard position.").nullable(),
    title: z.string().trim().min(1).max(128).nullable(),
  })
  .strict()
  .refine(
    (v) => v.categoryKey !== null || v.title !== null,
    "A standard position or custom title is required."
  );
export const memberPositionsInput = z.array(memberPositionInput).max(12);
export type MemberPositionInput = z.infer<typeof memberPositionInput>;
function current(generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Crew member session expired.");
}
export async function updateCrewMemberPositions(
  crewId: string,
  userId: string,
  generation: number,
  snapshot: CrewMember,
  positions: MemberPositionInput[]
) {
  const target = crewMember.parse(snapshot),
    data = memberPositionsInput.parse(positions);
  if (target.crewId !== crewId) throw new Error("Crew member scope mismatch.");
  current(generation);
  const signal = new AbortController().signal;
  const seen = new Set<string>();
  let cursor: string | null = null;
  let found = false;
  do {
    const page = await fetchCrewMemberPage(crewId, userId, generation, cursor, signal);
    if (!page.canManageMembers) throw new Error("Crew member management permission is required.");
    const fresh = page.items.find((m) => m.id === target.id);
    if (fresh) {
      if (
        fresh.userId !== target.userId ||
        fresh.version !== target.version ||
        fresh.isOwner !== target.isOwner
      )
        throw new Error("Crew member changed. Refresh before editing positions.");
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
      data: { positions: data, expectedVersion: target.version },
    })
  );
  current(generation);
  const canonical = (
    rows: { categoryKey: string | null; title: string | null; isPrimary: boolean }[]
  ) =>
    rows
      .map((p) => JSON.stringify([p.categoryKey, p.title, p.isPrimary]))
      .sort()
      .join("|");
  // Only the first position has persisted ordering (isPrimary); secondary rows have no sort key.
  if (
    result.id !== target.id ||
    result.crewId !== crewId ||
    result.userId !== target.userId ||
    result.isOwner !== target.isOwner ||
    result.version !== target.version + 1 ||
    canonical(result.positions) !== canonical(data.map((p, i) => ({ ...p, isPrimary: i === 0 })))
  )
    throw new Error("Member position update could not be verified. Refresh before retrying.");
  return result;
}
