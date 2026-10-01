import {
  TextGameChatResponseSchema,
  TextGameIdSchema,
  TextGamePlaySessionSchema,
  TextGameStreamStartMetaSchema,
  TextGameStreamChatMetaSchema,
  TextGameStreamDoneSchema,
  takeTextGameSseFrames,
  textGameStreamErrorMessage,
  type TextGamePlaySession,
  type TextGameLocale,
} from "@repo/shared/text-game";
import { api, type ApiBinaryResponse } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import type { TextAdventureSession } from "./text-adventure-api";
function current(session: TextAdventureSession, signal: AbortSignal) {
  if (signal.aborted || session.generation !== getAuthGeneration())
    throw new Error("Text adventure session changed.");
}
async function stream(
  path: string,
  data: object,
  session: TextAdventureSession,
  signal: AbortSignal
) {
  current(session, signal);
  const result = await api.post<ApiBinaryResponse>(path, {
    data,
    signal,
    service: "studio",
    retry: false,
    responseType: "binary",
    headers: { Accept: "text/event-stream" },
    timeout: 180_000,
  });
  current(session, signal);
  if (!result.contentType?.includes("text/event-stream"))
    throw new Error("Expected a text adventure response stream.");
  const { frames, rest } = takeTextGameSseFrames(
    new TextDecoder().decode(result.bytes).replace(/\r\n/g, "\n")
  );
  if (rest.trim())
    throw new Error("Text adventure response was interrupted. Reload before continuing.");
  for (const frame of frames)
    if (frame.event === "error")
      throw new Error(textGameStreamErrorMessage(frame.data, "Text adventure failed."));
  const meta = frames.find((frame) => frame.event === "meta");
  const done = frames.find((frame) => frame.event === "done");
  if (!meta || !done)
    throw new Error("Text adventure response was interrupted. Reload before continuing.");
  return { meta: meta.data, done: TextGameStreamDoneSchema.parse(done.data) };
}
export async function loadTextAdventurePreview(
  gameId: string,
  locale: TextGameLocale,
  session: TextAdventureSession,
  signal: AbortSignal
) {
  TextGameIdSchema.parse(gameId);
  current(session, signal);
  const data = await api.get<unknown>(`/api/player/text-game/${gameId}/playing-session`, {
    service: "studio",
    signal,
    retry: false,
  });
  current(session, signal);
  if (data != null) {
    const existing = TextGamePlaySessionSchema.parse(data);
    if (existing.gameId !== gameId || !existing.resumed)
      throw new Error("Text adventure preview identity mismatch.");
    return existing;
  }
  const result = await stream(
    `/api/player/text-game/${gameId}/start/stream`,
    { locale },
    session,
    signal
  );
  const meta = TextGameStreamStartMetaSchema.parse(result.meta);
  if (meta.gameId !== gameId || meta.resumed || meta.sessionId !== result.done.sessionId)
    throw new Error("Text adventure preview identity mismatch.");
  return TextGamePlaySessionSchema.parse({
    ...meta,
    messages: [
      {
        id: result.done.messageId,
        role: "assistant",
        content: result.done.content,
        createdAt: meta.startedAt,
      },
    ],
  });
}
export async function sendTextAdventurePreview(
  previous: TextGamePlaySession,
  message: string,
  locale: TextGameLocale,
  session: TextAdventureSession,
  signal: AbortSignal
) {
  const text = message.trim();
  if (!text) throw new Error("Enter a message.");
  const result = await stream(
    `/api/player/text-game/sessions/${previous.sessionId}/chat/stream`,
    { message: text, locale },
    session,
    signal
  );
  const meta = TextGameStreamChatMetaSchema.parse(result.meta);
  if (meta.sessionId !== previous.sessionId || result.done.sessionId !== previous.sessionId)
    throw new Error("Text adventure preview identity mismatch.");
  const response = TextGameChatResponseSchema.parse({
    ...meta,
    assistantMessage: {
      id: result.done.messageId,
      role: "assistant",
      content: result.done.content,
      createdAt: meta.userMessage.createdAt,
    },
  });
  return {
    ...previous,
    messages: [...previous.messages, response.userMessage, response.assistantMessage],
  };
}
