import {
  TextGameIdSchema,
  TextGameSummaryListSchema,
  TextGameDetailSchema,
} from "@repo/shared/text-game";
import { api } from "@/lib/api-client";
const base = "/api/player/text-game";
export async function listPublishedTextGames(signal: AbortSignal) {
  signal.throwIfAborted();
  const rows = TextGameSummaryListSchema.parse(
    await api.get(base, { service: "studio", signal, retry: false })
  );
  signal.throwIfAborted();
  if (rows.some((row) => row.status !== "published"))
    throw new Error("The public catalogue returned an unpublished text adventure.");
  if (new Set(rows.map((row) => row.gameId)).size !== rows.length)
    throw new Error("The public catalogue returned duplicate text adventures.");
  return rows;
}
export async function getPublishedTextGame(gameId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  TextGameIdSchema.parse(gameId);
  const result = TextGameDetailSchema.parse(
    await api.get(`${base}/${gameId}`, { service: "studio", signal, retry: false })
  );
  signal.throwIfAborted();
  if (result.gameId !== gameId || result.status !== "published")
    throw new Error("The public player returned an unexpected text adventure.");
  if (result.content.worldviewDocxUrl !== null)
    throw new Error("The public player exposed a private source document.");
  return result;
}
