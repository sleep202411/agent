/**
 * Crew member mutations: invite / remove. Read-side member rosters
 * come back as part of `useCrewDetail` and `useCrewWorkspace`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { crewKeys, delay } from "./shared";

async function inviteMember(_args: { crewId: string; identifier: string }): Promise<void> {
  await delay(240);
}

async function removeMember(_input: { crewId: string; userId: number }): Promise<void> {
  await delay(180);
}

export function useInviteMember(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: inviteMember,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.workspace(crewId) });
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeMember,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: crewKeys.detail(vars.crewId) });
    },
  });
}
