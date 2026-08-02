/**
 * Crew positions (recruitment slots): list / create / update / delete.
 *
 * Replaces the legacy "jobs" terminology — server now models them as
 * `CrewPosition` with `positionType` (preset value), `targetCount`,
 * `recruitedCount`, and a `status` of open/frozen/full.
 */

import { useEffect, useMemo } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import type {
  CreatePositionInput,
  CrewPositionDTO,
  CrewPositionPageDTO,
  UpdatePositionInput,
} from "./types";

export function useCrewPositions(crewId: string | undefined, pageSize = 50) {
  const query = useInfiniteQuery({
    queryKey: crewKeys.positions(crewId ?? ""),
    enabled: !!crewId,
    queryFn: ({ pageParam }) =>
      crewApi.get<CrewPositionPageDTO>(`/crews/${encodeURIComponent(crewId!)}/positions`, {
        query: { limit: pageSize, cursor: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  useEffect(() => {
    if (!query.hasNextPage || query.isFetchingNextPage) return;
    void query.fetchNextPage();
  }, [query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage]);
  const data = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  return {
    ...query,
    data,
    total: query.data?.pages[0]?.total ?? 0,
  };
}

export function useCreatePosition(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePositionInput) =>
      crewApi.post<CrewPositionDTO>(`/crews/${encodeURIComponent(crewId)}/positions`, {
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.positions(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.detail(crewId) });
    },
  });
}

export function useUpdatePosition(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ positionId, ...rest }: UpdatePositionInput & { positionId: string }) =>
      crewApi.patch<CrewPositionDTO>(
        `/crews/${encodeURIComponent(crewId)}/positions/${encodeURIComponent(positionId)}`,
        { body: rest }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.positions(crewId) });
    },
  });
}

export function useDeletePosition(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (positionId: string) =>
      crewApi.delete<void>(
        `/crews/${encodeURIComponent(crewId)}/positions/${encodeURIComponent(positionId)}`
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.positions(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.detail(crewId) });
    },
  });
}
