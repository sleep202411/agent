import type { TextGamePlaySession, TextGameLocale } from "@repo/shared/text-game";
import type { TextAdventureSession } from "./text-adventure-api";
import {
  getPlayingTextAdventureSession,
  startTextAdventureSession,
  sendTextAdventureAction,
} from "./text-adventure-session-api";
export async function loadTextAdventurePreview(
  gameId: string,
  locale: TextGameLocale,
  session: TextAdventureSession,
  signal: AbortSignal
) {
  return (
    (await getPlayingTextAdventureSession(gameId, session, signal)) ??
    (await startTextAdventureSession(gameId, locale, session, signal))
  );
}
export async function sendTextAdventurePreview(
  previous: TextGamePlaySession,
  message: string,
  locale: TextGameLocale,
  session: TextAdventureSession,
  signal: AbortSignal
) {
  const response = await sendTextAdventureAction(
    previous.sessionId,
    message.trim(),
    locale,
    session,
    signal
  );
  return {
    ...previous,
    messages: [...previous.messages, response.userMessage, response.assistantMessage],
  };
}
