/**
 * Crew episode-management hooks.
 *
 * All endpoints are still mock-backed (see `episode-mock.ts`). The
 * hook shapes mirror what the backend wire contract will look like
 * once it ships — to switch to real HTTP, replace each fetcher /
 * mutator body with `api.post(...)` / `api.get(...)` and keep the
 * query keys + signatures intact. UI code below this layer never
 * needs to change.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { crewKeys } from "./shared";
import {
  approveAssignment as mockApproveAssignment,
  approveEpisode as mockApproveEpisode,
  assignMember as mockAssignMember,
  createEpisode as mockCreateEpisode,
  listActivity,
  listAssignments,
  listEpisodes,
  rejectAssignment as mockRejectAssignment,
  setAssignmentRevenue as mockSetRevenue,
  submitAssignment as mockSubmitAssignment,
  unassignMember as mockUnassignMember,
  type Episode,
  type EpisodeActivity,
  type EpisodeAssignment,
} from "./episode-mock";
import { useUserInfo } from "@/src/hooks/use-user";

export type {
  Episode,
  EpisodeActivity,
  EpisodeAssignment,
  EpisodeStatus,
  AssignmentStatus,
  EpisodeActivityType,
  AssignmentRevenue,
  AssignmentSubmission,
  AssignmentReviewNote,
} from "./episode-mock";

// ─── Actor binding ─────────────────────────────────────
//
// Mutations log activity entries naming the actor. Pulling from
// `useUserInfo()` keeps the mock realistic and means swapping to real
// backend later doesn't change any call sites — backend will derive
// the actor from the auth token instead.

function useActor() {
  const { data: user } = useUserInfo();
  return {
    actorUserId: user?.id != null ? Number(user.id) : 0,
    actorName: user?.nickName || user?.userName || `User ${user?.id ?? "?"}`,
  };
}

// ─── Reads ─────────────────────────────────────────────

export function useCrewEpisodes(crewId: string) {
  return useQuery<Episode[]>({
    queryKey: crewKeys.episodes(crewId),
    queryFn: async () => listEpisodes(crewId),
    enabled: !!crewId,
  });
}

export function useEpisodeAssignments(crewId: string, episodeId: number | undefined) {
  return useQuery<EpisodeAssignment[]>({
    queryKey: crewKeys.episodeAssignments(crewId, episodeId ?? 0),
    queryFn: async () => (episodeId != null ? listAssignments(crewId, episodeId) : []),
    enabled: !!crewId && episodeId != null,
  });
}

export function useEpisodeActivity(crewId: string, episodeId: number | undefined) {
  return useQuery<EpisodeActivity[]>({
    queryKey: crewKeys.episodeActivity(crewId, episodeId ?? 0),
    queryFn: async () => (episodeId != null ? listActivity(crewId, episodeId) : []),
    enabled: !!crewId && episodeId != null,
  });
}

// ─── Episode mutations ─────────────────────────────────

export function useCreateEpisode(crewId: string) {
  const qc = useQueryClient();
  const actor = useActor();
  return useMutation({
    mutationFn: async (input: { title?: string; description?: string; deadline?: string }) =>
      mockCreateEpisode({ crewId, ...input }, actor),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.episodes(crewId) });
    },
  });
}

export function useApproveEpisode(crewId: string) {
  const qc = useQueryClient();
  const actor = useActor();
  return useMutation({
    mutationFn: async (episodeId: number) => mockApproveEpisode(crewId, episodeId, actor),
    onSuccess: (_data, episodeId) => {
      qc.invalidateQueries({ queryKey: crewKeys.episodes(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeActivity(crewId, episodeId) });
    },
  });
}

// ─── Assignment mutations ──────────────────────────────

export function useAssignMember(crewId: string, episodeId: number) {
  const qc = useQueryClient();
  const actor = useActor();
  return useMutation({
    mutationFn: async (input: { userId: number; roleId?: number; roleName?: string }) =>
      mockAssignMember({ crewId, episodeId, ...input }, actor),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.episodes(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeAssignments(crewId, episodeId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeActivity(crewId, episodeId) });
    },
  });
}

export function useUnassignMember(crewId: string, episodeId: number) {
  const qc = useQueryClient();
  const actor = useActor();
  return useMutation({
    mutationFn: async (assignmentId: number) => {
      mockUnassignMember(crewId, assignmentId, actor);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.episodeAssignments(crewId, episodeId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeActivity(crewId, episodeId) });
    },
  });
}

export function useSubmitAssignment(crewId: string, episodeId: number) {
  const qc = useQueryClient();
  const actor = useActor();
  return useMutation({
    mutationFn: async (input: { assignmentId: number; note?: string; url?: string }) =>
      mockSubmitAssignment(crewId, input.assignmentId, { note: input.note, url: input.url }, actor),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.episodeAssignments(crewId, episodeId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeActivity(crewId, episodeId) });
    },
  });
}

export function useApproveAssignment(crewId: string, episodeId: number) {
  const qc = useQueryClient();
  const actor = useActor();
  return useMutation({
    mutationFn: async (assignmentId: number) => mockApproveAssignment(crewId, assignmentId, actor),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.episodeAssignments(crewId, episodeId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeActivity(crewId, episodeId) });
    },
  });
}

export function useRejectAssignment(crewId: string, episodeId: number) {
  const qc = useQueryClient();
  const actor = useActor();
  return useMutation({
    mutationFn: async (input: { assignmentId: number; reason: string; suggestion?: string }) =>
      mockRejectAssignment(
        crewId,
        input.assignmentId,
        { reason: input.reason, suggestion: input.suggestion },
        actor
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.episodeAssignments(crewId, episodeId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeActivity(crewId, episodeId) });
    },
  });
}

export function useSetAssignmentRevenue(crewId: string, episodeId: number) {
  const qc = useQueryClient();
  const actor = useActor();
  return useMutation({
    mutationFn: async (input: { assignmentId: number; amount: number; currency?: string }) =>
      mockSetRevenue(
        crewId,
        input.assignmentId,
        { amount: input.amount, currency: input.currency },
        actor
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.episodeAssignments(crewId, episodeId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeActivity(crewId, episodeId) });
    },
  });
}
