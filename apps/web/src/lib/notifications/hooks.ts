"use client";

/**
 * React Query hooks for the notification inbox.
 *
 * Cache keys:
 *   ["notifications", "unread-count"]      — bell badge
 *   ["notifications", "list"]              — bell dropdown (first page)
 *   ["notifications", "feed"]              — full inbox page (infinite)
 *
 * Mutations invalidate both the count and the list/feed so the bell
 * badge updates atomically with the list view. The WS provider also
 * touches the same keys when a push arrives — see provider.tsx.
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./api";

export const notificationKeys = {
  all: ["notifications"] as const,
  unreadCount: ["notifications", "unread-count"] as const,
  list: ["notifications", "list"] as const,
  feed: ["notifications", "feed"] as const,
};

const UNREAD_COUNT_POLL_MS = 60_000;

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: () => fetchUnreadCount().then((r) => r.count),
    // Poll as a safety net for missed WS pushes (network blips, server
    // restart). WS push is the primary signal — this just papers over
    // gaps; 1 min is well below human notice for a stale badge.
    refetchInterval: UNREAD_COUNT_POLL_MS,
    staleTime: 30_000,
  });
}

/** Recent notifications for the bell dropdown — first page only. */
export function useRecentNotifications(limit = 10) {
  return useQuery({
    queryKey: [...notificationKeys.list, limit] as const,
    queryFn: () => listNotifications({ limit }),
    staleTime: 30_000,
  });
}

/** Full inbox feed — infinite scroll via cursor. */
export function useNotificationFeed(pageSize = 30) {
  return useInfiniteQuery({
    queryKey: [...notificationKeys.feed, pageSize] as const,
    queryFn: ({ pageParam }) => listNotifications({ limit: pageSize, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}
