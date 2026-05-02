/**
 * Crew detail read + crew-level mutations (create / update / delete).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MOCK_CREWS, MOCK_CREW_DETAIL } from "../_components/crew-mock";
import { crewKeys, delay } from "./shared";
import type { CreateCrewInput, CrewDetail, UpdateCrewInput } from "./types";

async function fetchCrewDetail(id: string): Promise<CrewDetail | null> {
  await delay(220);
  if (id !== MOCK_CREW_DETAIL.id && !MOCK_CREWS.some((c) => c.id === id)) {
    return null;
  }
  return { ...MOCK_CREW_DETAIL, id };
}

async function createCrew(_input: CreateCrewInput): Promise<{ id: string }> {
  // Mock until backend ships; mirrors the IP module pattern (no fallback —
  // a real backend failure will surface via the mutation's onError).
  await delay(300);
  return { id: `s_${Date.now()}` };
}

async function updateCrew(_input: UpdateCrewInput): Promise<void> {
  await delay(200);
}

async function deleteCrew(_id: string): Promise<void> {
  await delay(200);
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
    mutationFn: createCrew,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.myOwned });
      qc.invalidateQueries({ queryKey: ["crew", "list"] });
    },
  });
}

export function useUpdateCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateCrew,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: crewKeys.detail(vars.id) });
      qc.invalidateQueries({ queryKey: ["crew", "list"] });
    },
  });
}

export function useDeleteCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteCrew,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crew", "list"] });
      qc.invalidateQueries({ queryKey: crewKeys.myOwned });
    },
  });
}
