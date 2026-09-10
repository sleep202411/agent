/**
 * Member reads + mutations for removal, positions, policies and overrides.
 *
 * Server-owned: every member row carries authorization state; user display
 * info (nickname, avatar) is resolved on the client from the existing
 * user-info hooks so the data layer doesn't denormalize transient
 * profile state.
 */

import { useEffect, useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CrewApiError, crewApi } from "./api";
import { crewKeys } from "./shared";
import type {
  CrewMemberDTO,
  CrewMemberPageDTO,
  CrewMembershipDTO,
  UpdateCrewMemberInput,
} from "./types";

export function useCrewMembers(crewId: string | undefined, pageSize = 50) {
  const query = useInfiniteQuery({
    queryKey: crewKeys.members(crewId ?? ""),
    enabled: !!crewId,
    queryFn: ({ pageParam }) =>
      crewApi.get<CrewMemberPageDTO>(`/crews/${encodeURIComponent(crewId!)}/members`, {
        query: { limit: pageSize, cursor: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // Membership failures are authoritative. Retrying a 403/404 only
    // keeps the workspace on its loading screen and floods the console
    // with requests that cannot succeed without an external state
    // change. Transient server failures still get one retry.
    retry: (failureCount, error) =>
      failureCount < 2 && !(error instanceof CrewApiError && error.status < 500),
  });
  const { fetchNextPage, hasNextPage, isFetching, isFetchNextPageError } = query;
  useEffect(() => {
    if (!hasNextPage || isFetching || isFetchNextPageError) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetching, isFetchNextPageError]);
  const data = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  return {
    ...query,
    data,
    total: query.data?.pages[0]?.total ?? 0,
  };
}

export function useCrewMembership(crewId: string | undefined) {
  return useQuery({
    queryKey: crewKeys.membership(crewId ?? ""),
    enabled: !!crewId,
    queryFn: () =>
      crewApi.get<CrewMembershipDTO>(`/crews/${encodeURIComponent(crewId!)}/members/me`),
    retry: (failureCount, error) =>
      failureCount < 2 && !(error instanceof CrewApiError && error.status < 500),
  });
}

export function useRemoveMember(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      crewApi.delete<void>(
        `/crews/${encodeURIComponent(crewId)}/members/${encodeURIComponent(memberId)}`
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.members(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.detail(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.positions(crewId) });
    },
  });
}

export function useUpdateMember(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, input }: { memberId: string; input: UpdateCrewMemberInput }) =>
      crewApi.patch<CrewMemberDTO>(
        `/crews/${encodeURIComponent(crewId)}/members/${encodeURIComponent(memberId)}`,
        { body: input }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.members(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.membership(crewId) });
    },
  });
}

/**
 * Hand crew ownership to an existing member. `toUserId` is the target
 * member's user id; `removeOldOwner` drops the outgoing owner from the
 * crew (default keeps them as a normal member).
 */
export function useTransferCrewOwner(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ toUserId, removeOldOwner }: { toUserId: string; removeOldOwner?: boolean }) =>
      crewApi.post(`/crews/${encodeURIComponent(crewId)}/transfer-owner`, {
        body: { toUserId, removeOldOwner },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.members(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.detail(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.mine });
    },
  });
}
