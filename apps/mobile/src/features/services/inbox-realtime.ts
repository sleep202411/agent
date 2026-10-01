import * as Ably from "ably";
import {
  conversationChannel,
  CONVERSATION_REALTIME_EVENT,
  type ConversationRealtimeGrantDTO,
} from "@repo/shared/conversation";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
/** Realtime is an invalidation signal; REST remains authoritative for ordering and permissions. */
export function openInboxRealtime(
  userId: string,
  generation: number,
  invalidate: () => void,
  onError: () => void
) {
  const abort = new AbortController();
  let closed = false;
  const current = () => !closed && getAuthGeneration() === generation;
  const realtime = new Ably.Realtime({
    autoConnect: false,
    echoMessages: false,
    authCallback: (_params, callback) => {
      if (!current()) {
        callback("Session changed", null);
        return;
      }
      void api
        .get<ConversationRealtimeGrantDTO>("/conversations/realtime-token", {
          service: "aurora",
          signal: abort.signal,
        })
        .then((grant) => {
          if (!current()) {
            callback("Session changed", null);
            return;
          }
          if (
            grant.channel !== conversationChannel(userId) ||
            grant.tokenRequest?.clientId !== userId
          )
            throw new Error("Realtime grant identity mismatch");
          callback(null, grant.tokenRequest as Ably.TokenRequest);
        })
        .catch((error) => {
          callback(error instanceof Error ? error.message : "Realtime authorization failed", null);
          if (current()) onError();
        });
    },
  });
  const channel = realtime.channels.get(conversationChannel(userId));
  const close = () => {
    if (closed) return;
    closed = true;
    abort.abort();
    channel.unsubscribe();
    realtime.close();
  };
  void channel
    .subscribe(CONVERSATION_REALTIME_EVENT, (message) => {
      if (!current() || !message.data || typeof message.data !== "object") return;
      const event = (message.data as { event?: unknown }).event;
      if (event === "terminate") {
        onError();
        close();
        return;
      }
      if (["message.created", "read.advanced", "context.changed"].includes(String(event)))
        invalidate();
    })
    .catch(() => {
      if (current()) onError();
    });
  channel.on((change) => {
    if (!current()) return;
    if (change.current === "attached") invalidate();
    if (change.current === "failed" || change.current === "suspended") onError();
  });
  realtime.connection.on((change) => {
    if (current() && ["failed", "suspended", "disconnected"].includes(change.current)) onError();
  });
  realtime.connect();
  return close;
}
