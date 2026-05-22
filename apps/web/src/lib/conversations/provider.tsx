"use client";

/**
 * ConversationsProvider — bridges the conversation WS push channel
 * into React Query.
 *
 * Mount ONCE near the app root, INSIDE the auth boundary (after the
 * user is hydrated) but ABOVE any consumer of `useInbox` /
 * `useMessages`. The provider:
 *
 *   1. Opens a single WS to `/aurora/ws/conversations` when
 *      logged in; closes on logout.
 *   2. Patches the per-conversation timeline cache on every
 *      `message.created` frame so live views update without a
 *      refetch.
 *   3. Surfaces a non-intrusive toast for an incoming message when
 *      it's NOT from the viewer themselves and they're NOT already
 *      on the matching conversation page.
 *   4. Auto-reconnect handled inside the WS client; on reconnect we
 *      invalidate all conversation queries so any missed-while-
 *      offline messages are recovered from REST.
 *
 * Logged-out users: provider no-ops; no WS opened.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { openConversationWs, type ConversationWsClient } from "./ws-client";
import {
  applyIncomingMessage,
  conversationKeys,
} from "@/app/(site)/creators/_hooks/use-conversations";

export function ConversationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const router = useRouter();
  const t = useTranslations("messages");

  const clientRef = useRef<ConversationWsClient | null>(null);
  // Guard against re-opening on every parent re-render.
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    const uid = user?.id ?? null;
    if (!uid) {
      clientRef.current?.close();
      clientRef.current = null;
      userIdRef.current = null;
      return;
    }
    if (userIdRef.current === uid && clientRef.current) return;
    userIdRef.current = uid;

    clientRef.current?.close();
    clientRef.current = openConversationWs({
      onMessage: (data) => {
        applyIncomingMessage(qc, data.conversationId, data.message);
        // Inbox preview / unread badge stale.
        qc.invalidateQueries({ queryKey: conversationKeys.inbox() });

        // Toast if the message is incoming (not from us) and we're
        // not already on the /messages/[id] page for it. The
        // pathname check is permissive — covers locale-prefixed
        // routes (`/en-US/messages/abc`) by suffix match.
        const isMine = data.message.authorId === uid;
        if (isMine) return;
        const onConv =
          typeof window !== "undefined" &&
          window.location.pathname.endsWith(`/messages/${data.conversationId}`);
        if (onConv) return;

        const preview =
          data.message.type === "text"
            ? data.message.body.slice(0, 80)
            : data.message.type === "proposal"
              ? t("toastNewProposal")
              : t("toastNewSystemMessage");
        toast(preview, {
          action: {
            label: t("toastOpen"),
            onClick: () => router.push(`/messages/${data.conversationId}`),
          },
        });
      },
      onReadAdvanced: () => {
        // The other side's "read" advanced; inbox row may render a
        // read indicator in the future, so invalidate cheaply.
        qc.invalidateQueries({ queryKey: conversationKeys.inbox() });
      },
      onContextChanged: (data) => {
        qc.invalidateQueries({
          queryKey: conversationKeys.detail(data.conversationId),
        });
        qc.invalidateQueries({ queryKey: conversationKeys.inbox() });
      },
      onReconnected: () => {
        // Recover any missed messages by refetching every active
        // conversation surface.
        qc.invalidateQueries({ queryKey: conversationKeys.all });
      },
    });

    return () => {
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [user?.id, qc, router, t]);

  return <>{children}</>;
}
