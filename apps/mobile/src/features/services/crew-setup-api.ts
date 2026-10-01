import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchCrewMemberPage, type CrewMember } from "./crew-members-api";
import { fetchTeamInvitations, type TeamInvitation } from "./crew-team-invitations-api";
import { fetchCrewEpisodes } from "./episode-management-api";

/** Setup needs a complete roster: partial pages cannot prove that a role is vacant. */
export async function fetchCrewSetup(
  crewId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  const current = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw new Error("Crew setup session expired.");
  };
  const permissions = async () => {
    current();
    const member = z
      .object({ userId: z.string(), permissions: z.array(z.string()) })
      .parse(
        await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal, retry: false })
      );
    current();
    if (
      member.userId !== userId ||
      !member.permissions.includes("members.view") ||
      !member.permissions.includes("members.manage") ||
      !member.permissions.includes("tasks.manage")
    )
      throw new Error("Crew setup requires member and task management permissions.");
    return member.permissions;
  };
  const access = await permissions();
  const members: CrewMember[] = [],
    invitations: TeamInvitation[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>(),
    users = new Set<string>(),
    cursors = new Set<string>();
  let total: number | undefined;
  do {
    const page = await fetchCrewMemberPage(crewId, userId, generation, cursor, signal);
    current();
    if (
      !page.canManageMembers ||
      (!page.items.length && page.nextCursor) ||
      (total !== undefined && page.total !== total)
    )
      throw new Error("Crew roster changed. Refresh setup.");
    total = page.total;
    for (const member of page.items) {
      if (seen.has(member.id) || users.has(member.userId))
        throw new Error("Crew roster changed. Refresh setup.");
      seen.add(member.id);
      users.add(member.userId);
      members.push(member);
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error("Crew roster pagination did not advance.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  if (members.length !== total) throw new Error("Crew roster is incomplete. Refresh setup.");
  if (access.includes("members.invite")) {
    seen.clear();
    cursors.clear();
    total = undefined;
    do {
      const page = await fetchTeamInvitations(crewId, userId, generation, cursor, signal);
      current();
      if (total !== undefined && page.total !== total)
        throw new Error("Crew invitations changed. Refresh setup.");
      total = page.total;
      for (const invitation of page.items) {
        if (seen.has(invitation.id)) throw new Error("Crew invitations changed. Refresh setup.");
        seen.add(invitation.id);
        invitations.push(invitation);
      }
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor))
        throw new Error("Crew invitation pagination did not advance.");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (invitations.length !== total)
      throw new Error("Crew invitations are incomplete. Refresh setup.");
  }
  const episodes = await fetchCrewEpisodes(crewId, signal);
  const fresh = await permissions();
  if (access.includes("members.invite") !== fresh.includes("members.invite"))
    throw new Error("Crew permissions changed. Refresh setup.");
  return {
    members,
    invitations,
    episodes,
    canInvite: fresh.includes("members.invite"),
    canPublish: fresh.includes("openings.manage"),
  };
}
export type CrewSetupSnapshot = Awaited<ReturnType<typeof fetchCrewSetup>>;
