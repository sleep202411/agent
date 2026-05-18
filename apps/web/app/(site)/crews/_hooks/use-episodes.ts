/**
 * Crew episode + assignment hooks — backed by the real Nest endpoints
 * at `/aurora/crews/:crewId/episodes` + `/aurora/episodes/:episodeId/*`
 * + `/aurora/assignments/:id/*`.
 *
 * Wire shapes come from `@repo/shared/crew` — `EpisodeDTO`,
 * `EpisodeAssignmentDTO`, `EpisodeActivityDTO`. IDs are strings (BigInt
 * stringified by the server). The hook signatures still take `crewId`
 * even where the URL doesn't need it, so the query keys can scope
 * invalidations per-crew without extra lookup.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { crewApi } from "./api";
import { crewKeys } from "./shared";
import type { CurrencyCode, EpisodeActivityDTO, EpisodeAssignmentDTO, EpisodeDTO } from "./types";

export type {
  EpisodeDTO as Episode,
  EpisodeAssignmentDTO as EpisodeAssignment,
  EpisodeActivityDTO as EpisodeActivity,
  EpisodeStatus,
  AssignmentStatus,
  EpisodeActivityType,
} from "./types";

interface ActivityPage {
  items: EpisodeActivityDTO[];
  page: number;
  pageSize: number;
  total: number;
}

// ─── Reads ──────────────────────────────────────────────────

export function useCrewEpisodes(crewId: string) {
  return useQuery({
    queryKey: crewKeys.episodes(crewId),
    enabled: !!crewId,
    queryFn: () => crewApi.get<EpisodeDTO[]>(`/crews/${encodeURIComponent(crewId)}/episodes`),
  });
}

export function useEpisodeAssignments(crewId: string, episodeId: string | undefined) {
  return useQuery({
    queryKey: crewKeys.episodeAssignments(crewId, episodeId ?? ""),
    enabled: !!crewId && !!episodeId,
    queryFn: () =>
      crewApi.get<EpisodeAssignmentDTO[]>(
        `/episodes/${encodeURIComponent(episodeId!)}/assignments`
      ),
  });
}

export function useEpisodeActivity(crewId: string, episodeId: string | undefined) {
  return useQuery({
    queryKey: crewKeys.episodeActivity(crewId, episodeId ?? ""),
    enabled: !!crewId && !!episodeId,
    queryFn: () =>
      crewApi.get<ActivityPage>(`/episodes/${encodeURIComponent(episodeId!)}/activities`, {
        query: { page: 1, pageSize: 50 },
      }),
    select: (page) => page.items,
  });
}

// ─── Episode mutations ──────────────────────────────────────

export function useCreateEpisode(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; description?: string; deadline?: string }) =>
      crewApi.post<EpisodeDTO>(`/crews/${encodeURIComponent(crewId)}/episodes`, {
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.episodes(crewId) });
    },
  });
}

export function useApproveEpisode(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (episodeId: string) =>
      crewApi.post<EpisodeDTO>(`/episodes/${encodeURIComponent(episodeId)}/approve`),
    onSuccess: (_data, episodeId) => {
      qc.invalidateQueries({ queryKey: crewKeys.episodes(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeActivity(crewId, episodeId) });
    },
  });
}

// ─── Assignment mutations ───────────────────────────────────

export function useAssignMember(crewId: string, episodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; positionId?: string | null; roleName?: string | null }) =>
      crewApi.post<EpisodeAssignmentDTO>(`/episodes/${encodeURIComponent(episodeId)}/assignments`, {
        body: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.episodes(crewId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeAssignments(crewId, episodeId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeActivity(crewId, episodeId) });
    },
  });
}

export function useUnassignMember(crewId: string, episodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) =>
      crewApi.delete<{ removedId: string; episodeStatus: string }>(
        `/assignments/${encodeURIComponent(assignmentId)}`
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.episodeAssignments(crewId, episodeId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeActivity(crewId, episodeId) });
    },
  });
}

export function useSubmitAssignment(crewId: string, episodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      assignmentId,
      url,
      note,
    }: {
      assignmentId: string;
      url?: string | null;
      note?: string | null;
    }) =>
      crewApi.post<EpisodeAssignmentDTO>(
        `/assignments/${encodeURIComponent(assignmentId)}/submit`,
        { body: { url, note } }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.episodeAssignments(crewId, episodeId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeActivity(crewId, episodeId) });
    },
  });
}

export function useApproveAssignment(crewId: string, episodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) =>
      crewApi.post<EpisodeAssignmentDTO>(
        `/assignments/${encodeURIComponent(assignmentId)}/approve`
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.episodeAssignments(crewId, episodeId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeActivity(crewId, episodeId) });
    },
  });
}

export function useRejectAssignment(crewId: string, episodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      assignmentId,
      reason,
      suggestion,
    }: {
      assignmentId: string;
      reason: string;
      suggestion?: string | null;
    }) =>
      crewApi.post<EpisodeAssignmentDTO>(
        `/assignments/${encodeURIComponent(assignmentId)}/reject`,
        { body: { reason, suggestion } }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.episodeAssignments(crewId, episodeId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeActivity(crewId, episodeId) });
    },
  });
}

export function useSetAssignmentRevenue(crewId: string, episodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      assignmentId,
      amount,
      currency,
    }: {
      assignmentId: string;
      /** Smallest currency unit (cents / 分 / JPY yen). */
      amount: number;
      /** ISO-4217 code; server validates against cell whitelist. Omit
       *  to let the server default to the cell default. */
      currency?: CurrencyCode;
    }) =>
      crewApi.post<EpisodeAssignmentDTO>(
        `/assignments/${encodeURIComponent(assignmentId)}/revenue`,
        { body: currency ? { amount, currency } : { amount } }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.episodeAssignments(crewId, episodeId) });
      qc.invalidateQueries({ queryKey: crewKeys.episodeActivity(crewId, episodeId) });
    },
  });
}
