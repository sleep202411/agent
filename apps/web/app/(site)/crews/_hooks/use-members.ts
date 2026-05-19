/**
 * Member reads + mutations (add manually / remove / toggle finance).
 *
 * Server-owned: every member row has just IDs + role; user display
 * info (nickname, avatar) is resolved on the client from the existing
 * user-info hooks so the data layer doesn't denormalize transient
 * profile state.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import type { AddMemberInput, CrewMemberDTO } from "./types";
import { getDemoMembers, isDemoCrewId } from "@/app/(site)/crews/_data/demo-crews";

export function useCrewMembers(crewId: string | undefined) {
  return useQuery({
    queryKey: crewKeys.members(crewId ?? ""),
    enabled: !!crewId,
    queryFn: () => {
      if (isDemoCrewId(crewId)) {
        return Promise.resolve(getDemoMembers(crewId!));
      }
      return crewApi.get<CrewMemberDTO[]>(`/crews/${encodeURIComponent(crewId!)}/members`);
    },
  });
}

export function useAddCrewMember(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddMemberInput) =>
      crewApi.post<CrewMemberDTO>(`/crews/${encodeURIComponent(crewId)}/members`, {
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.members(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.detail(crewId) });
    },
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
    mutationFn: ({ memberId, isFinance }: { memberId: string; isFinance: boolean }) =>
      crewApi.patch<CrewMemberDTO>(
        `/crews/${encodeURIComponent(crewId)}/members/${encodeURIComponent(memberId)}`,
        { body: { isFinance } }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.members(crewId) });
    },
  });
}
