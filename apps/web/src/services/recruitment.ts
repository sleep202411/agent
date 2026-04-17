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
export const getRecruitmentList = (params: { page?: number; pageSize?: number } = {}) =>
  api.postForm<JobApplicant[]>("/project/job/applicant", {
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 50),
  });

/** 同意招募申请 */
export const agreeJobApply = (applyId: string) => api.postForm("/project/job/aggree", { applyId });

/** 拒绝招募申请 */
export const refuseJobApply = (applyId: string, message = "") =>
  api.postForm("/project/job/refuse", { applyId, message });
