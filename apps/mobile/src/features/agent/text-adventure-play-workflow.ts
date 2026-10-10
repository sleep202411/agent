import { z } from "zod";
import type { TextGameLocale, TextGamePlaySession } from "@repo/shared/text-game";
import { getPublishedTextGame } from "@/data/text-game-api";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { durableRecordKey } from "@/lib/durable-record-key";
import { clientRequestKey } from "@/lib/client-request-key";
import { getTextAdventure, type TextAdventureSession } from "./api/text-adventure-api";
import {
  getPlayingTextAdventureSession,
  startTextAdventureSession,
  sendTextAdventureAction,
} from "./api/text-adventure-session-api";
import { withTextPlayLock } from "./text-adventure-play-lock";
const pendingSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    kind: z.literal("start"),
    previousSessionId: z.string().nullable(),
    createdSessionId: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("action"),
    sessionId: z.string(),
    message: z.string().min(1),
    userMessageId: z.string().optional(),
  }),
]);
export type PendingTextPlay = z.infer<typeof pendingSchema>;
export function textAdventurePlayWorkflow(
  gameId: string,
  account: TextAdventureSession,
  mode: "creator" | "public" = "creator"
) {
  const storage = durableRecord("text-adventure-play", account.userId, gameId);
  const key = durableRecordKey("text-adventure-play", account.userId, gameId);
  const current = (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (account.generation !== getAuthGeneration())
      throw new Error("Text adventure account changed.");
  };
  const read = (): PendingTextPlay | null => {
    current();
    const raw = storage.read();
    return raw === null || raw === "null" ? null : pendingSchema.parse(JSON.parse(raw));
  };
  const write = (pending: PendingTextPlay | null) => {
    current();
    storage.write(JSON.stringify(pending === null ? null : pendingSchema.parse(pending)));
  };
  const ready = () => {
    if (read())
      throw new Error(
        "An earlier action has an unknown result. Check the session before continuing."
      );
  };
  const refresh = (signal: AbortSignal) =>
    withTextPlayLock(key, async () => {
      current(signal);
      const pending = read();
      const session = await getPlayingTextAdventureSession(gameId, account, signal);
      current(signal);
      if (pending && session) {
        let resolved = false;
        if (pending.kind === "start") {
          resolved =
            session.sessionId === pending.createdSessionId &&
            session.sessionId !== pending.previousSessionId &&
            session.messages.some((m) => m.role === "assistant");
        } else if (session.sessionId === pending.sessionId) {
          // Without a server request ID, only a returned user-message ID is conclusive.
          // Matching text alone could be another device's identical action.
          const index = pending.userMessageId
            ? session.messages.findIndex(
                (m) =>
                  m.id === pending.userMessageId &&
                  m.role === "user" &&
                  m.content === pending.message
              )
            : -1;
          if (index >= 0) {
            const after = session.messages.slice(index + 1);
            const nextUser = after.findIndex((m) => m.role === "user");
            resolved = after
              .slice(0, nextUser < 0 ? undefined : nextUser)
              .some((m) => m.role === "assistant");
          }
        }
        if (resolved) write(null);
      }
      return { session, pending: read() };
    });
  return {
    read,
    refresh,
    start: (
      previousSessionId: string | null,
      locale: TextGameLocale,
      signal: AbortSignal,
      onSession: (session: TextGamePlaySession) => void
    ) =>
      withTextPlayLock(key, async () => {
        current(signal);
        ready();
        if (mode === "public") await getPublishedTextGame(gameId, signal);
        else {
          const game = await getTextAdventure(gameId, account, signal);
          if (game.publishedVersionId === null)
            throw new Error("Publish this work before starting a play session.");
        }
        const latest = await getPlayingTextAdventureSession(gameId, account, signal);
        current(signal);
        if ((latest?.sessionId ?? null) !== previousSessionId)
          throw new Error("The play session changed. Refresh before starting over.");
        const pending: Extract<PendingTextPlay, { kind: "start" }> = {
          id: clientRequestKey(),
          kind: "start",
          previousSessionId,
        };
        write(pending);
        const result = await startTextAdventureSession(
          gameId,
          locale,
          account,
          signal,
          (session) => {
            current(signal);
            if (session.sessionId === previousSessionId)
              throw new Error("The server did not return a new play session.");
            if (!pending.createdSessionId) {
              pending.createdSessionId = session.sessionId;
              write(pending);
            }
            onSession(session);
          }
        );
        current(signal);
        write(null);
        return result;
      }),
    send: (
      snapshot: TextGamePlaySession,
      message: string,
      locale: TextGameLocale,
      signal: AbortSignal,
      onSession: (session: TextGamePlaySession) => void
    ) =>
      withTextPlayLock(key, async () => {
        current(signal);
        ready();
        const latest = await getPlayingTextAdventureSession(gameId, account, signal);
        current(signal);
        if (
          !latest ||
          latest.sessionId !== snapshot.sessionId ||
          JSON.stringify(
            latest.messages.map(({ id, role, content }) => ({ id, role, content }))
          ) !==
            JSON.stringify(
              snapshot.messages.map(({ id, role, content }) => ({ id, role, content }))
            )
        )
          throw new Error("The play session changed. Refresh before sending another action.");
        if (latest.messages.at(-1)?.role !== "assistant")
          throw new Error("Wait for the current story response before sending another action.");
        const text = message.trim();
        if (!text) throw new Error("Enter an action.");
        let pending: Extract<PendingTextPlay, { kind: "action" }> = {
          id: clientRequestKey(),
          kind: "action",
          sessionId: latest.sessionId,
          message: text,
        };
        write(pending);
        let display = latest,
          draft = "";
        const result = await sendTextAdventureAction(
          latest.sessionId,
          text,
          locale,
          account,
          signal,
          {
            onUserMessage: (user) => {
              current(signal);
              if (latest.messages.some((m) => m.id === user.id) || user.content !== text)
                throw new Error("Unexpected text adventure action receipt.");
              pending = { ...pending, userMessageId: user.id };
              write(pending);
              display = { ...latest, messages: [...latest.messages, user] };
              onSession(display);
            },
            onAssistantDelta: (text) => {
              current(signal);
              draft += text;
              onSession({
                ...display,
                messages: [
                  ...display.messages,
                  { id: "streaming-assistant", role: "assistant", content: draft, createdAt: "" },
                ],
              });
            },
          }
        );
        current(signal);
        write(null);
        return {
          ...latest,
          messages: [...latest.messages, result.userMessage, result.assistantMessage],
        };
      }),
    clearUnknown: (id: string) =>
      withTextPlayLock(key, async () => {
        const pending = read();
        if (!pending || pending.id !== id)
          throw new Error("The pending action changed. Refresh before clearing it.");
        write(null);
      }),
  };
}
