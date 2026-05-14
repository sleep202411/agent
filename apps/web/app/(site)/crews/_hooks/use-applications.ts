/**
 * Job application flow: apply (real) + applicant list (real) + agree /
 * reject (stubbed — backend not wired yet).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { crewKeys } from "./shared";
import type { ApplicationStatus, JobApplicant } from "./types";

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

/**
 * Approve an applicant.
 *
 * Endpoint: `POST /project/crew/job/aggree?applyId={id}` (aggreeCrewJob —
 * yes, backend mis-spells "agree" with double-g; we match the wire).
 * Per swagger: `applyId` query param only, no body. `applyId` is the
 * apply record's id (= `JobApplicant.id`, mapped from the wire `id`
 * field on `/project/crew/job/apply/list`).
 */
async function agreeApplicant(applyId: number): Promise<void> {
  await api.post("/project/crew/job/aggree", {
    params: { applyId: Number(applyId) },
  });
}

/**
 * Reject an applicant.
 *
 * Endpoint: `POST /project/job/refuse?applyId={id}&message={...}`.
 * Despite the swagger doc suggesting a `/project/crew/job/refuse`
 * variant (refuseCrewJob), backend did NOT actually ship the
 * crew-scoped path — confirmed 2026-05-14 with a 404 on that route.
 * Stay on the legacy `/project/job/refuse` until backend explicitly
 * ships the crew-scoped one (and confirms it). `message` is the
 * rejection reason shown back to the applicant; empty string is
 * acceptable when the UI doesn't collect one.
 */
async function rejectApplicant(input: { applicantId: number; message?: string }): Promise<void> {
  await api.post("/project/job/refuse", {
    params: {
      applyId: Number(input.applicantId),
      message: input.message ?? "",
    },
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
      qc.invalidateQueries({ queryKey: crewKeys.applicants(vars.jobId) });
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
