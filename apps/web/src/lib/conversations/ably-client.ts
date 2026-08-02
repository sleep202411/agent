"use client";

/**
 * One authenticated Ably connection per browser tab for all conversation
 * inbox/domain frames. Ably owns reconnection and connection continuity; the
 * provider still performs an authoritative REST recovery at every attach
 * boundary so Postgres ordering and authorization remain the source of truth.
 */
import * as Ably from "ably";
import {
  CONVERSATION_REALTIME_EVENT,
  conversationChannel,
  type ConversationContextType,
  type ConversationFrame,
  type ConversationRealtimeGrantDTO,
  type MessageDTO,
} from "@repo/shared/conversation";
import type { NotificationDTO } from "@repo/shared/notifications";

export interface ConversationRealtimeHandlers {
  onOpen?: () => void;
  onReady?: () => void;
  onReconnected?: () => void;
  onMessage?: (data: {
    conversationId: string;
    message: MessageDTO;
    lastMessageAt: string;
    unreadCount: number;
  }) => void;
  onReadAdvanced?: (data: {
    conversationId: string;
    userId: string;
    lastReadMessageId: string;
  }) => void;
  onContextChanged?: (data: {
    conversationId: string;
    from: ConversationContextType;
    to: ConversationContextType;
    contextId: string;
  }) => void;
  onCrewTaskChanged?: (data: {
    crewId: string;
    taskId: string;
    action: "created" | "updated" | "commented" | "submitted" | "reviewed" | "settled";
    actorUserId: string | null;
  }) => void;
  onCrewTaskProjectChanged?: (data: {
    crewId: string;
    resource:
      | "view"
      | "workflow"
      | "cycle"
      | "label"
      | "field"
      | "production_document"
      | "production_project"
      | "production_resource"
      | "production_activity"
      | "episode"
      | "delivery";
    resourceId: string;
    action: "created" | "updated" | "deleted" | "reordered";
    actorUserId: string | null;
  }) => void;
  onCrewAssetChanged?: (data: {
    crewId: string;
    nodeId: string;
    action: "created" | "updated" | "trashed" | "restored" | "deleted" | "permissions_updated";
    actorUserId: string | null;
  }) => void;
  onNotification?: (notification: NotificationDTO) => void;
  onTerminate?: (reason: string, code: number) => void;
  onClose?: (code: number, reason: string) => void;
}

export interface ConversationRealtimeClient {
  close(): void;
  readonly isOpen: boolean;
}

async function requestGrant(): Promise<ConversationRealtimeGrantDTO> {
  const response = await fetch("/aurora/conversations/realtime-token", {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Conversation realtime authorization failed (${response.status})`);
  }
  return (await response.json()) as ConversationRealtimeGrantDTO;
}

function asFrame(data: unknown): ConversationFrame | null {
  if (!data || typeof data !== "object" || !("event" in data)) return null;
  const event = (data as { event?: unknown }).event;
  if (
    event !== "message.created" &&
    event !== "read.advanced" &&
    event !== "context.changed" &&
    event !== "crew.task.changed" &&
    event !== "crew.task.project.changed" &&
    event !== "crew.asset.changed" &&
    event !== "notification.created" &&
    event !== "ready" &&
    event !== "terminate"
  ) {
    return null;
  }
  return data as ConversationFrame;
}

export function openConversationRealtime(
  userId: string,
  handlers: ConversationRealtimeHandlers
): ConversationRealtimeClient {
  let closed = false;
  let attachedOnce = false;

  const realtime = new Ably.Realtime({
    autoConnect: false,
    closeOnUnload: true,
    echoMessages: false,
    disconnectedRetryTimeout: 5_000,
    suspendedRetryTimeout: 15_000,
    authCallback: (_params, callback) => {
      void requestGrant()
        .then((grant) => callback(null, grant.tokenRequest as Ably.TokenRequest))
        .catch((error: unknown) =>
          callback(error instanceof Error ? error.message : String(error), null)
        );
    },
  });
  const channel = realtime.channels.get(conversationChannel(userId));

  channel.subscribe(CONVERSATION_REALTIME_EVENT, (message) => {
    const frame = asFrame(message.data);
    if (!frame) return;
    switch (frame.event) {
      case "message.created":
        handlers.onMessage?.(frame.data);
        break;
      case "read.advanced":
        handlers.onReadAdvanced?.(frame.data);
        break;
      case "context.changed":
        handlers.onContextChanged?.(frame.data);
        break;
      case "crew.task.changed":
        handlers.onCrewTaskChanged?.(frame.data);
        break;
      case "crew.task.project.changed":
        handlers.onCrewTaskProjectChanged?.(frame.data);
        break;
      case "crew.asset.changed":
        handlers.onCrewAssetChanged?.(frame.data);
        break;
      case "notification.created":
        handlers.onNotification?.(frame.data);
        break;
      case "terminate":
        handlers.onTerminate?.(frame.data.reason, frame.data.code);
        break;
      case "ready":
        break;
    }
  });

  channel.on((change) => {
    if (closed) return;
    if (change.current === "attached") {
      const reconnected = attachedOnce;
      attachedOnce = true;
      handlers.onReady?.();
      if (reconnected) handlers.onReconnected?.();
    }
    if (change.current === "failed") {
      const error = change.reason;
      handlers.onTerminate?.(
        error?.message ?? "Conversation realtime channel failed",
        error?.statusCode ?? 500
      );
    }
  });

  realtime.connection.on((change) => {
    if (closed) return;
    if (change.current === "connected") handlers.onOpen?.();
    if (change.current === "closed" || change.current === "failed") {
      handlers.onClose?.(change.reason?.statusCode ?? 0, change.reason?.message ?? change.current);
    }
  });

  realtime.connect();
  void channel.attach().catch((error: unknown) => {
    if (!closed) {
      handlers.onTerminate?.(
        error instanceof Error ? error.message : String(error),
        error instanceof Ably.ErrorInfo ? error.statusCode : 500
      );
    }
  });

  return {
    close() {
      if (closed) return;
      closed = true;
      channel.unsubscribe();
      void Promise.resolve(channel.detach()).catch(() => undefined);
      realtime.close();
    },
    get isOpen() {
      return channel.state === "attached";
    },
  };
}
