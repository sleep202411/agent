import { z } from "zod";
import { api, ApiRequestError } from "@/lib/api-client";
import { positionReceipt } from "@/features/services/position-create-api";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
/** Public list contract; never substitute another opening when the selected one disappears. */
export async function fetchCrewOpening(crewId: string, positionId: string, signal: AbortSignal) {
  id.parse(crewId);
  id.parse(positionId);
  const crew = z
    .object({ id, name: z.string() })
    .parse(await api.get(`/crews/${crewId}`, { service: "aurora", signal }));
  if (crew.id !== crewId) throw new Error("Crew response does not match this opening.");
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = z.object({ items: z.array(positionReceipt), nextCursor: id.nullable() }).parse(
      await api.get(`/crews/${crewId}/positions`, {
        service: "aurora",
        signal,
        params: { cursor: cursor ?? undefined },
      })
    );
    if (page.items.some((p) => p.crewId !== crewId))
      throw new Error("Opening response does not match this crew.");
    const position = page.items.find((p) => p.id === positionId);
    if (position)
      return position.status === "frozen" || position.recruitmentVisibility === "private"
        ? null
        : { crew, position };
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Repeated crew positions cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return null;
}
export function openingIsFull(position: z.infer<typeof positionReceipt>) {
  return position.status === "full" || position.recruitedCount >= position.targetCount;
}

export async function openingViewerIsMember(crewId: string, userId: string, signal: AbortSignal) {
  id.parse(crewId);
  id.parse(userId);
  try {
    const member = z
      .object({ userId: id })
      .parse(
        await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal, retry: false })
      );
    if (member.userId !== userId)
      throw new Error("Membership response does not match this account.");
    return true;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 403) {
      let code = error.code;
      try {
        code = JSON.parse(error.responseBody ?? "{}").code ?? code;
      } catch {
        /* Preserve original server error. */
      }
      if (code === "CREW_MEMBERSHIP_REQUIRED") return false;
    }
    throw error;
  }
}
