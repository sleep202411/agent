/**
 * Crew workspace: aggregated view (studio header, current ep members,
 * roles progress, todos, activity, episodes, delivery) + the per-row
 * mutations the workspace page exposes (approve/reject ep member,
 * submit ep to client, toggle todo).
 *
 * Mutations write to the React Query cache via `setQueryData` so the UI
 * updates immediately without a refetch round-trip. When the real
 * backend lands, swap the `mutationFn` body to a fetch call — the
 * `onSuccess` cache write keeps the optimistic-feeling UX.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ACTIVITY_LIST,
  CURRENT_EP_MEMBERS,
  DELIVERY_RECORDS,
  MOCK_EPISODES,
  MOCK_WORKSPACE,
  ROLES_PROGRESS,
  TODOS,
} from "../_components/workspace-mock";
import { STATUS_COLOR, STATUS_LABEL_KEY, crewKeys, delay } from "./shared";
import type { EpMemberAction, EpMemberStatus, WorkspaceData } from "./types";

async function fetchCrewWorkspace(_id: string): Promise<WorkspaceData> {
  await delay(260);
  return {
    studio: MOCK_WORKSPACE,
    currentEpMembers: CURRENT_EP_MEMBERS,
    rolesProgress: ROLES_PROGRESS,
    todos: TODOS,
    activity: ACTIVITY_LIST,
    episodes: MOCK_EPISODES,
    delivery: DELIVERY_RECORDS,
  };
}

async function setEpisodeMemberStatus(_args: {
  crewId: string;
  memberName: string;
  action: EpMemberAction;
  reason?: string;
}): Promise<void> {
  await delay(220);
}

async function submitEpisodeToClient(_args: {
  crewId: string;
  episodeNumber: number;
}): Promise<void> {
  await delay(280);
}

async function toggleTodoDone(_args: {
  crewId: string;
  todoIndex: number;
  done: boolean;
}): Promise<void> {
  await delay(160);
}

export function useCrewWorkspace(id: string) {
  return useQuery({
    queryKey: crewKeys.workspace(id),
    queryFn: () => fetchCrewWorkspace(id),
    enabled: !!id,
  });
}

export function useEpisodeMemberAction(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setEpisodeMemberStatus,
    onSuccess: (_void, vars) => {
      if (vars.action === "remind") return;
      const nextStatus: EpMemberStatus =
        vars.action === "approve"
          ? "approved"
          : vars.action === "reject"
            ? "rejected"
            : "submitted";
      qc.setQueryData<WorkspaceData>(crewKeys.workspace(crewId), (old) => {
        if (!old) return old;
        return {
          ...old,
          currentEpMembers: old.currentEpMembers.map((m) =>
            m.name === vars.memberName
              ? {
                  ...m,
                  status: nextStatus,
                  statusLabelKey: STATUS_LABEL_KEY[nextStatus],
                  color: STATUS_COLOR[nextStatus],
                  updated: "Just now",
                }
              : m
          ),
        };
      });
    },
  });
}

export function useSubmitEpisodeToClient(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitEpisodeToClient,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.workspace(crewId) });
    },
  });
}

export function useToggleTodoDone(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: toggleTodoDone,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.workspace(crewId) });
    },
  });
}
