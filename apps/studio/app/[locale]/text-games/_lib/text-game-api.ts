import {
  TextGameDetailSchema,
  TextGameSummaryListSchema,
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
  return TextGameDetailSchema.parse(
    await api.get<unknown>(`/api/user/text-game/${encodeURIComponent(gameId)}`)
  );
}

export async function createCreatorTextGame(input: TextGameCreateInput): Promise<TextGameDetail> {
  return TextGameDetailSchema.parse(
    await api.post<unknown>("/api/user/text-game", {
      data: input,
      timeout: 3 * 60_000,
    })
  );
}

export async function updateCreatorTextGame(
  gameId: string,
  input: TextGameUpdateInput
): Promise<TextGameDetail> {
  return TextGameDetailSchema.parse(
    await api.put<unknown>(`/api/user/text-game/${encodeURIComponent(gameId)}`, {
      data: input,
      timeout: input.worldviewDocxUrl ? 3 * 60_000 : 45_000,
    })
  );
}

export async function transitionCreatorTextGame(
  gameId: string,
  action: "submit" | "offline"
): Promise<TextGameDetail> {
  return TextGameDetailSchema.parse(
    await api.post<unknown>(`/api/user/text-game/${encodeURIComponent(gameId)}/status`, {
      data: { action },
    })
  );
}
