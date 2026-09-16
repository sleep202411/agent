/**
 * Crew listing — public plaza grid + "My Crews" (founded + joined).
 */

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import type { CrewDTO } from "./types";

interface ListResult {
  items: CrewDTO[];
  nextCursor: string | null;
}

interface MyCrewsResult {
  founded: CrewDTO[];
  joined: CrewDTO[];
  community?: CrewDTO[];
}

interface CreatorCrewsResult {
  items: CrewDTO[];
}

/**
 * Public crew plaza — cursor-paginated infinite scroll. Each item
 * arrives with `memberCount` + `openPositionCount` pre-joined by the
 * server (one round-trip per page).
 */
export function useCrewList(pageSize = 24) {
  const { user, isLoading } = useCurrentUser();
  return useInfiniteQuery({
    queryKey: ["crew", "list", "infinite", pageSize, user?.id ?? null] as const,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<ListResult>("/crews", {
        signal,
        cache: "no-store",
        query: { limit: pageSize, cursor: pageParam },
      }),
    enabled: !isLoading,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Profile "My Crews" tab — owner + member breakdown in one call. */
export function useMyCrews(enabled = true) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: [...crewKeys.mine, user?.id ?? null],
    queryFn: ({ signal }) => crewApi.get<MyCrewsResult>("/crews/my", { signal, cache: "no-store" }),
    enabled: enabled && Boolean(user),
  });
}

/**
 * Visitor view of a creator's PUBLIC (listed) crews — drives the creator
 * profile Crews tab when viewing someone else. The owner's own tab uses
 * useMyCrews() instead (full set incl. unlisted).
 */
export function usePublicCreatorCrews(userId: string, enabled = true) {
  const { user, isLoading } = useCurrentUser();
  return useQuery({
    queryKey: [...crewKeys.byUser(userId), user?.id ?? null],
    queryFn: ({ signal }) =>
      crewApi.get<CreatorCrewsResult>(`/crews/by-user/${encodeURIComponent(userId)}`, {
        signal,
        cache: "no-store",
      }),
    enabled: enabled && !!userId && !isLoading,
  });
}
