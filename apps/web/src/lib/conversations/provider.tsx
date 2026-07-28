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
 *   2. Buffers `message.created` frames behind an authoritative REST
 *      pass, then replays by id so a stale response cannot erase a
 *      realtime message or establish the wrong total order.
 *   3. Surfaces a non-intrusive toast for an incoming message when
 *      it's NOT from the viewer themselves and they're NOT already
 *      on the matching conversation page.
 *   4. Auto-reconnect handled inside the WS client; every authenticated
 *      `ready` boundary awaits the same buffered recovery protocol.
 *
 * Logged-out users: provider no-ops; no WS opened.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ConversationDTO } from "@repo/shared/conversation";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { openConversationWs, type ConversationWsClient } from "./ws-client";
import {
  createConversationRecoveryCoordinator,
  conversationKeys,
} from "@/app/(site)/creators/_hooks/use-conversations";

export function ConversationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const router = useRouter();
  const t = useTranslations("messages");
  const locale = useLocale() as Locale;

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
    const recovery = createConversationRecoveryCoordinator(qc);
    clientRef.current = openConversationWs({
      onMessage: (data) => {
        // Do not patch a realtime frame directly over an in-flight
        // recovery response. The coordinator buffers by message id,
        // awaits the authoritative REST order, then replays and repeats
        // when another frame arrived during that request.
        void recovery.receiveMessage(data);

        // Toast if the message is incoming (not from us) and we're
        // not already on the /messages/[id] page for it. The
        // pathname check is permissive — covers locale-prefixed
        // routes (`/en-US/messages/abc`) by suffix match.
        const isMine = data.message.authorId === uid;
        if (isMine) return;
        const onInboxConversation =
          typeof window !== "undefined" &&
          window.location.pathname.endsWith(`/messages/${data.conversationId}`);
        const timelineQuery = qc.getQueryCache().find({
          queryKey: conversationKeys.messages(data.conversationId),
          exact: true,
        });
        const timelineVisible =
          typeof document !== "undefined" &&
          document.visibilityState === "visible" &&
          (timelineQuery?.getObserversCount() ?? 0) > 0;
        // The same timeline can be embedded in a crew workspace, whose
        // pathname does not contain the conversation id. An observed,
        // visible timeline is the reliable "already reading it" signal.
        if (onInboxConversation || timelineVisible) return;

        const detail = qc.getQueryData<ConversationDTO>(
          conversationKeys.detail(data.conversationId)
        );
        const preview =
          data.message.type === "text"
            ? data.message.body.slice(0, 80)
            : data.message.type === "proposal"
              ? t("toastNewProposal")
              : detail?.contextType === "crew"
                ? t("toastNewCrewUpdate")
                : t("toastNewSystemMessage");
        toast(preview, {
          action: {
            label: t("toastOpen"),
            onClick: () => router.push(localizePath(`/messages/${data.conversationId}`, locale)),
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
      onReady: () => {
        // The server sends ready only after auth + user-channel
        // registration. A buffered, awaited recovery here (including
        // on the first connection) closes both startup and reconnect
        // gaps without allowing an older REST response to erase a
        // realtime frame.
        void recovery.recoverAll();
      },
    });

    return () => {
      recovery.dispose();
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [user?.id, qc, router, t, locale]);

  return <>{children}</>;
}
