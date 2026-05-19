/**
 * Crew listing — public plaza grid + "My Crews" (founded + joined).
 */

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
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
export function useMyCrews() {
  return useQuery({
    queryKey: crewKeys.mine,
    queryFn: () => crewApi.get<MyCrewsResult>("/crews/my"),
  });
}
