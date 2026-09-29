import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import {
  fetchManagedPositions,
  managedPosition,
  type ManagedPosition,
} from "./invitation-management-api";
export type PositionAction = "freeze" | "reopen" | "remove";
function current(generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Position session expired");
}
export async function fetchLifecyclePosition(
  position: ManagedPosition,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  managedPosition.parse(position);
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await fetchManagedPositions(position.crewId, userId, generation, cursor, signal);
    for (const row of page.items) {
      if (seen.has(row.id)) throw new Error("Position list changed. Refresh to reload.");
      seen.add(row.id);
    }
    const found = page.items.find((row) => row.id === position.id);
    if (found) return found;
    cursor = page.nextCursor;
    if (signal.aborted) throw new Error("Position request cancelled");
  } while (cursor);
  throw new Error("Position is no longer available.");
}
export async function changePositionLifecycle(
  position: ManagedPosition,
  userId: string,
  generation: number,
  action: PositionAction
) {
  z.enum(["freeze", "reopen", "remove"]).parse(action);
  current(generation);
  const fresh = await fetchLifecyclePosition(
    position,
    userId,
    generation,
    new AbortController().signal
  );
  if (
    fresh.status !== position.status ||
    fresh.targetCount !== position.targetCount ||
    fresh.recruitedCount !== position.recruitedCount
  )
    throw new Error("Position changed. Return to the position list and review it again.");
  current(generation);
  const path = `/crews/${fresh.crewId}/positions/${fresh.id}`;
  if (action === "remove") {
    // The server atomically rechecks permission and pending applications. No automatic retry.
    await api.delete(path, { service: "aurora" });
    current(generation);
    return;
  }
  if (
    (action === "reopen" && fresh.status !== "frozen") ||
    (action === "freeze" && fresh.status === "frozen")
  )
    throw new Error("Position status changed. Refresh before another action.");
  const status = action === "freeze" ? "frozen" : "open";
  const result = managedPosition.parse(
    await api.patch(path, { service: "aurora", data: { status } })
  );
  current(generation);
  if (result.id !== fresh.id || result.crewId !== fresh.crewId || result.status !== status)
    throw new Error("Position change could not be verified. Return to the position list.");
}
