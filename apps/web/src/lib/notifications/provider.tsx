"use client";

/**
 * NotificationProvider — bridges the WS push channel into React Query.
 *
 * Mount ONCE near the app root, INSIDE the auth boundary (after the
 * user is hydrated) but ABOVE any consumer of `useUnreadCount` etc.
 * The provider:
 *
 *   1. Opens a single WS to /aurora/ws/notifications.
 *   2. On every `notification` frame: invalidates the count + list
 *      caches so any subscribed component re-renders with the new
 *      unread count and includes the new row.
 *   3. Surfaces a non-intrusive toast for the new notification (sonner),
 *      with a click target that navigates to the row's deeplink.
 *   4. Auto-reconnect handled by the WS client.
 *
 * Logged-out users: the provider no-ops; the WS isn't opened so we
 * don't burn a 1008 reconnect loop for visitors.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { notificationHref } from "./deeplink";
import { openNotificationWs, type NotificationWsClient } from "./ws-client";
import { notificationKeys } from "./hooks";
import { conversationKeys } from "@/app/(site)/creators/_hooks/use-conversations";
import { crewKeys } from "@/app/(site)/crews/_hooks/shared";
import { crewConversationKey } from "@/app/(site)/crews/[id]/workspace/_hooks/use-crew-conversation";

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations("notifications");
  const clientRef = useRef<NotificationWsClient | null>(null);
  // Stable userId guard prevents re-open on every parent re-render.
  const userIdRef = useRef<string | null>(null);
  // Locale is read through a ref, not a dependency: the toast handler
  // needs the current one, but making the WS effect depend on it would
  // tear down and reopen the socket every time the reader switches
  // language.
  const localeRef = useRef(locale);
  const translationsRef = useRef(t);
  useEffect(() => {
    localeRef.current = locale;
    translationsRef.current = t;
  }, [locale, t]);

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
    clientRef.current = openNotificationWs({
      onNotification: (n) => {
        // Keep cache fresh.
        qc.invalidateQueries({ queryKey: notificationKeys.all });
        if (n.type === "crew.member.removed") {
          const crewId = typeof n.meta?.crewId === "string" ? n.meta.crewId : null;
          // This notification is the removed member's realtime access
          // revocation. Drop cached thread content immediately instead
          // of waiting for a later REST 404 while the old group remains
          // readable from memory.
          qc.removeQueries({ queryKey: conversationKeys.all });
          qc.removeQueries({ queryKey: crewKeys.all });
          if (crewId) {
            qc.removeQueries({ queryKey: crewConversationKey(crewId) });
          }
        }
        // Toast — clickable, with deeplink navigation when present.
        const href = notificationHref(n, localeRef.current);
        toast(n.title, {
          description: n.body,
          action: href
            ? {
                label: translationsRef.current("view"),
                onClick: () => router.push(href),
              }
            : undefined,
        });
      },
      onReconnected: () => {
        // Reconnects may have missed pushes — refetch authoritative
        // state from DB.
        qc.invalidateQueries({ queryKey: notificationKeys.all });
      },
    });

    return () => {
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [user?.id, qc, router]);

  return <>{children}</>;
}
