/**
 * Crew positions (recruitment slots): list / create / update / delete.
 *
 * Replaces the legacy "jobs" terminology — server now models them as
 * `CrewPosition` with `positionType` (preset value), `targetCount`,
 * `recruitedCount`, and a `status` of open/frozen/full.
 */

import { useEffect, useMemo } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import type {
  CreatePositionInput,
  CrewPositionDTO,
  CrewPositionPageDTO,
  UpdatePositionInput,
} from "./types";

export function useCrewPositions(crewId: string | undefined, pageSize = 50) {
  const { user, isLoading } = useCurrentUser();
  const enabled = !!crewId && !isLoading;
  const query = useInfiniteQuery({
    queryKey: [...crewKeys.positions(crewId ?? ""), user?.id ?? null, pageSize],
    enabled,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<CrewPositionPageDTO>(`/crews/${encodeURIComponent(crewId!)}/positions`, {
        signal,
        cache: "no-store",
        query: { limit: pageSize, cursor: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const { fetchNextPage, hasNextPage, isFetching, isError } = query;
  useEffect(() => {
    if (!enabled || !hasNextPage || isFetching || isError) return;
    void fetchNextPage();
  }, [enabled, fetchNextPage, hasNextPage, isFetching, isError]);
  const data = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  return {
    ...query,
    data,
    total: query.data?.pages[0]?.total ?? 0,
  };
}

function usePositionRefresh(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const context = { crewId, accountUserId: user?.id ?? null };
  return {
    onMutate: () => context,
    onSuccess: (_data: unknown, _variables: unknown, origin: typeof context | undefined) => {
      if (!origin?.accountUserId) return;
      qc.invalidateQueries({
        queryKey: crewKeys.positions(origin.crewId),
        predicate: (query) => query.queryKey[3] === origin.accountUserId,
      });
      qc.invalidateQueries({ queryKey: [...crewKeys.detail(origin.crewId), origin.accountUserId] });
      qc.invalidateQueries({ queryKey: ["crew", "positions", "public"] });
      for (const queryKey of [["crew", "list"], crewKeys.mine, ["crew", "by-user"]]) {
        qc.invalidateQueries({
          queryKey,
          predicate: (query) => query.queryKey.at(-1) === origin.accountUserId,
        });
      }
    },
  };
}

export function useCreatePosition(crewId: string) {
  const refresh = usePositionRefresh(crewId);
  return useMutation({
    ...refresh,
    mutationFn: (input: CreatePositionInput) =>
      crewApi.post<CrewPositionDTO>(`/crews/${encodeURIComponent(crewId)}/positions`, {
        body: input,
      }),
  });
}

export function useUpdatePosition(crewId: string) {
  const refresh = usePositionRefresh(crewId);
  return useMutation({
    ...refresh,
    mutationFn: ({ positionId, ...rest }: UpdatePositionInput & { positionId: string }) =>
      crewApi.patch<CrewPositionDTO>(
        `/crews/${encodeURIComponent(crewId)}/positions/${encodeURIComponent(positionId)}`,
        { body: rest }
      ),
  });
}

export function useDeletePosition(crewId: string) {
  const refresh = usePositionRefresh(crewId);
  return useMutation({
    ...refresh,
    mutationFn: (positionId: string) =>
      crewApi.delete<void>(
        `/crews/${encodeURIComponent(crewId)}/positions/${encodeURIComponent(positionId)}`
      ),
  });
}
