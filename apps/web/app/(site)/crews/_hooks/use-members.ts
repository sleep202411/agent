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
import { useCurrentUser } from "@/src/hooks/use-user";
import { CrewApiError, crewApi } from "./api";
import { crewKeys } from "./shared";
import type {
  CrewMemberDTO,
  CrewMemberPageDTO,
  CrewMembershipDTO,
  UpdateCrewMemberInput,
} from "./types";

export function useCrewMembers(crewId: string | undefined, pageSize = 50) {
  const { user } = useCurrentUser();
  const query = useInfiniteQuery({
    queryKey: [...crewKeys.members(crewId ?? ""), "list", pageSize, user?.id ?? null],
    enabled: !!crewId && Boolean(user),
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<CrewMemberPageDTO>(`/crews/${encodeURIComponent(crewId!)}/members`, {
        signal,
        cache: "no-store",
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
  const { fetchNextPage, hasNextPage, isFetching, isError } = query;
  useEffect(() => {
    if (!hasNextPage || isFetching || isError) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetching, isError]);
  const data = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  return {
    ...query,
    data,
    total: query.data?.pages[0]?.total ?? 0,
  };
}

export function useCrewMembership(crewId: string | undefined) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: [...crewKeys.membership(crewId ?? ""), user?.id ?? null],
    enabled: !!crewId && Boolean(user),
    queryFn: ({ signal }) =>
      crewApi.get<CrewMembershipDTO>(`/crews/${encodeURIComponent(crewId!)}/members/me`, {
        signal,
        cache: "no-store",
      }),
    retry: (failureCount, error) =>
      failureCount < 2 && !(error instanceof CrewApiError && error.status < 500),
  });
}

function useMemberRefresh(crewId: string) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const context = { crewId, accountUserId: user?.id ?? null };
  return {
    onMutate: () => context,
    onSuccess: (_data: unknown, _variables: unknown, origin: typeof context | undefined) => {
      if (!origin?.accountUserId) return;
      const forAccount = (query: { queryKey: readonly unknown[] }) =>
        query.queryKey.at(-1) === origin.accountUserId;
      qc.invalidateQueries({ queryKey: crewKeys.members(origin.crewId), predicate: forAccount });
      qc.invalidateQueries({ queryKey: [...crewKeys.detail(origin.crewId), origin.accountUserId] });
      qc.invalidateQueries({
        queryKey: crewKeys.positions(origin.crewId),
        predicate: (query) => query.queryKey[3] === origin.accountUserId,
      });
      qc.invalidateQueries({ queryKey: crewKeys.mine, predicate: forAccount });
      qc.invalidateQueries({ queryKey: ["crew", "positions", "public"] });
      qc.invalidateQueries({ queryKey: ["crew", "list"], predicate: forAccount });
      qc.invalidateQueries({ queryKey: ["crew", "by-user"], predicate: forAccount });
      qc.invalidateQueries({
        queryKey: crewKeys.taskCenter,
        predicate: (query) => query.queryKey[2] === origin.accountUserId,
      });
    },
  };
}

export function useRemoveMember(crewId: string) {
  const refresh = useMemberRefresh(crewId);
  return useMutation({
    ...refresh,
    mutationFn: (memberId: string) =>
      crewApi.delete<void>(
        `/crews/${encodeURIComponent(crewId)}/members/${encodeURIComponent(memberId)}`
      ),
  });
}

export function useUpdateMember(crewId: string) {
  const refresh = useMemberRefresh(crewId);
  return useMutation({
    ...refresh,
    mutationFn: ({ memberId, input }: { memberId: string; input: UpdateCrewMemberInput }) =>
      crewApi.patch<CrewMemberDTO>(
        `/crews/${encodeURIComponent(crewId)}/members/${encodeURIComponent(memberId)}`,
        { body: input }
      ),
  });
}

/**
 * Hand crew ownership to an existing member. `toUserId` is the target
 * member's user id; `removeOldOwner` drops the outgoing owner from the
 * crew (default keeps them as a normal member).
 */
export function useTransferCrewOwner(crewId: string) {
  const refresh = useMemberRefresh(crewId);
  return useMutation({
    ...refresh,
    mutationFn: ({ toUserId, removeOldOwner }: { toUserId: string; removeOldOwner?: boolean }) =>
      crewApi.post(`/crews/${encodeURIComponent(crewId)}/transfer-owner`, {
        body: { toUserId, removeOldOwner },
      }),
  });
}
