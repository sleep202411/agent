/**
 * Job application flow: apply / list-mine / hasApplied + applicant
 * approve / reject from the crew owner side.
 *
 * Demo state lives in `shared.ts#mutationState` so the apply / approve
 * cycle is observable across components without a backend.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { crewKeys, delay, mutationState } from "./shared";
import type { ApplicationStatus, JobApplicant, JobApplication } from "./types";

/**
 * Apply to a crew recruitment job.
 *
 * Endpoint: `POST /project/crew/job/apply?jobId={id}` (applyCrewJob).
 * Per swagger only `jobId` is required — no body. Backend returns the
 * standard `{ code, msg, data }` envelope; api-client throws on
 * `code !== 200` so the mutation's `onError` fires with the surfaced
 * `msg`.
 */
async function applyToJob({ jobId }: { jobId: number }): Promise<void> {
  await api.post("/project/crew/job/apply", {
    params: { jobId: Number(jobId) },
  });
}

async function fetchMyApplications(): Promise<JobApplication[]> {
  await delay(180);
  return [...mutationState.applications];
}

async function hasAppliedToJob(jobId: number): Promise<boolean> {
  await delay(120);
  return mutationState.applications.some((a) => a.jobId === jobId);
}

/**
 * Wire shape for `POST /project/crew/job/apply/list` (applyCrewJobList).
 *
 * Backend takes `jobId` as a query-string param and returns the list
 * of users who applied to that recruitment slot. Phase-1 backend
 * hasn't published a formal response schema yet — these fields are
 * inferred from the matching `JobApplicant` UI type plus the standard
 * "user envelope" shape elsewhere in the project (`/project/member/query`).
 *
 * **TODO(crew-phase-1)**: validate against the live response — likely
 * tweaks: nested `user` object vs flat fields, `status` numeric (1/2/3)
 * vs string ("pending"/...), date format. Update `mapWireApplicant`
 * once confirmed and drop this comment.
 */
interface WireJobApplicant {
  id?: number;
  jobId?: number;
  userId?: number;
  // User detail — backend may flatten or nest under `user: {...}`. We
  // try both at map time so either layout works.
  userName?: string;
  userAvatar?: string;
  nickName?: string;
  avatar?: string;
  user?: { userId?: number; nickName?: string; avatar?: string };
  // Role / level — denormalised onto each applicant so the row can
  // render without a second join. May be missing.
  roleName?: string;
  level?: string;
  // Application body
  status?: number | string;
  message?: string;
  portfolioUrl?: string;
  appliedAt?: string;
  createTime?: string;
}

/** Backend `status` may come as a numeric enum or a string label.
 *  Map to the UI's discriminated union. Defaults to "pending". */
function mapStatus(raw: WireJobApplicant["status"]): ApplicationStatus {
  if (raw === 1 || raw === "1" || raw === "approved" || raw === "agreed") return "approved";
  if (raw === 2 || raw === "2" || raw === "rejected" || raw === "refused") return "rejected";
  return "pending";
}

function mapWireApplicant(w: WireJobApplicant): JobApplicant {
  return {
    id: Number(w.id ?? 0),
    userId: Number(w.userId ?? w.user?.userId ?? 0),
    userName: String(w.userName ?? w.nickName ?? w.user?.nickName ?? ""),
    userAvatar: String(w.userAvatar ?? w.avatar ?? w.user?.avatar ?? ""),
    jobId: Number(w.jobId ?? 0),
    roleName: String(w.roleName ?? ""),
    level: String(w.level ?? ""),
    status: mapStatus(w.status),
    message: String(w.message ?? ""),
    portfolioUrl: String(w.portfolioUrl ?? ""),
    appliedAt: String(w.appliedAt ?? w.createTime ?? ""),
  };
}

async function fetchJobApplicants(jobId: number): Promise<JobApplicant[]> {
  const data = await api.post<WireJobApplicant[]>("/project/crew/job/apply/list", {
    params: { jobId: Number(jobId) },
  });
  return (data ?? []).map(mapWireApplicant);
}

async function agreeApplicant(applicantId: number): Promise<void> {
  await delay(200);
  for (const [jobId, list] of Object.entries(mutationState.applicantsByJob)) {
    const idx = list.findIndex((a) => a.id === applicantId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], status: "approved" };
      mutationState.applicantsByJob[Number(jobId)] = [...list];
      return;
    }
  }
  throw new Error("Applicant not found");
}

async function rejectApplicant({
  applicantId,
}: {
  applicantId: number;
  reason?: string;
}): Promise<void> {
  await delay(200);
  for (const [jobId, list] of Object.entries(mutationState.applicantsByJob)) {
    const idx = list.findIndex((a) => a.id === applicantId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], status: "rejected" };
      mutationState.applicantsByJob[Number(jobId)] = [...list];
      return;
    }
  }
  throw new Error("Applicant not found");
}

export function useMyApplications() {
  return useQuery({
    queryKey: crewKeys.myApplications,
    queryFn: fetchMyApplications,
  });
}

export function useHasApplied(jobId: number | null) {
  return useQuery({
    queryKey: crewKeys.hasApplied(jobId ?? 0),
    queryFn: () => hasAppliedToJob(jobId!),
    enabled: jobId != null,
  });
}

export function useJobApplicants(jobId: number | null) {
  return useQuery({
    queryKey: crewKeys.applicants(jobId ?? 0),
    queryFn: () => fetchJobApplicants(jobId!),
    enabled: jobId != null,
  });
}

export function useApplyToJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: applyToJob,
    onSuccess: (_app, vars) => {
      qc.invalidateQueries({ queryKey: crewKeys.myApplications });
      qc.invalidateQueries({ queryKey: crewKeys.hasApplied(vars.jobId) });
    },
  });
}

export function useAgreeApplicant(jobId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: agreeApplicant,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.applicants(jobId) });
    },
  });
}

export function useRejectApplicant(jobId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rejectApplicant,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.applicants(jobId) });
    },
  });
}
