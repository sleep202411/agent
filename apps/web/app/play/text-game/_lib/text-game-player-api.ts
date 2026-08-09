import {
  TextGameChatInputSchema,
  TextGameChatResponseSchema,
  TextGameIdSchema,
  TextGamePlaySessionSchema,
  TextGameSessionIdSchema,
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
  const requestedGameId = TextGameIdSchema.parse(gameId);
  const data = await api.get<unknown>(
    `/api/player/text-game/${encodeURIComponent(requestedGameId)}/playing-session`,
    { timeout: 45_000 }
  );
  if (data == null) return null;
  const session = TextGamePlaySessionSchema.parse(data);
  assertSessionGame(session, requestedGameId);
  if (!session.resumed) {
    throw new Error("Java returned resumed=false for an existing text-adventure session.");
  }
  return session;
}

export async function startTextGameSession(gameId: string): Promise<TextGamePlaySession> {
  const requestedGameId = TextGameIdSchema.parse(gameId);
  const session = TextGamePlaySessionSchema.parse(
    await api.post<unknown>(`/api/player/text-game/${encodeURIComponent(requestedGameId)}/start`, {
      timeout: 2 * 60_000,
    })
  );
  assertSessionGame(session, requestedGameId);
  if (session.resumed) {
    throw new Error("Java returned resumed=true when starting a new text-adventure session.");
  }
  return session;
}

export async function loadOrStartTextGameSession(gameId: string): Promise<TextGamePlaySession> {
  return (await getPlayingTextGameSession(gameId)) ?? startTextGameSession(gameId);
}

export async function sendTextGameAction(
  sessionId: string,
  message: string
): Promise<TextGameChatResponse> {
  const requestedSessionId = TextGameSessionIdSchema.parse(sessionId);
  const input = TextGameChatInputSchema.parse({ message });
  const response = TextGameChatResponseSchema.parse(
    await api.post<unknown>(
      `/api/player/text-game/sessions/${encodeURIComponent(requestedSessionId)}/chat`,
      { data: input, timeout: 2 * 60_000 }
    )
  );
  if (response.sessionId !== requestedSessionId) {
    throw new Error(
      `Java returned text-adventure session ${response.sessionId} while ${requestedSessionId} was requested.`
    );
  }
  return response;
}

function assertSessionGame(session: TextGamePlaySession, expectedGameId: string): void {
  if (session.gameId !== expectedGameId) {
    throw new Error(
      `Java returned text adventure ${session.gameId} while ${expectedGameId} was requested.`
    );
  }
}
