"use client";

import { useCurrentUser } from "@/src/hooks/use-user";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChatClient, ChatMessageEventType, LogLevel, type Room } from "@ably/chat";
import * as Ably from "ably";
import { toast } from "sonner";
import {
  CREW_CONVERSATION_METADATA_SCHEMA,
  crewConversationRoom,
  type CrewConversationRealtimeGrantDTO,
} from "@repo/shared/conversation";
import { conversationKeys } from "@/app/(site)/creators/_hooks/use-conversations";

async function requestRoomGrant(conversationId: string): Promise<CrewConversationRealtimeGrantDTO> {
  const response = await fetch(
    `/aurora/conversations/${encodeURIComponent(conversationId)}/realtime-token`,
    {
      credentials: "include",
      cache: "no-store",
    }
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Crew room authorization failed (${response.status})`);
  }
  return (await response.json()) as CrewConversationRealtimeGrantDTO;
}

function isFizzDragonSignal(metadata: unknown, conversationId: string): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const value = metadata as {
    schema?: unknown;
    conversationId?: unknown;
  };
  return (
    value.schema === CREW_CONVERSATION_METADATA_SCHEMA && value.conversationId === conversationId
  );
}

/**
 * Connects the workspace timeline to its one Ably Chat room.
 *
 * Message payloads from the room are deliberately never trusted as business
 * records. Any valid room signal triggers an authoritative Postgres refetch;
 * the private subscribe-only user channel carries the immediate typed frame.
 * This keeps a client-held room token unable to forge task/asset/system data.
 */
export function CrewChatRoom({
  conversationId,
  children,
}: {
  conversationId: string;
  children: React.ReactNode;
}) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const accountUserId = user?.id;

  useEffect(() => {
    if (!accountUserId) return;
    let disposed = false;
    const realtime = new Ably.Realtime({
      autoConnect: false,
      closeOnUnload: true,
      echoMessages: false,
      authCallback: (_params, callback) => {
        void requestRoomGrant(conversationId)
          .then((grant) => callback(null, grant.tokenRequest as Ably.TokenRequest))
          .catch((error: unknown) =>
            callback(error instanceof Error ? error.message : String(error), null)
          );
      },
    });
    const chat = new ChatClient(realtime, { logLevel: LogLevel.Error });
    const roomName = crewConversationRoom(conversationId);
    const failureToastId = `crew-chat-realtime:${conversationId}`;
    let room: Room | null = null;
    let unsubscribeMessages: (() => void) | null = null;

    const recover = () => {
      void Promise.all([
        qc.invalidateQueries({
          queryKey: conversationKeys.messages(conversationId, accountUserId),
          exact: true,
        }),
        qc.invalidateQueries({ queryKey: conversationKeys.inbox() }),
      ]);
    };

    void (async () => {
      try {
        room = await chat.rooms.get(roomName, {
          presence: { enableEvents: true },
        });
        const subscription = room.messages.subscribe((event) => {
          if (
            event.type === ChatMessageEventType.Created &&
            isFizzDragonSignal(event.message.metadata, conversationId)
          ) {
            recover();
          }
        });
        unsubscribeMessages = subscription.unsubscribe;

        realtime.connect();
        await room.attach();
        if (disposed) return;
        await room.presence.enter({ surface: "crew-workspace" });
        toast.dismiss(failureToastId);

        // Messages delivered before this subscription are Ably's continuity
        // boundary. One matching signal is enough to refetch the DB timeline.
        const history = await subscription.historyBeforeSubscribe({ limit: 1 });
        if (
          !disposed &&
          history.items.some((message) => isFizzDragonSignal(message.metadata, conversationId))
        ) {
          recover();
        }
      } catch (error: unknown) {
        if (!disposed) {
          toast.error(error instanceof Error ? error.message : String(error), {
            id: failureToastId,
          });
        }
      }
    })();

    return () => {
      disposed = true;
      unsubscribeMessages?.();
      const activeRoom = room;
      void Promise.resolve()
        .then(async () => {
          if (!activeRoom) return;
          await activeRoom.presence.leave().catch(() => undefined);
          await activeRoom.detach().catch(() => undefined);
          await chat.rooms.release(roomName).catch(() => undefined);
        })
        .finally(() => realtime.close());
    };
  }, [conversationId, qc, accountUserId]);

  return <>{children}</>;
}
