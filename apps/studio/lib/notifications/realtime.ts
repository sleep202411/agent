"use client";

import * as Ably from "ably";
import {
  CONVERSATION_REALTIME_EVENT,
  conversationChannel,
  type ConversationFrame,
  type ConversationRealtimeGrantDTO,
} from "@repo/shared/conversation";
import type { NotificationDTO } from "@repo/shared/notifications";
import { api } from "@/lib/api";

/** Notifications already share the authenticated conversation channel on the server. */
export function openNotificationsRealtime(
  userId: string,
  handlers: {
    onNotification: (notification: NotificationDTO) => void;
    onReady: () => void;
  }
) {
  let closed = false;
  const client = new Ably.Realtime({
    autoConnect: false,
    closeOnUnload: true,
    authCallback: (_params, callback) => {
      void api
        .get<ConversationRealtimeGrantDTO>("/aurora/conversations/realtime-token", {
          requestScope: "user",
          cache: "no-store",
        })
        .then(
          (grant) => callback(null, grant.tokenRequest as Ably.TokenRequest),
          (error: unknown) => callback(error instanceof Error ? error.message : String(error), null)
        );
    },
  });
  const channel = client.channels.get(conversationChannel(userId));
  channel.on("attached", () => {
    if (!closed) handlers.onReady();
  });
  void channel
    .subscribe(CONVERSATION_REALTIME_EVENT, (message) => {
      if (closed) return;
      const frame = message.data as ConversationFrame | undefined;
      if (frame?.event === "notification.created") handlers.onNotification(frame.data);
    })
    .catch((error: unknown) => {
      if (!closed) console.error("Notification subscription failed", error);
    });
  client.connect();
  return {
    close() {
      if (closed) return;
      closed = true;
      channel.unsubscribe();
      client.close();
    },
  };
}
