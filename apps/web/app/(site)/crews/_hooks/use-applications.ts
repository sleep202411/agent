/**
 * Application flow: apply / list-for-owner / approve / reject.
 *
 * Applications are scoped to (crewId, positionId, applicantId). The
 * owner inbox is keyed by crewId; individual transitions are keyed by
 * application id so the URL doesn't need to repeat the crew context.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import type { ApplyInput, CrewApplicationDTO } from "./types";

/** Owner-facing inbox — pending first, then recent decisions. */
export function useCrewApplications(crewId: string | undefined) {
  return useQuery({
    queryKey: crewKeys.applications(crewId ?? ""),
    enabled: !!crewId,
    queryFn: () =>
      crewApi.get<CrewApplicationDTO[]>(`/crews/${encodeURIComponent(crewId!)}/applications`),
  });
}

export function useApplyToPosition(crewId: string, positionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApplyInput) =>
      crewApi.post<CrewApplicationDTO>(
        `/crews/${encodeURIComponent(crewId)}/positions/${encodeURIComponent(positionId)}/apply`,
        { body: input }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.applications(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.positions(crewId) });
    },
  });
}

export function useApproveApplication(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (applicationId: string) =>
      crewApi.post<CrewApplicationDTO>(
        `/applications/${encodeURIComponent(applicationId)}/approve`
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.applications(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.members(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.positions(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.detail(crewId) });
    },
  });
}

export function useRejectApplication(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (applicationId: string) =>
      crewApi.post<CrewApplicationDTO>(`/applications/${encodeURIComponent(applicationId)}/reject`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.applications(crewId) });
    },
  });
}
