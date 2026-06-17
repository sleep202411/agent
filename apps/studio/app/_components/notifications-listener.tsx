"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "./auth-provider";
import { WORKSPACES_QUERY_KEY } from "./workspace-context";
import {
  NotificationsSocket,
  type StudioNotification,
} from "@/lib/notifications/notifications-socket";

/** Query-key roots that a sharing event should refresh if mounted. */
const SHARING_QUERY_ROOTS = new Set(["share-members", "share-invites"]);

/**
 * Live notifications bridge. Holds one WS to `/aurora/ws/notifications` while a
 * user is signed in; on each frame it shows a toast and refreshes the caches a
 * sharing change affects (workspace list, open member/invite panels) so the loop
 * closes without a manual reload. Renders nothing.
 */
export function NotificationsListener() {
  const userId = useAuth().user?.id;
  const queryClient = useQueryClient();
  const router = useRouter();
  const t = useTranslations("shell");

  useEffect(() => {
    if (!userId) return;
    const socket = new NotificationsSocket();
    const unsubscribe = socket.subscribe((n) =>
      handleNotification(n, queryClient, (href) => router.push(href), t("notifications.view"))
    );
    socket.connect();
    return () => {
      unsubscribe();
      socket.destroy();
    };
  }, [userId, queryClient, router, t]);

  return null;
}

function handleNotification(
  n: StudioNotification,
  queryClient: QueryClient,
  navigate: (href: string) => void,
  viewLabel: string
) {
  if (n.type.startsWith("workspace.") || n.type.startsWith("project.")) {
    void queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY });
    void queryClient.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === "string" && SHARING_QUERY_ROOTS.has(q.queryKey[0] as string),
    });
  }

  const deeplink = typeof n.meta?.deeplink === "string" ? n.meta.deeplink : undefined;
  const options = {
    description: n.body,
    ...(deeplink ? { action: { label: viewLabel, onClick: () => navigate(deeplink) } } : {}),
  };
  if (n.type.endsWith(".removed")) toast.warning(n.title, options);
  else toast.success(n.title, options);
}
