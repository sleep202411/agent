import {
  TEXT_GAME_STREAMING_ASSISTANT_ID,
  TextGameChatInputSchema,
  TextGameIdSchema,
  TextGamePlaySessionSchema,
  TextGameSessionIdSchema,
  TextGameStartInputSchema,
  TextGameStreamChatMetaSchema,
  TextGameStreamDoneSchema,
  TextGameStreamStartMetaSchema,
  type TextGameChatResponse,
  type TextGameLocale,
  type TextGameMessage,
  type TextGamePlaySession,
} from "@repo/shared/text-game";
import { api } from "@/src/lib/api";
import { readTextGameSse } from "./text-game-sse";

export const playerTextGameKeys = {
  all: ["player-text-game"] as const,
  session: (viewerId: string | null, gameId: string, locale: TextGameLocale) =>
    [...playerTextGameKeys.all, "session", viewerId, gameId, locale] as const,
};

export type TextGameSessionStreamHandlers = {
  onSession?: (session: TextGamePlaySession) => void;
  signal?: AbortSignal;
};

function streamingAssistant(content = "", createdAt?: string): TextGameMessage {
  return {
    id: TEXT_GAME_STREAMING_ASSISTANT_ID,
    role: "assistant",
    content,
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

function replaceAssistant(
  messages: TextGameMessage[],
  assistant: TextGameMessage
): TextGameMessage[] {
  const without = messages.filter((message) => message.id !== TEXT_GAME_STREAMING_ASSISTANT_ID);
  return [...without, assistant];
}

export async function getPlayingTextGameSession(
  gameId: string,
  signal?: AbortSignal
): Promise<TextGamePlaySession | null> {
  const requestedGameId = TextGameIdSchema.parse(gameId);
  const data = await api.get<unknown>(
    `/api/player/text-game/${encodeURIComponent(requestedGameId)}/playing-session`,
    { timeout: 45_000, signal }
  );
  signal?.throwIfAborted();
  if (data == null) return null;
  const session = TextGamePlaySessionSchema.parse(data);
  assertSessionGame(session, requestedGameId);
  if (!session.resumed) {
    throw new Error("Java returned resumed=false for an existing text-adventure session.");
  }
  return session;
}

export async function startTextGameSession(
  gameId: string,
  locale: TextGameLocale,
  handlers?: TextGameSessionStreamHandlers
): Promise<TextGamePlaySession> {
  const requestedGameId = TextGameIdSchema.parse(gameId);
  const input = TextGameStartInputSchema.parse({ locale });
  let session: TextGamePlaySession | null = null;
  let draft = "";
  let completed = false;

  await readTextGameSse(
    `/api/player/text-game/${encodeURIComponent(requestedGameId)}/start/stream`,
    input,
    (frame) => {
      if (frame.event === "meta") {
        const meta = TextGameStreamStartMetaSchema.parse(frame.data);
        assertSessionGame(meta, requestedGameId);
        if (meta.resumed) {
          throw new Error("Java returned resumed=true when starting a new text-adventure session.");
        }
        session = {
          ...meta,
          messages: [streamingAssistant("", meta.startedAt)],
        };
        handlers?.onSession?.(session);
        return;
      }
      if (frame.event === "delta") {
        const text = deltaText(frame.data);
        if (!text || !session) return;
        draft += text;
        session = {
          ...session,
          messages: replaceAssistant(
            session.messages,
            streamingAssistant(draft, session.startedAt)
          ),
        };
        handlers?.onSession?.(session);
        return;
      }
      if (frame.event === "done") {
        const done = TextGameStreamDoneSchema.parse(frame.data);
        if (!session) {
          throw new Error("Java sent text-adventure done before session meta.");
        }
        if (done.sessionId !== session.sessionId) {
          throw new Error(
            `Java returned text-adventure session ${done.sessionId} while ${session.sessionId} was requested.`
          );
        }
        completed = true;
        session = {
          ...session,
          messages: replaceAssistant(session.messages, {
            id: done.messageId,
            role: "assistant",
            content: done.content,
            createdAt: session.startedAt,
          }),
        };
        handlers?.onSession?.(session);
      }
    },
    handlers?.signal
  );

  if (!session) {
    throw new Error("Java closed the text-adventure start stream without session meta.");
  }
  if (!completed)
    throw new Error("Java closed the text-adventure start stream without completion.");
  return session;
}

export async function loadOrStartTextGameSession(
  gameId: string,
  locale: TextGameLocale,
  handlers?: TextGameSessionStreamHandlers
): Promise<TextGamePlaySession> {
  return (
    (await getPlayingTextGameSession(gameId, handlers?.signal)) ??
    startTextGameSession(gameId, locale, handlers)
  );
}

export async function sendTextGameAction(
  sessionId: string,
  message: string,
  locale: TextGameLocale,
  handlers?: {
    signal?: AbortSignal;
    onUserMessage?: (message: TextGameMessage) => void;
    onAssistantDelta?: (text: string) => void;
    onAssistantDone?: (message: TextGameMessage) => void;
  }
): Promise<TextGameChatResponse> {
  const requestedSessionId = TextGameSessionIdSchema.parse(sessionId);
  const input = TextGameChatInputSchema.parse({ message, locale });
  let userMessage: TextGameMessage | null = null;
  let assistantMessage: TextGameMessage | null = null;

  await readTextGameSse(
    `/api/player/text-game/sessions/${encodeURIComponent(requestedSessionId)}/chat/stream`,
    input,
    (frame) => {
      if (frame.event === "meta") {
        const meta = TextGameStreamChatMetaSchema.parse(frame.data);
        if (meta.sessionId !== requestedSessionId) {
          throw new Error(
            `Java returned text-adventure session ${meta.sessionId} while ${requestedSessionId} was requested.`
          );
        }
        userMessage = meta.userMessage;
        handlers?.onUserMessage?.(meta.userMessage);
        return;
      }
      if (frame.event === "delta") {
        const text = deltaText(frame.data);
        if (!text) return;
        handlers?.onAssistantDelta?.(text);
        return;
      }
      if (frame.event === "done") {
        const done = TextGameStreamDoneSchema.parse(frame.data);
        if (done.sessionId !== requestedSessionId) {
          throw new Error(
            `Java returned text-adventure session ${done.sessionId} while ${requestedSessionId} was requested.`
          );
        }
        assistantMessage = {
          id: done.messageId,
          role: "assistant",
          content: done.content,
          createdAt: new Date().toISOString(),
        };
        handlers?.onAssistantDone?.(assistantMessage);
      }
    },
    handlers?.signal
  );

  if (!userMessage || !assistantMessage) {
    throw new Error("Java closed the text-adventure chat stream before it finished.");
  }
  return { sessionId: requestedSessionId, userMessage, assistantMessage };
}

function deltaText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const text = (data as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function assertSessionGame(session: { gameId: string }, expectedGameId: string): void {
  if (session.gameId !== expectedGameId) {
    throw new Error(
      `Java returned text adventure ${session.gameId} while ${expectedGameId} was requested.`
    );
  }
}
