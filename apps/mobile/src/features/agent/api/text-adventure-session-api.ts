import {
  TEXT_GAME_STREAM_TIMEOUT_MS,
  TEXT_GAME_STREAMING_ASSISTANT_ID,
  TextGameIdSchema,
  TextGameSessionIdSchema,
  TextGamePlaySessionSchema,
  TextGameStartInputSchema,
  TextGameChatInputSchema,
  TextGameStreamStartMetaSchema,
  TextGameStreamChatMetaSchema,
  TextGameStreamDoneSchema,
  parseTextGameSseFrame,
  textGameStreamErrorMessage,
  type TextGameSseFrame,
  type TextGameLocale,
  type TextGamePlaySession,
  type TextGameMessage,
  type TextGameChatResponse,
} from "@repo/shared/text-game";
import { api, postApiStream } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import type { TextAdventureSession } from "./text-adventure-api";
const base = "/api/player/text-game";
function current(account: TextAdventureSession, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!account.userId || account.generation !== getAuthGeneration())
    throw new Error("Text adventure account changed.");
}
async function stream(
  path: string,
  data: unknown,
  account: TextAdventureSession,
  signal: AbortSignal,
  frame: (value: TextGameSseFrame) => void
) {
  current(account, signal);
  let buffer = "",
    size = 0;
  let firstChunk = true;
  await postApiStream(
    path,
    { data, service: "studio", signal, timeout: TEXT_GAME_STREAM_TIMEOUT_MS },
    (chunk) => {
      current(account, signal);
      if (firstChunk && chunk.length) {
        chunk = chunk.replace(/^\uFEFF/, "");
        firstChunk = false;
      }
      size += chunk.length;
      if (size > 8 * 1024 * 1024)
        throw new Error("Text adventure response exceeded the supported size.");
      buffer = (buffer + chunk).replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const parsed = parseTextGameSseFrame(raw);
        if (!parsed && raw.split("\n").some((line) => line.startsWith("data:")))
          throw new Error("Invalid text adventure event data.");
        if (!parsed) continue;
        if (parsed.event === "error")
          throw new Error(
            textGameStreamErrorMessage(parsed.data, "Text adventure request failed.")
          );
        frame(parsed);
      }
      if (buffer.length > 1024 * 1024)
        throw new Error("Text adventure event exceeded the supported size.");
    }
  );
  current(account, signal);
  if (buffer.trim()) throw new Error("Text adventure stream ended with an incomplete event.");
}
export async function getPlayingTextAdventureSession(
  gameId: string,
  account: TextAdventureSession,
  signal: AbortSignal
) {
  current(account, signal);
  TextGameIdSchema.parse(gameId);
  const raw = await api.get(`${base}/${gameId}/playing-session`, {
    service: "studio",
    signal,
    retry: false,
  });
  current(account, signal);
  if (raw === null) return null;
  const result = TextGamePlaySessionSchema.parse(raw);
  if (result.gameId !== gameId || !result.resumed)
    throw new Error("Unexpected text adventure session.");
  if (new Set(result.messages.map((message) => message.id)).size !== result.messages.length)
    throw new Error("Duplicate text adventure messages returned.");
  return result;
}
export async function startTextAdventureSession(
  gameId: string,
  locale: TextGameLocale,
  account: TextAdventureSession,
  signal: AbortSignal,
  onSession?: (session: TextGamePlaySession) => void
): Promise<TextGamePlaySession> {
  current(account, signal);
  TextGameIdSchema.parse(gameId);
  const input = TextGameStartInputSchema.parse({ locale });
  let result: TextGamePlaySession | undefined,
    done = false,
    draft = "";
  await stream(`${base}/${gameId}/start/stream`, input, account, signal, (frame) => {
    if (frame.event === "ready") return;
    if (done) throw new Error("Text adventure sent an event after completion.");
    if (frame.event === "meta") {
      if (result) throw new Error("Duplicate text adventure session metadata.");
      const meta = TextGameStreamStartMetaSchema.parse(frame.data);
      if (meta.gameId !== gameId || meta.resumed)
        throw new Error("Unexpected new text adventure session.");
      result = { ...meta, messages: [] };
    } else if (frame.event === "delta" || frame.event === "done") {
      if (!result) throw new Error("Text adventure sent content before session metadata.");
      if (frame.event === "delta") {
        const text = (frame.data as { text?: unknown } | null)?.text;
        if (typeof text !== "string") throw new Error("Invalid text adventure delta.");
        draft += text;
        result = {
          ...result,
          messages: [
            {
              id: TEXT_GAME_STREAMING_ASSISTANT_ID,
              role: "assistant",
              content: draft,
              createdAt: result.startedAt,
            },
          ],
        };
      } else {
        const final = TextGameStreamDoneSchema.parse(frame.data);
        if (final.sessionId !== result.sessionId)
          throw new Error("Text adventure session mismatch.");
        result = {
          ...result,
          messages: [
            {
              id: final.messageId,
              role: "assistant",
              content: final.content,
              createdAt: result.startedAt,
            },
          ],
        };
        done = true;
      }
    } else return;
    if (result) onSession?.(result);
  });
  if (!result || !done)
    throw new Error(
      "Text adventure stream closed before completion. Refresh the session before trying again."
    );
  return result;
}
export async function sendTextAdventureAction(
  sessionId: string,
  message: string,
  locale: TextGameLocale,
  account: TextAdventureSession,
  signal: AbortSignal,
  handlers?: {
    onUserMessage?: (message: TextGameMessage) => void;
    onAssistantDelta?: (text: string) => void;
    onAssistantDone?: (message: TextGameMessage) => void;
  }
): Promise<TextGameChatResponse> {
  current(account, signal);
  TextGameSessionIdSchema.parse(sessionId);
  const input = TextGameChatInputSchema.parse({ message, locale });
  let userMessage: TextGameChatResponse["userMessage"] | undefined;
  let assistantMessage: TextGameChatResponse["assistantMessage"] | undefined;
  await stream(`${base}/sessions/${sessionId}/chat/stream`, input, account, signal, (frame) => {
    if (frame.event === "ready") return;
    if (assistantMessage) throw new Error("Text adventure sent an event after completion.");
    if (frame.event === "meta") {
      if (userMessage) throw new Error("Duplicate text adventure chat metadata.");
      const meta = TextGameStreamChatMetaSchema.parse(frame.data);
      if (meta.sessionId !== sessionId) throw new Error("Text adventure session mismatch.");
      userMessage = meta.userMessage;
      handlers?.onUserMessage?.(userMessage);
    } else if (frame.event === "delta" || frame.event === "done") {
      if (!userMessage) throw new Error("Text adventure sent content before chat metadata.");
      if (frame.event === "delta") {
        const text = (frame.data as { text?: unknown } | null)?.text;
        if (typeof text !== "string") throw new Error("Invalid text adventure delta.");
        handlers?.onAssistantDelta?.(text);
      } else {
        const final = TextGameStreamDoneSchema.parse(frame.data);
        if (final.sessionId !== sessionId || final.messageId === userMessage.id)
          throw new Error("Text adventure message identity mismatch.");
        assistantMessage = {
          id: final.messageId,
          role: "assistant",
          content: final.content,
          createdAt: new Date().toISOString(),
        };
        handlers?.onAssistantDone?.(assistantMessage);
      }
    }
  });
  if (!userMessage || !assistantMessage)
    throw new Error(
      "Text adventure stream closed before completion. Refresh the session before trying again."
    );
  return { sessionId, userMessage, assistantMessage };
}
