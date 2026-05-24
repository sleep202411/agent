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
  /** Lifecycle status (admin-controlled except for 0):
   *  0 = pending review (default after any user save)
   *  3 = rejected by admin
   *  5 = approved by admin (visible in Plaza)
   *  8 = taken down by admin (admin-only) */
  projectStatus?: number;
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
// Backend returns `{ code, msg, data: Project[], sum: number }` —
// `sum` is the total row count (not `data.length`), so we read the raw
// envelope to keep the count for pagination.
export interface MyProjectsResponse {
  data: Project[];
  sum: number;
}

export const getMyProjects = (page = 1, pageSize = 10) =>
  api.postForm<MyProjectsResponse>(
    "/project/myprojects",
    { page: String(page), pageSize: String(pageSize) },
    { raw: true }
  );

/** 我加入的项目 */
export const getMyJoinedProjects = (page = 1, pageSize = 10) =>
  api.postForm<Project[]>("/project/myjoined", {
    page: String(page),
    pageSize: String(pageSize),
  });

/** 个人作品（视频） */
export interface PersonalWork {
  id: number;
  title?: string;
  introduction?: string;
  videoBanner?: string | null;
  videoLink?: string | null;
  viewStatus?: number;
  review?: number; // 0=审核中, 1=已通过
  createTime?: string;
}

export const getMyPersonalWorks = (page = 1, pageSize = 10) =>
  api.postForm<PersonalWork[]>("/vedio/query/mypersonal", {
    page: String(page),
    pageSize: String(pageSize),
  });

/** 人才库 详情页：某用户的个人作品集（视频） */
export const getUserPersonalWorks = (userId: number | string, page = 1, pageSize = 10) =>
  api.postForm<PersonalWork[]>("/vedio/query/user/personal", {
    userId: String(userId),
    page: String(page),
    pageSize: String(pageSize),
  });

/** 人才库 详情页：某用户作为创建者的项目作品 */
export const getUserProjects = (userId: number | string, page = 1, pageSize = 10) =>
  api.postForm<Project[]>("/project/user/projects", {
    userId: String(userId),
    page: String(page),
    pageSize: String(pageSize),
  });

/** 人才库 详情页：某用户加入的项目 */
export const getUserJoinedProjects = (userId: number | string, page = 1, pageSize = 10) =>
  api.postForm<Project[]>("/project/user/joined", {
    userId: String(userId),
    page: String(page),
    pageSize: String(pageSize),
  });

/** 创建个人作品 */
export const createPersonalWork = (data: {
  title: string;
  introduction?: string;
  tags?: number[];
  viewStatus?: number;
}) => api.post<{ id: number }>("/vedio/create/personal/video", { data });

/** 上传个人作品视频
 *
 * TODO(backend): drop the form-body `token` field once the Java handler
 * for `/vedio/upload/personal/video/backup` reads auth from the cookie
 * (Sa-Token already serves it via `credentials: "include"`). The form
 * field is a uni-app legacy workaround — modern browsers send the
 * cookie reliably, the controller just hasn't been migrated.
 *
 * Until then we must read the satoken cookie ourselves and stuff it in
 * the form body, mirroring `fizzdragon-web/pages/publicVideo/publicVideoPC.vue`.
 * Without it the upload returns an auth error even though the cookie
 * is present on the request.
 */
export async function uploadPersonalVideo(id: number | string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("id", String(id));
  if (typeof document !== "undefined") {
    const match = document.cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
    if (match?.[1]) formData.append("token", match[1]);
  }

  // Hit `/content/vedio/...` (not bare `/vedio/...`) so nginx's
  // `location /content/` block proxies straight to Java on
  // localhost:8080. The bare prefix falls through to `location /` →
  // AKS web pod → next.config.ts rewrite back to /content/vedio on
  // ECS again — 3 hops, double CN↔SEA crossing, frequent stalls on
  // multi-hundred-MB uploads (observed 2026-05-24).
  const response = await fetch(
    `${typeof window !== "undefined" ? window.location.origin : ""}/content/vedio/upload/personal/video/backup`,
    {
      method: "POST",
      credentials: "include",
      body: formData,
    }
  );

  if (!response.ok) {
    throw new Error(`Upload failed: HTTP ${response.status}`);
  }

  const body = await response.json();
  if (body.code !== 200 && body.code !== "SUCCESS" && !body.success) {
    throw new Error(body.msg || body.message || "Upload failed");
  }

  return (body.data ?? body.path ?? "") as string;
}

/** 更新个人作品 */
export const updatePersonalWork = (data: {
  id: number | string;
  title?: string;
  introduction?: string;
  viewStatus?: number;
}) =>
  api.postForm(
    "/vedio/update/personal/video",
    Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? "")]))
  );

/** 获取个人作品播放链接 */
export const getPersonalVideoLink = (id: number | string) =>
  api.postForm<string>("/vedio/play/personal/getLink", { id: String(id) });

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
