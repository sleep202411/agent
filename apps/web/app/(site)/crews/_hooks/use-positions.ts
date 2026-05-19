/**
 * Crew positions (recruitment slots): list / create / update / delete.
 *
 * Replaces the legacy "jobs" terminology — server now models them as
 * `CrewPosition` with `positionType` (preset value), `targetCount`,
 * `recruitedCount`, and a `status` of open/frozen/full.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import type { CreatePositionInput, CrewPositionDTO, UpdatePositionInput } from "./types";
import { getDemoPositions, isDemoCrewId } from "@/app/(site)/crews/_data/demo-crews";

export function useCrewPositions(crewId: string | undefined) {
  return useQuery({
    queryKey: crewKeys.positions(crewId ?? ""),
    enabled: !!crewId,
    queryFn: () => {
      if (isDemoCrewId(crewId)) {
        return Promise.resolve(getDemoPositions(crewId!));
      }
      return crewApi.get<CrewPositionDTO[]>(`/crews/${encodeURIComponent(crewId!)}/positions`);
    },
  });
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
