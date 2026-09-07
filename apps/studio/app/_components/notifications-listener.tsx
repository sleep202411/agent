"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "./auth-provider";
import { WORKSPACES_QUERY_KEY } from "./workspace-context";
import { openNotificationsRealtime } from "@/lib/notifications/realtime";
import { notificationCategory, type NotificationDTO } from "@repo/shared/notifications";
import { notificationHref } from "@/lib/notifications/deeplink";
import { useSiteRegion } from "./region-provider";
import { api } from "@/lib/api";

/** Query-key roots that a sharing event should refresh if mounted. */
const SHARING_QUERY_ROOTS = new Set(["share-members", "share-invites"]);

/** Subscribe to the existing user channel; REST remains the source of truth. */
export function NotificationsListener() {
  const userId = useAuth().user?.id;
  const queryClient = useQueryClient();
  const router = useRouter();
  const t = useTranslations("shell");
  const locale = useLocale();
  const siteRegion = useSiteRegion();

  useEffect(() => {
    if (!userId) return;
    const realtime = openNotificationsRealtime(String(userId), {
      onReady: () => refreshSharing(queryClient),
      onNotification: (notification) => {
        if (notificationCategory(notification.type) === "sharing") refreshSharing(queryClient);
        const href = notificationHref(notification, locale, siteRegion);
        const action = href
          ? {
              label: t("notifications.view"),
              onClick: () => {
                if (!notification.readAt) {
                  void api
                    .post(`/aurora/notifications/${encodeURIComponent(notification.id)}/read`, {
                      requestScope: "user",
                      keepalive: true,
                    })
                    .catch((error: Error) => toast.error(error.message));
                }
                if (href.startsWith("/")) router.push(href);
                else window.location.assign(href);
              },
            }
          : undefined;
        showNotification(notification, action);
      },
    });
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") refreshSharing(queryClient);
    };
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshOnVisible);
      realtime.close();
    };
  }, [userId, queryClient, router, t, locale, siteRegion]);

  return null;
}

function refreshSharing(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY });
  void queryClient.invalidateQueries({
    predicate: (q) =>
      (typeof q.queryKey[0] === "string" && SHARING_QUERY_ROOTS.has(q.queryKey[0])) ||
      (q.queryKey[0] === "story-studio" &&
        ["projects", "workbench", "chapter-workbench"].includes(String(q.queryKey[1]))),
  });
}

function showNotification(
  n: NotificationDTO,
  action: { label: string; onClick: () => void } | undefined
) {
  const options = { id: `notification:${n.id}`, description: n.body, action };
  if (n.type.endsWith(".removed")) toast.warning(n.title, options);
  else toast(n.title, options);
}
