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

export const textGameKeys = {
  all: ["text-games"] as const,
  list: () => [...textGameKeys.all, "list"] as const,
  detail: (gameId: string) => [...textGameKeys.all, "detail", gameId] as const,
};

export async function listCreatorTextGames(): Promise<TextGameSummary[]> {
  return TextGameSummaryListSchema.parse(await api.get<unknown>("/api/user/text-game"));
}

export async function getCreatorTextGame(gameId: string): Promise<TextGameDetail> {
  return parseCreatorDetail(
    await api.get<unknown>(`/api/user/text-game/${encodeURIComponent(gameId)}`),
    gameId
  );
}

export async function createCreatorTextGame(input: TextGameCreateInput): Promise<TextGameDetail> {
  const payload = TextGameCreateInputSchema.parse(input);
  const detail = TextGameDetailSchema.parse(
    await api.post<unknown>("/api/user/text-game", {
      data: payload,
      timeout: 3 * 60_000,
    })
  );
  if (detail.status !== "draft") {
    throw new Error(`Java created text adventure ${detail.gameId} with status ${detail.status}.`);
  }
  return detail;
}

export async function updateCreatorTextGame(
  gameId: string,
  input: TextGameUpdateInput
): Promise<TextGameDetail> {
  const payload = TextGameUpdateInputSchema.parse(input);
  return parseCreatorDetail(
    await api.put<unknown>(`/api/user/text-game/${encodeURIComponent(gameId)}`, {
      data: payload,
      timeout: payload.worldviewDocxUrl ? 3 * 60_000 : 45_000,
    }),
    gameId
  );
}

export async function transitionCreatorTextGame(
  gameId: string,
  input: TextGameCreatorAction
): Promise<TextGameDetail> {
  const action = TextGameCreatorActionSchema.parse(input);
  const detail = parseCreatorDetail(
    await api.post<unknown>(`/api/user/text-game/${encodeURIComponent(gameId)}/status`, {
      data: { action },
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
