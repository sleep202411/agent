import {
  TextGameCreateInputSchema,
  TextGameCreatorActionSchema,
  TextGameDetailSchema,
  TextGameSummaryListSchema,
  TextGameUpdateInputSchema,
  textGameStatusAfterCreatorAction,
  type TextGameCreatorAction,
  type TextGameCreateInput,
  type TextGameDetail,
  type TextGameSummary,
  type TextGameUpdateInput,
} from "@repo/shared/text-game";
import { api } from "@/lib/api";

export const textAdventureKeys = {
  all: ["text-adventures"] as const,
  list: (userId: string) => [...textAdventureKeys.all, "list", userId] as const,
  detail: (gameId: string, userId: string) =>
    [...textAdventureKeys.all, "detail", gameId, userId] as const,
};

export async function listCreatorTextAdventures(signal?: AbortSignal): Promise<TextGameSummary[]> {
  return TextGameSummaryListSchema.parse(
    await api.get<unknown>("/api/user/text-game", ...(signal ? [{ signal }] : []))
  );
}

export async function getCreatorTextAdventure(
  gameId: string,
  signal?: AbortSignal
): Promise<TextGameDetail> {
  return parseCreatorDetail(
    await api.get<unknown>(
      `/api/user/text-game/${encodeURIComponent(gameId)}`,
      ...(signal ? [{ signal }] : [])
    ),
    gameId
  );
}

export async function createCreatorTextAdventure(
  input: TextGameCreateInput,
  signal?: AbortSignal
): Promise<TextGameDetail> {
  const payload = TextGameCreateInputSchema.parse(input);
  const detail = TextGameDetailSchema.parse(
    await api.post<unknown>("/api/user/text-game", {
      data: payload,
      ...(signal ? { signal } : {}),
      timeout: 3 * 60_000,
    })
  );
  if (detail.status !== "draft") {
    throw new Error(`Java created text adventure ${detail.gameId} with status ${detail.status}.`);
  }
  return detail;
}

export async function updateCreatorTextAdventure(
  gameId: string,
  input: TextGameUpdateInput,
  signal?: AbortSignal
): Promise<TextGameDetail> {
  const payload = TextGameUpdateInputSchema.parse(input);
  return parseCreatorDetail(
    await api.put<unknown>(`/api/user/text-game/${encodeURIComponent(gameId)}`, {
      data: payload,
      ...(signal ? { signal } : {}),
      timeout: payload.worldviewDocxUrl ? 3 * 60_000 : 45_000,
    }),
    gameId
  );
}

export async function transitionCreatorTextAdventure(
  gameId: string,
  input: TextGameCreatorAction,
  signal?: AbortSignal
): Promise<TextGameDetail> {
  const action = TextGameCreatorActionSchema.parse(input);
  const detail = parseCreatorDetail(
    await api.post<unknown>(`/api/user/text-game/${encodeURIComponent(gameId)}/status`, {
      data: { action },
      ...(signal ? { signal } : {}),
    }),
    gameId
  );
  const expectedStatus = textGameStatusAfterCreatorAction(action);
  if (detail.status !== expectedStatus) {
    throw new Error(
      `Java returned status ${detail.status} after ${action}; expected ${expectedStatus}.`
    );
  }
  return detail;
}

function parseCreatorDetail(input: unknown, expectedGameId: string): TextGameDetail {
  const detail = TextGameDetailSchema.parse(input);
  if (detail.gameId !== expectedGameId) {
    throw new Error(
      `Java returned text adventure ${detail.gameId} while ${expectedGameId} was requested.`
    );
  }
  return detail;
}
