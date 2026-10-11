import {
  TextGameCreateInputSchema,
  TextGameCreatorActionSchema,
  TextGameDetailSchema,
  TextGameIdSchema,
  TextGameSummaryListSchema,
  TextGameUpdateInputSchema,
  isTextGameEditableByCreator,
  isTextGameCreatorActionAllowed,
  textGameStatusAfterCreatorAction,
  type TextGameCreateInput,
  type TextGameUpdateInput,
  type TextGameCreatorAction,
} from "@repo/shared/text-game";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
export type TextAdventureSession = { userId: string; generation: number };
const base = "/api/user/text-game";
function current(session: TextAdventureSession, signal: AbortSignal) {
  if (!session.userId || session.generation !== getAuthGeneration() || signal.aborted)
    throw new Error("Text adventure session expired or request cancelled.");
}
function owner(creatorId: string | null | undefined, session: TextAdventureSession) {
  // Older Java responses omit creatorId; authorization remains enforced by /user/ endpoints.
  if (creatorId != null && creatorId !== session.userId)
    throw new Error("Text adventure creator mismatch.");
}
function detail(value: unknown, session: TextAdventureSession, expectedId?: string) {
  const result = TextGameDetailSchema.parse(value);
  owner(result.creatorId, session);
  if (expectedId && result.gameId !== expectedId)
    throw new Error("Text adventure identity mismatch.");
  return result;
}
export async function listTextAdventures(session: TextAdventureSession, signal: AbortSignal) {
  current(session, signal);
  const rows = TextGameSummaryListSchema.parse(
    await api.get(base, { service: "studio", signal, retry: false })
  );
  current(session, signal);
  rows.forEach((row) => owner(row.creatorId, session));
  if (new Set(rows.map((row) => row.gameId)).size !== rows.length)
    throw new Error("Duplicate text adventures returned.");
  return rows;
}
export async function getTextAdventure(
  gameId: string,
  session: TextAdventureSession,
  signal: AbortSignal
) {
  current(session, signal);
  TextGameIdSchema.parse(gameId);
  const result = detail(
    await api.get(`${base}/${gameId}`, { service: "studio", signal, retry: false }),
    session,
    gameId
  );
  current(session, signal);
  return result;
}
/** Writes never retry automatically. An error after dispatch may have committed: reload before retrying. */
export async function createTextAdventure(
  input: TextGameCreateInput,
  session: TextAdventureSession,
  signal: AbortSignal
) {
  current(session, signal);
  const data = TextGameCreateInputSchema.parse(input);
  const result = detail(
    await api.post(base, { service: "studio", signal, retry: false, data, timeout: 180_000 }),
    session
  );
  current(session, signal);
  if (result.status !== "draft") throw new Error("Text adventure creation did not return a draft.");
  return result;
}
export async function updateTextAdventure(
  gameId: string,
  input: TextGameUpdateInput,
  session: TextAdventureSession,
  signal: AbortSignal,
  expected?: { draftVersionId: string; updatedAt: string }
) {
  current(session, signal);
  const data = TextGameUpdateInputSchema.parse(input);
  const fresh = await getTextAdventure(gameId, session, signal);
  if (
    expected &&
    (fresh.draftVersionId !== expected.draftVersionId || fresh.updatedAt !== expected.updatedAt)
  )
    throw new Error("Text adventure changed on the server. Refresh before saving.");
  if (!isTextGameEditableByCreator(fresh.status))
    throw new Error("This text adventure is under review and cannot be edited.");
  current(session, signal);
  const result = detail(
    await api.put(`${base}/${gameId}`, {
      service: "studio",
      signal,
      retry: false,
      data,
      timeout: data.worldviewDocxUrl ? 180_000 : 45_000,
    }),
    session,
    gameId
  );
  current(session, signal);
  return result;
}
export async function transitionTextAdventure(
  gameId: string,
  input: TextGameCreatorAction,
  session: TextAdventureSession,
  signal: AbortSignal
) {
  current(session, signal);
  const action = TextGameCreatorActionSchema.parse(input);
  const fresh = await getTextAdventure(gameId, session, signal);
  if (!isTextGameCreatorActionAllowed(fresh.status, action))
    throw new Error("This action is not available for the text adventure's current status.");
  current(session, signal);
  const result = detail(
    await api.post(`${base}/${gameId}/status`, {
      service: "studio",
      signal,
      retry: false,
      data: { action },
    }),
    session,
    gameId
  );
  current(session, signal);
  const expected = textGameStatusAfterCreatorAction(action);
  if (result.status !== expected)
    throw new Error(`Text adventure returned ${result.status}; expected ${expected}.`);
  return result;
}
