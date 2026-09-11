"use client";

import { useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import type { CreateCrewInvitationInput, CrewInvitationDTO, CrewInvitationPageDTO } from "./types";

export function useCrewInvitations(crewId: string, enabled = true, pageSize = 30) {
  const { user } = useCurrentUser();
  const query = useInfiniteQuery({
    queryKey: [...crewKeys.invitations(crewId), pageSize, user?.id ?? null] as const,
    enabled: enabled && Boolean(crewId) && Boolean(user),
    queryFn: ({ pageParam }) =>
      crewApi.get<CrewInvitationPageDTO>(`/crews/${encodeURIComponent(crewId)}/invitations`, {
        query: { limit: pageSize, cursor: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const data = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  return {
    ...query,
    data,
    total: query.data?.pages[0]?.total ?? 0,
  };
}

export function useMyCrewInvitation(invitationId: string) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: [...crewKeys.invitation(invitationId), user?.id ?? null],
    enabled: Boolean(invitationId) && Boolean(user),
    queryFn: () =>
      crewApi.get<CrewInvitationDTO>(`/crew-invitations/${encodeURIComponent(invitationId)}`),
    retry: false,
  });
}

export function useInviteCrewMember(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCrewInvitationInput) =>
      crewApi.post<CrewInvitationDTO>(`/crews/${encodeURIComponent(crewId)}/invitations`, {
        body: { ...input, expiresInDays: 7 },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: crewKeys.invitations(crewId) }),
  });
}

export function useAcceptCrewInvitation(invitationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      crewApi.post<{
        crewId: string;
        accepted: true;
        agreementId: string | null;
        agreementQueued: boolean;
        workspaceHref: string;
      }>(`/crew-invitations/${encodeURIComponent(invitationId)}/accept`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: crewKeys.invitation(invitationId) });
      qc.invalidateQueries({ queryKey: crewKeys.myInvitations });
      qc.invalidateQueries({ queryKey: crewKeys.mine });
      qc.invalidateQueries({ queryKey: crewKeys.membership(data.crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.members(data.crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.taskCenter });
    },
  });
}

export function useDeclineCrewInvitation(invitationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      crewApi.post<{ declined: true }>(
        `/crew-invitations/${encodeURIComponent(invitationId)}/decline`
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.invitation(invitationId) });
      qc.invalidateQueries({ queryKey: crewKeys.myInvitations });
    },
  });
}

export function useRevokeCrewInvitation(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) =>
      crewApi.delete<{ revoked: true }>(`/crew-invitations/${encodeURIComponent(invitationId)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.invitations(crewId) });
    },
  });
}
