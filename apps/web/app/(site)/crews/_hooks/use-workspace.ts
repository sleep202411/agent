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
import { ApiRequestError, api } from "@/src/lib/api";
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
import type { CrewWire } from "./use-crew-detail";
import type { EpMemberAction, EpMemberStatus, WorkspaceData } from "./types";

interface CrewEnvelope {
  code?: number;
  msg?: string;
  data?: CrewWire;
}

/**
 * Workspace aggregate fetch.
 *
 * Today the only endpoint backend has shipped is `GET /project/crew/detail/{id}`
 * which returns the basic crew (name / description / banner / video).
 * The page however needs richer state — current-episode members,
 * roles progress, todos, activity, episodes, delivery records — none
 * of which has a backing endpoint yet. So we hybrid-merge:
 *
 *   - studio header  ← real backend (CrewWire fields)
 *   - everything else ← MOCK_* constants
 *
 * As backend ships each section's endpoint, swap that one read for a
 * real fetch + drop the matching MOCK_* import.
 */
async function fetchCrewWorkspace(id: string): Promise<WorkspaceData | null> {
  let crew: CrewWire | null = null;
  try {
    const res = await api.get<CrewEnvelope>(`/project/crew/detail/${id}`, { raw: true });
    if (res?.code === 200 && res.data && res.data.id != null) {
      crew = res.data;
    }
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) {
      // 404 → return null so the page can render its not-found state.
      return null;
    }
    throw err;
  }
  if (!crew) return null;

  return {
    // Merge real crew fields into the prototype's WorkspaceStudio
    // shape. Prototype-only fields (status string, type, tags,
    // currentEpisode, totalEpisodes, …) keep their MOCK_WORKSPACE
    // values until backend ships the corresponding endpoints.
    studio: {
      ...MOCK_WORKSPACE,
      name: crew.name,
    },
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
