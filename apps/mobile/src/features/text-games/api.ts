import {
  TextGameIdSchema,
  TextGameDetailSchema,
  TextGameSummaryListSchema,
} from "@repo/shared/text-game";
import { api } from "@/lib/api-client";
const base = "/api/player/text-game";
export async function listPublicTextGames(signal: AbortSignal) {
  signal.throwIfAborted();
  const rows = TextGameSummaryListSchema.parse(
    await api.get(base, { service: "studio", signal, retry: false })
  );
  signal.throwIfAborted();
  if (rows.some((row) => row.status !== "published"))
    throw new Error("The public catalogue returned an unpublished adventure.");
  if (new Set(rows.map((row) => row.gameId)).size !== rows.length)
    throw new Error("The public catalogue returned duplicate adventures.");
  return rows;
}
export async function getPublicTextGame(gameId: string, signal: AbortSignal) {
  TextGameIdSchema.parse(gameId);
  signal.throwIfAborted();
  const result = TextGameDetailSchema.parse(
    await api.get(`${base}/${gameId}`, { service: "studio", signal, retry: false })
  );
  signal.throwIfAborted();
  if (result.gameId !== gameId || result.status !== "published")
    throw new Error("The published adventure is no longer available.");
  if (result.content.worldviewDocxUrl !== null)
    throw new Error("The public adventure response exposed a private document.");
  return result;
}
