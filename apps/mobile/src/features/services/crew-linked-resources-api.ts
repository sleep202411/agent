import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
function current(generation: number, signal: AbortSignal) {
  if (signal.aborted || generation !== getAuthGeneration())
    throw Error("Crew resource session expired.");
}
export async function fetchLinkedIps(crewId: string, generation: number, signal: AbortSignal) {
  id.parse(crewId);
  current(generation, signal);
  const result = z
    .object({ items: z.array(z.object({ id })) })
    .parse(
      await api.get(`/ip-commerce/crews/${crewId}/ips`, { service: "aurora", retry: false, signal })
    );
  current(generation, signal);
  if (new Set(result.items.map((row) => row.id)).size !== result.items.length)
    throw Error("Duplicate linked IPs. Refresh to reload.");
  return result.items;
}
export async function fetchLinkedWorkspace(
  crewId: string,
  generation: number,
  signal: AbortSignal
) {
  id.parse(crewId);
  current(generation, signal);
  const result = z
    .object({
      page: z.object({ crewId: id }),
      studioWorkspace: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
      capabilities: z.object({ linkWorkspace: z.boolean() }),
    })
    .parse(
      await api.get(`/crews/${crewId}/production-overview`, {
        service: "aurora",
        retry: false,
        signal,
      })
    );
  current(generation, signal);
  if (result.page.crewId !== crewId) throw Error("Crew resource scope changed.");
  return { workspace: result.studioWorkspace, canLink: result.capabilities.linkWorkspace };
}
export async function fetchLinkedFilms(
  workspaceId: string,
  linkedIpId: string,
  cursor: string | null,
  generation: number,
  signal: AbortSignal
) {
  z.string().uuid().parse(workspaceId);
  id.parse(linkedIpId);
  if (cursor) id.parse(cursor);
  current(generation, signal);
  const result = z
    .object({
      items: z.array(z.object({ id, title: z.string() })).max(30),
      nextCursor: id.nullable(),
    })
    .parse(
      await api.get("/story-projects", {
        service: "aurora",
        retry: false,
        signal,
        params: { workspaceId, linkedIpId, limit: 30, ...(cursor ? { cursor } : {}) },
      })
    );
  current(generation, signal);
  if (
    new Set(result.items.map((row) => row.id)).size !== result.items.length ||
    (result.nextCursor && (result.nextCursor === cursor || !result.items.length))
  )
    throw Error("Linked film pagination changed. Refresh to reload.");
  return result;
}

export async function fetchCrewIpLinkAccess(
  crewId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  id.parse(crewId);
  current(generation, signal);
  const member = z
    .object({ userId: z.string(), permissions: z.array(z.string()) })
    .parse(
      await api.get(`/crews/${crewId}/members/me`, { service: "aurora", retry: false, signal })
    );
  current(generation, signal);
  if (member.userId !== userId) throw Error("Crew membership account mismatch.");
  return member.permissions.includes("production.manage");
}
