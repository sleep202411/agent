"use client";

/**
 * NotificationProvider — bridges the WS push channel into React Query.
 *
 * Mount ONCE near the app root, INSIDE the auth boundary (after the
 * user is hydrated) but ABOVE any consumer of `useUnreadCount` etc.
 * The provider:
 *
 *   1. Opens a single WS to /aurora/notifications/subscribe.
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
import { openNotificationWs, type NotificationWsClient } from "./ws-client";
import { notificationKeys } from "./hooks";

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const router = useRouter();
  const clientRef = useRef<NotificationWsClient | null>(null);
  // Stable userId guard prevents re-open on every parent re-render.
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
    clientRef.current = openNotificationWs({
      onNotification: (n) => {
        // Keep cache fresh.
        qc.invalidateQueries({ queryKey: notificationKeys.all });
        // Toast — clickable, with deeplink navigation when present.
        const deeplink = typeof n.meta?.deeplink === "string" ? (n.meta.deeplink as string) : null;
        toast(n.title, {
          description: n.body,
          action: deeplink
            ? {
                label: "View",
                onClick: () => router.push(deeplink),
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
