"use client";

import { useQuery } from "@tanstack/react-query";
import { resolveUserAvatarUrl } from "@repo/shared/avatar";
import { api } from "@/lib/api";

/**
 * Public-profile display resolution. Batch-resolves Java user ids to their
 * safe public projection ({ userId, nickname, avatar }) via the server BFF
 * `GET /aurora/users/by-ids?ids=1,2,3`. Missing ids are omitted from the
 * response (callers fall back to a generic label). Used to put a name + avatar
 * on activity-log entries and other id-only surfaces.
 */

export interface PublicUser {
  userId: string;
  nickname: string | null;
  avatar: string | null;
}

export async function fetchUsersByIds(ids: string[]): Promise<PublicUser[]> {
  if (ids.length === 0) return [];
  const data = await api.get<{ users: PublicUser[] }>("/aurora/users/by-ids", {
    params: { ids: ids.join(",") },
  });
  return data.users.map((user) => ({
    ...user,
    avatar: resolveUserAvatarUrl(user.avatar) ?? null,
  }));
}

/**
 * Resolve a set of user ids → a stable `userId → PublicUser` lookup map.
 * De-duplicates ids and only fires once the set is non-empty; the result is
 * cached so repeated screens reuse it. The map is empty until resolved.
 */
export function useUsersByIds(ids: string[]): Map<string, PublicUser> {
  const distinct = Array.from(new Set(ids.filter(Boolean))).sort();
  const { data } = useQuery({
    queryKey: ["users-by-ids", distinct],
    queryFn: () => fetchUsersByIds(distinct),
    enabled: distinct.length > 0,
    staleTime: 5 * 60_000,
  });
  return new Map((data ?? []).map((user) => [user.userId, user]));
}
