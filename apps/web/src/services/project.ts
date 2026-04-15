/**
 * Project (IP) service — my projects, joined projects
 */
import { api } from "@/src/lib/api";

// ─── Types ────────────────────────────────────────────

export interface Project {
  id: number;
  ownerId?: number;
  ownerName?: string | null;
  ownerAvatar?: string | null;
  name: string;
  typeId?: number;
  bannerLink?: string | null;
  videoLink?: string | null;
  description?: string | null;
  projectStatus?: number; // 0=正常, 1=下架
  contact?: string | null;
  tag?: string | null;
  background?: string | null;
  createTime?: string;
  // Future fields (pending backend)
  story?: string | null;
  whyThisIP?: string | null;
  targetEpisodes?: number | null;
}

export interface ProjectMember {
  id?: number;
  userId?: number;
  userName?: string | null;
  nickName?: string | null;
  avatar?: string | null;
  roleId?: number;
  roleName?: string | null;
  profitRatio?: number;
  guaranteedIncome?: number;
  [key: string]: unknown;
}

export interface ProjectJob {
  id?: number;
  projectId?: number;
  roleId?: number;
  roleName?: string | null;
  jobDescription?: string | null;
  profitRatio?: number;
  estimatedEarnings?: number;
  status?: number; // 0=open, 1=closed
  [key: string]: unknown;
}

export interface ProfitInfo {
  [key: string]: unknown;
}

// ─── API ──────────────────────────────────────────────

/** 我的 IP（我创建的项目） */
export const getMyProjects = (page = 1, pageSize = 10) =>
  api.postForm<Project[]>("/project/myprojects", {
    page: String(page),
    pageSize: String(pageSize),
  });

/** 我加入的项目 */
export const getMyJoinedProjects = (page = 1, pageSize = 10) =>
  api.postForm<Project[]>("/project/myjoined", {
    page: String(page),
    pageSize: String(pageSize),
  });

/** 个人作品（视频） */
export const getMyPersonalWorks = (page = 1, pageSize = 10) =>
  api.postForm<unknown[]>("/vedio/query/mypersonal", {
    page: String(page),
    pageSize: String(pageSize),
  });

/** 获取 IP 详情 */
export const getProjectDetail = (projectId: number | string) =>
  api.postForm<Project>("/project/query", {
    projectId: String(projectId),
  });

/** 创建 IP */
export const createProject = (data: {
  name: string;
  typeId: string | number;
  description?: string;
  background?: string;
  bannerLink?: string;
  contact?: string;
  tag?: string;
}) => api.post<{ id: number }>("/project/create", { data });

/** 获取 IP 宣传视频链接 */
export const getProjectVideoLink = (projectId: number | string) =>
  api.postForm<string>("/vedio/play/project/getLink", { id: String(projectId) });

/** 上传 IP 宣传视频 */
export async function uploadProjectVideo(projectId: number | string, file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("projectId", String(projectId));
  const res = await fetch("/content/project/upload/project/video/backup", {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  const body = await res.json();
  if (body?.code !== 200) throw new Error(body?.msg || "Upload failed");
  return body?.data ?? body?.path ?? "";
}

/** 获取团队成员 */
export async function getProjectMembers(projectId: number | string): Promise<ProjectMember[]> {
  const res = await api.post<unknown>("/project/member/query", {
    data: { projectId: String(projectId) },
  });
  if (Array.isArray(res)) return res;
  if (res && typeof res === "object" && "list" in res)
    return (res as { list: ProjectMember[] }).list ?? [];
  return [];
}

/** 获取招聘岗位 */
export async function getProjectJobs(projectId: number | string): Promise<ProjectJob[]> {
  const res = await api.postForm<unknown>("/project/job/find/jobs", {
    projectId: String(projectId),
  });
  if (Array.isArray(res)) return res;
  if (res && typeof res === "object" && "list" in res)
    return (res as { list: ProjectJob[] }).list ?? [];
  return [];
}

/** 获取分润信息 */
export const getProjectProfits = (projectId: number | string) =>
  api.post<ProfitInfo>("/project/profit/query/all", { data: { projectId: Number(projectId) } });

/** 编辑 IP */
export const updateProject = (data: {
  id: number | string;
  name?: string;
  typeId?: string | number;
  description?: string;
  background?: string;
  bannerLink?: string;
  contact?: string;
  tag?: string;
  projectStatus?: number;
}) =>
  api.postForm(
    "/project/update",
    Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? "")]))
  );
