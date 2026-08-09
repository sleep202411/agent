import {
  TextGameChatResponseSchema,
  TextGamePlaySessionSchema,
  type TextGameChatResponse,
  type TextGamePlaySession,
} from "@repo/shared/text-game";
import { api } from "@/src/lib/api";

export const playerTextGameKeys = {
  all: ["player-text-game"] as const,
  progress: (gameId: string) => [...playerTextGameKeys.all, "progress", gameId] as const,
  session: (gameId: string) => [...playerTextGameKeys.all, "session", gameId] as const,
};

export async function getPlayingTextGameSession(
  gameId: string
): Promise<TextGamePlaySession | null> {
  const data = await api.get<unknown>(
    `/api/player/text-game/${encodeURIComponent(gameId)}/playing-session`,
    { timeout: 45_000 }
  );
  return data == null ? null : TextGamePlaySessionSchema.parse(data);
}

export async function startTextGameSession(gameId: string): Promise<TextGamePlaySession> {
  return TextGamePlaySessionSchema.parse(
    await api.post<unknown>(`/api/player/text-game/${encodeURIComponent(gameId)}/start`, {
      timeout: 2 * 60_000,
    })
  );
}

export async function loadOrStartTextGameSession(gameId: string): Promise<TextGamePlaySession> {
  return (await getPlayingTextGameSession(gameId)) ?? startTextGameSession(gameId);
}

export async function sendTextGameAction(
  sessionId: string,
  message: string
): Promise<TextGameChatResponse> {
  return TextGameChatResponseSchema.parse(
    await api.post<unknown>(
      `/api/player/text-game/sessions/${encodeURIComponent(sessionId)}/chat`,
      { data: { message }, timeout: 2 * 60_000 }
    )
  );
}
