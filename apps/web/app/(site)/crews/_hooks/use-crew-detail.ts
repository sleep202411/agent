/**
 * Crew detail read + crew-level mutations (create / update / soft delete).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CrewApiError, crewApi } from "./api";
import { crewKeys } from "./shared";
import type { CreateCrewInput, CrewDTO, UpdateCrewInput, UpdateCrewListingInput } from "./types";

async function fetchCrewDetail(id: string): Promise<CrewDTO | null> {
  try {
    return await crewApi.get<CrewDTO>(`/crews/${encodeURIComponent(id)}`);
  } catch (err) {
    // 404 → null so the caller can render a not-found UI; everything
    // else propagates to the page's error boundary.
    if (err instanceof CrewApiError && err.status === 404) return null;
    throw err;
  }
}

export function useCrewDetail(id: string) {
  return useQuery({
    queryKey: crewKeys.detail(id),
    queryFn: () => fetchCrewDetail(id),
    enabled: !!id,
  });
}

export function useCreateCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCrewInput) => crewApi.post<CrewDTO>("/crews", { body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.mine });
      qc.invalidateQueries({ queryKey: ["crew", "list"] });
    },
  });
}

export function useUpdateCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...rest }: UpdateCrewInput) =>
      crewApi.patch<CrewDTO>(`/crews/${encodeURIComponent(id)}`, { body: rest }),
    onSuccess: (data, vars) => {
      // Server returns the updated row — replace the cache directly so
      // the workspace hero reflects the change before any refetch.
      qc.setQueryData(crewKeys.detail(vars.id), data);
      qc.invalidateQueries({ queryKey: ["crew", "list"] });
      qc.invalidateQueries({ queryKey: crewKeys.mine });
    },
  });
}

export function useUpdateCrewListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateCrewListingInput) =>
      crewApi.patch<CrewDTO>(`/crews/${encodeURIComponent(id)}/listing`, { body }),
    onSuccess: (data, vars) => {
      qc.setQueryData(crewKeys.detail(vars.id), data);
      qc.invalidateQueries({ queryKey: ["crew", "list"] });
      qc.invalidateQueries({ queryKey: crewKeys.mine });
    },
  });
}

export function useDeleteCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => crewApi.delete<void>(`/crews/${encodeURIComponent(id)}`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: crewKeys.detail(id) });
      qc.invalidateQueries({ queryKey: ["crew", "list"] });
      qc.invalidateQueries({ queryKey: crewKeys.mine });
    },
  });
}
