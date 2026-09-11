"use client";

/**
 * ConversationsProvider — bridges the authenticated Ably user channel
 * into React Query.
 *
 * Mount ONCE near the app root, INSIDE the auth boundary (after the
 * user is hydrated) but ABOVE any consumer of `useInbox` /
 * `useMessages`. The provider:
 *
 *   1. Opens one Ably connection when logged in; closes on logout. The same
 *      authenticated user channel carries conversation, crew-task, and
 *      notification frames.
 *   2. Buffers `message.created` frames behind an authoritative REST
 *      pass, then replays by id so a stale response cannot erase a
 *      realtime message or establish the wrong total order.
 *   3. Surfaces a non-intrusive toast for an incoming message when
 *      it's NOT from the viewer themselves and they're NOT already
 *      on the matching conversation page.
 *   4. Ably owns continuity/reconnect; every authenticated channel attach
 *      awaits the same buffered recovery protocol.
 *
 * Logged-out users: provider no-ops; no Ably connection is opened.
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
import { markNotificationRead } from "@/src/lib/notifications/api";
import { notificationContent, notificationHref, notificationKeys } from "@/src/lib/notifications";
import { openConversationRealtime, type ConversationRealtimeClient } from "./ably-client";
import {
  createConversationRecoveryCoordinator,
  conversationKeys,
} from "@/app/(site)/creators/_hooks/use-conversations";
import { crewKeys, crewTaskDetailQueries } from "@/app/(site)/crews/_hooks/shared";
import { crewConversationKey } from "@/app/(site)/crews/[id]/workspace/_hooks/use-crew-conversation";

export function ConversationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const router = useRouter();
  const t = useTranslations("messages");
  const notificationT = useTranslations("notifications");
  const locale = useLocale() as Locale;

  const clientRef = useRef<ConversationRealtimeClient | null>(null);
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
    const recovery = createConversationRecoveryCoordinator(qc, uid);
    clientRef.current = openConversationRealtime(uid, {
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
          queryKey: conversationKeys.messages(data.conversationId, uid),
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
          conversationKeys.detail(data.conversationId, uid)
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
          queryKey: conversationKeys.detail(data.conversationId, uid),
        });
        qc.invalidateQueries({ queryKey: conversationKeys.inbox() });
      },
      onCrewTaskChanged: (data) => {
        qc.invalidateQueries({ queryKey: crewKeys.taskCenter });
        qc.invalidateQueries(crewTaskDetailQueries(data.crewId, data.taskId));
        qc.invalidateQueries({ queryKey: crewKeys.taskSummary(data.crewId) });
        qc.invalidateQueries({ queryKey: crewKeys.taskActivity(data.crewId) });
        qc.invalidateQueries({ queryKey: crewKeys.tasks(data.crewId) });
        qc.invalidateQueries({ queryKey: crewKeys.task(data.taskId) });
        qc.invalidateQueries({ queryKey: crewKeys.taskTimeline(data.taskId) });
        qc.invalidateQueries({ queryKey: crewKeys.productionOverview(data.crewId) });
        qc.invalidateQueries({ queryKey: crewKeys.episodes(data.crewId) });
        if (data.action === "reviewed") {
          qc.invalidateQueries({ queryKey: crewKeys.earnings(data.crewId, "mine") });
          qc.invalidateQueries({ queryKey: crewKeys.earnings(data.crewId, "crew") });
        }
      },
      onCrewTaskProjectChanged: (data) => {
        qc.invalidateQueries({ queryKey: crewKeys.taskCenter });
        qc.invalidateQueries(crewTaskDetailQueries(data.crewId));
        qc.invalidateQueries({ queryKey: crewKeys.taskProject(data.crewId) });
        qc.invalidateQueries({ queryKey: crewKeys.tasks(data.crewId) });
        if (
          data.resource === "production_document" ||
          data.resource === "production_project" ||
          data.resource === "production_resource" ||
          data.resource === "production_activity" ||
          data.resource === "episode" ||
          data.resource === "delivery"
        ) {
          qc.invalidateQueries({ queryKey: crewKeys.productionOverview(data.crewId) });
          qc.invalidateQueries({ queryKey: crewKeys.episodes(data.crewId) });
          if (data.resource === "production_activity") {
            qc.invalidateQueries({ queryKey: crewKeys.productionActivity(data.crewId) });
          }
        }
      },
      onCrewAssetChanged: (data) => {
        qc.invalidateQueries({ queryKey: crewKeys.assets(data.crewId) });
      },
      onNotification: (notification) => {
        qc.invalidateQueries({ queryKey: notificationKeys.all });
        const crewId =
          typeof notification.meta?.crewId === "string" ? notification.meta.crewId : null;
        if (crewId) {
          if (notification.type === "crew.application.submitted") {
            qc.invalidateQueries({ queryKey: crewKeys.applications(crewId) });
            qc.invalidateQueries({ queryKey: crewKeys.positions(crewId) });
          }
          if (notification.type === "crew.invitation.accepted") {
            qc.invalidateQueries({ queryKey: crewKeys.members(crewId) });
            qc.invalidateQueries({ queryKey: crewKeys.invitations(crewId) });
          }
          if (
            notification.type === "crew.application.approved" ||
            notification.type === "crew.application.rejected" ||
            notification.type === "crew.member.added"
          ) {
            qc.invalidateQueries({ queryKey: crewKeys.all });
          }
          if (notification.type === "crew.invitation.received") {
            qc.invalidateQueries({ queryKey: crewKeys.myInvitations });
            const invitationId =
              typeof notification.meta?.invitationId === "string"
                ? notification.meta.invitationId
                : null;
            if (invitationId) {
              qc.invalidateQueries({ queryKey: crewKeys.invitation(invitationId) });
            }
          }
          if (
            notification.type === "crew.agreement.sent" ||
            notification.type === "crew.agreement.updated"
          ) {
            qc.invalidateQueries({ queryKey: crewKeys.agreements(crewId) });
          }
        }
        if (notification.type === "crew.member.removed") {
          // Access revocation is authoritative. Remove previously authorized
          // crew and conversation payloads from memory immediately.
          qc.removeQueries({ queryKey: conversationKeys.all });
          qc.removeQueries({ queryKey: crewKeys.all });
          if (crewId) {
            qc.removeQueries({ queryKey: crewConversationKey(crewId) });
          }
        }

        const href = notificationHref(notification, locale);
        const content = notificationContent(notification, locale, notificationT);
        toast(content.title, {
          id: `notification:${notification.id}`,
          description: content.body,
          action: href
            ? {
                label: notificationT("view"),
                onClick: () => {
                  if (!notification.readAt) {
                    void markNotificationRead(notification.id)
                      .then(() => qc.invalidateQueries({ queryKey: notificationKeys.all }))
                      .catch((error: Error) => toast.error(error.message));
                  }
                  if (href.startsWith("/")) router.push(href);
                  else window.location.assign(href);
                },
              }
            : undefined,
        });
      },
      onReady: () => {
        // The server sends ready only after auth + user-channel
        // registration. A buffered, awaited recovery here (including
        // on the first connection) closes both startup and reconnect
        // gaps without allowing an older REST response to erase a
        // realtime frame.
        void recovery.recoverAll();
        qc.invalidateQueries({ queryKey: crewKeys.all });
        qc.invalidateQueries({ queryKey: notificationKeys.all });
      },
    });

    return () => {
      recovery.dispose();
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [user?.id, qc, router, t, notificationT, locale]);

  return <>{children}</>;
}
