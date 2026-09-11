/**
 * Application flow: apply / list-for-owner / approve / reject.
 *
 * Applications are scoped to (crewId, positionId, applicantId). The
 * owner inbox is keyed by crewId; individual transitions are keyed by
 * application id so the URL doesn't need to repeat the crew context.
 */

import { useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import type {
  ApplyInput,
  CrewApplicationDTO,
  CrewApplicationPageDTO,
  CrewApplicationStatus,
} from "./types";

interface CrewApplicationsOptions {
  positionId?: string;
  status?: CrewApplicationStatus;
  pageSize?: number;
}

/**
 * Owner-facing cursor inbox. The public return keeps `data` as a flat array
 * for ergonomic rendering while exposing the infinite-query controls and
 * authoritative server summary alongside it.
 */
export function useCrewApplications(
  crewId: string | undefined,
  enabled = true,
  options: CrewApplicationsOptions = {}
) {
  const { user } = useCurrentUser();
  const pageSize = options.pageSize ?? 50;
  const query = useInfiniteQuery({
    queryKey: [
      ...crewKeys.applications(crewId ?? ""),
      options.positionId ?? "all-positions",
      options.status ?? "all-statuses",
      pageSize,
      user?.id ?? null,
    ] as const,
    enabled: !!crewId && enabled && Boolean(user),
    queryFn: ({ pageParam }) =>
      crewApi.get<CrewApplicationPageDTO>(`/crews/${encodeURIComponent(crewId!)}/applications`, {
        query: {
          limit: pageSize,
          cursor: pageParam,
          positionId: options.positionId,
          status: options.status,
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const data = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  return {
    ...query,
    data,
    summary: query.data?.pages[0]?.summary,
    total: query.data?.pages[0]?.total ?? 0,
  };
}

/** Direct notification/deeplink lookup — never depends on list pagination. */
export function useCrewApplication(
  crewId: string | undefined,
  applicationId: string | null | undefined,
  enabled = true
) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: [...crewKeys.application(crewId ?? "", applicationId ?? ""), user?.id ?? null],
    enabled: !!crewId && !!applicationId && enabled && Boolean(user),
    queryFn: () =>
      crewApi.get<CrewApplicationDTO>(
        `/crews/${encodeURIComponent(crewId!)}/applications/${encodeURIComponent(applicationId!)}`
      ),
  });
}

function useApplicationRefresh(crewId: string, changesMembership = false) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const context = { crewId, accountUserId: user?.id ?? null };
  return {
    onMutate: () => context,
    onSuccess: (_data: unknown, _variables: unknown, origin: typeof context | undefined) => {
      if (!origin?.accountUserId) return;
      const forAccount = (query: { queryKey: readonly unknown[] }) =>
        query.queryKey.at(-1) === origin.accountUserId;
      qc.invalidateQueries({
        queryKey: crewKeys.applications(origin.crewId),
        predicate: forAccount,
      });
      qc.invalidateQueries({ queryKey: [...crewKeys.detail(origin.crewId), origin.accountUserId] });
      qc.invalidateQueries({
        queryKey: crewKeys.positions(origin.crewId),
        predicate: (query) => query.queryKey[3] === origin.accountUserId,
      });
      qc.invalidateQueries({ queryKey: crewKeys.mine, predicate: forAccount });
      if (changesMembership) {
        qc.invalidateQueries({ queryKey: crewKeys.members(origin.crewId), predicate: forAccount });
        qc.invalidateQueries({ queryKey: ["crew", "positions", "public"] });
        qc.invalidateQueries({ queryKey: ["crew", "list"], predicate: forAccount });
        qc.invalidateQueries({ queryKey: ["crew", "by-user"], predicate: forAccount });
      }
    },
  };
}

export function useApplyToPosition(crewId: string, positionId: string) {
  const refresh = useApplicationRefresh(crewId);
  return useMutation({
    ...refresh,
    mutationFn: (input: ApplyInput) =>
      crewApi.post<CrewApplicationDTO>(
        `/crews/${encodeURIComponent(crewId)}/positions/${encodeURIComponent(positionId)}/apply`,
        { body: input }
      ),
  });
}

export function useApproveApplication(crewId: string) {
  const refresh = useApplicationRefresh(crewId, true);
  return useMutation({
    ...refresh,
    mutationFn: (applicationId: string) =>
      crewApi.post<CrewApplicationDTO>(
        `/applications/${encodeURIComponent(applicationId)}/approve`
      ),
  });
}

export function useRejectApplication(crewId: string) {
  const refresh = useApplicationRefresh(crewId);
  return useMutation({
    ...refresh,
    mutationFn: (applicationId: string) =>
      crewApi.post<CrewApplicationDTO>(`/applications/${encodeURIComponent(applicationId)}/reject`),
  });
}
