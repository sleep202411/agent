"use client";

/**
 * React Query hooks for the notification inbox.
 *
 * Cache keys:
 *   ["notifications", "unread-count", userId] — bell badge
 *   ["notifications", "list", userId, limit] — bell dropdown (first page)
 *   ["notifications", "feed", userId, pageSize, filter] — full inbox page (infinite)
 *
 * Mutations invalidate both the count and the list/feed so the bell
 * badge updates atomically with the list view. The WS provider also
 * touches the same keys when a push arrives — see provider.tsx.
 */

import { useLayoutEffect, useRef } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationFilter } from "@repo/shared/notifications";
import { useCurrentUser } from "@/src/hooks/use-user";
import { toast } from "sonner";
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
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: [...notificationKeys.unreadCount, user?.id ?? null],
    enabled: Boolean(user?.id),
    queryFn: ({ signal }) => fetchUnreadCount(signal).then((r) => r.count),
    // Poll as a safety net for missed WS pushes (network blips, server
    // restart). WS push is the primary signal — this just papers over
    // gaps; 1 min is well below human notice for a stale badge.
    refetchInterval: UNREAD_COUNT_POLL_MS,
    staleTime: 30_000,
  });
}

/** Recent notifications for the bell dropdown — first page only. */
export function useRecentNotifications(limit = 10) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: [...notificationKeys.list, user?.id ?? null, limit] as const,
    enabled: Boolean(user?.id),
    queryFn: ({ signal }) => listNotifications({ limit }, signal),
    refetchInterval: UNREAD_COUNT_POLL_MS,
    staleTime: 30_000,
  });
}

/** Full inbox feed — infinite scroll via cursor. */
export function useNotificationFeed(pageSize = 30, filter: NotificationFilter = "all") {
  const { user } = useCurrentUser();
  return useInfiniteQuery({
    queryKey: [...notificationKeys.feed, user?.id ?? null, pageSize, filter] as const,
    enabled: Boolean(user?.id),
    queryFn: ({ pageParam, signal }) =>
      listNotifications({ limit: pageSize, cursor: pageParam, filter }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: UNREAD_COUNT_POLL_MS,
  });
}

function useNotificationRefresh<TVariables = void>() {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const scope = useRef<string | null>(null);
  useLayoutEffect(() => {
    scope.current = user?.id ?? null;
    return () => {
      scope.current = null;
    };
  }, [user?.id]);
  return {
    onError: (
      error: Error,
      _variables: TVariables,
      origin: { accountUserId: string | null } | undefined
    ) => {
      if (origin?.accountUserId && scope.current === origin.accountUserId)
        toast.error(error.message);
    },
    onMutate: () => ({ accountUserId: user?.id ?? null }),
    onSuccess: (
      _data: unknown,
      _variables: TVariables,
      origin: { accountUserId: string | null } | undefined
    ) => {
      if (!origin?.accountUserId) return;
      return qc.invalidateQueries({
        queryKey: notificationKeys.all,
        predicate: (query) => query.queryKey[2] === origin.accountUserId,
      });
    },
  };
}

export function useMarkRead() {
  const refresh = useNotificationRefresh<string>();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    ...refresh,
  });
}

export function useMarkAllRead() {
  const refresh = useNotificationRefresh();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    ...refresh,
  });
}
