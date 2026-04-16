/**
 * Certification service — role authentication (身份认证)
 */
import { api } from "@/src/lib/api";

// ─── Types ────────────────────────────────────────────

export interface CertificationRole {
  id: number;
  roleName: string;
  [key: string]: unknown;
}

export interface Certification {
  id: number;
  authRoleId: number;
  authStatus: number; // 0=审核中, 3=未通过, 5=已通过
  authPicPath?: string; // JSON string of image URLs
  refuseInfo?: string;
  createTime?: string;
  [key: string]: unknown;
}

export const AUTH_STATUS = {
  PENDING: 0,
  REJECTED: 3,
  APPROVED: 5,
} as const;

// ─── API ──────────────────────────────────────────────

/** 获取可选认证角色列表（AI工程师、导演、编剧等） */
export const getCertificationRoles = () => api.get<Record<string, string>>("/project/role/list");

/** 获取我的认证列表 */
export const getMyCertifications = () => api.post<Certification[]>("/project/role/mylist");

/** 新增认证 */
export const submitCertification = (data: {
  roleId: number;
  file: Array<{ src: string; des?: string }>;
}) => api.post("/project/role3/auth", { data });

/** 编辑/重新提交认证 */
export const updateCertification = (data: {
  id: number;
  roleId: number;
  file: Array<{ src: string; des?: string }>;
}) => api.post("/project/update/role2/auth", { data });
