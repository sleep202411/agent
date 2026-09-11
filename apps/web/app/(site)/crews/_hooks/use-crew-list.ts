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
  return useInfiniteQuery({
    queryKey: ["crew", "list", "infinite", pageSize] as const,
    queryFn: ({ pageParam }) =>
      crewApi.get<ListResult>("/crews", {
        query: { limit: pageSize, cursor: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Profile "My Crews" tab — owner + member breakdown in one call. */
export function useMyCrews(enabled = true) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: [...crewKeys.mine, user?.id ?? null],
    queryFn: () => crewApi.get<MyCrewsResult>("/crews/my"),
    enabled: enabled && Boolean(user),
  });
}

/**
 * Visitor view of a creator's PUBLIC (listed) crews — drives the creator
 * profile Crews tab when viewing someone else. The owner's own tab uses
 * useMyCrews() instead (full set incl. unlisted).
 */
export function usePublicCreatorCrews(userId: string, enabled = true) {
  return useQuery({
    queryKey: crewKeys.byUser(userId),
    queryFn: () => crewApi.get<CreatorCrewsResult>(`/crews/by-user/${encodeURIComponent(userId)}`),
    enabled: enabled && !!userId,
  });
}
