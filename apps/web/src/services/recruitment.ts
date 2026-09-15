/**
 * Recruitment service — job applications (招募申请)
 */
import { api } from "@/src/lib/api";

export interface JobApplicant {
  id: string;
  jobId?: string;
  applyUsername?: string;
  applyUsernameAvatar?: string;
  projectName?: string;
  roleId?: number;
  createTime?: string;
  applyStatus?: number;
  [key: string]: unknown;
}

/** 招募申请人列表 */
export const getRecruitmentList = (
  params: { page?: number; pageSize?: number } = {},
  signal?: AbortSignal
) =>
  api.postForm<JobApplicant[]>(
    "/project/job/applicant",
    {
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 50),
    },
    { signal }
  );

/** 同意招募申请 — backend renamed to crew-scoped path. */
export const agreeJobApply = (applyId: string) =>
  api.postForm("/project/crew/job/aggree", { applyId });

/** 拒绝招募申请. Path stays at the legacy `/project/job/refuse` —
 *  backend did NOT rename this one alongside `aggree` (confirmed
 *  2026-05-14: `/project/crew/job/refuse` returns 404). */
export const refuseJobApply = (applyId: string, message = "") =>
  api.postForm("/project/job/refuse", { applyId, message });
