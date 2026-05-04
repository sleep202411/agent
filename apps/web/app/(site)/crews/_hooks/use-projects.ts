/**
 * Crew listing data hooks. Mirror the legacy fizzdragon-web `joinCrew`
 * page contract:
 *
 *   GET  /project/role/list                — { id: name } map of project roles
 *   POST /project/job/project/list         — paginated open-recruitment list,
 *                                             form body { roleId?, page, pageSize }
 *
 * The response wraps the project, owner and role-job triples in a single
 * row, so a card needs no follow-up requests to render.
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";

export interface ProjectRole {
  id: number;
  name: string;
}

export interface ProjectListItem {
  project: {
    id: number;
    name: string;
    bannerLink?: string;
    description?: string;
  };
  owner: {
    avatar?: string;
    nickName?: string;
  };
  tags?: string[];
  jobs?: { roleId: number; jobNumber?: number }[];
}

const PAGE_SIZE = 10;

const projectKeys = {
  roles: ["project", "roles"] as const,
  list: (roleId?: number) => ["project", "list", roleId ?? "all"] as const,
};

export function useProjectRoles() {
  return useQuery({
    queryKey: projectKeys.roles,
    queryFn: async () => {
      const data = await api.get<Record<string, string>>("/project/role/list");
      // Backend returns `{ "1": "Director", "2": "Writer", ... }` —
      // flatten into a sorted [{ id, name }] array.
      return Object.entries(data ?? {})
        .map(([id, name]) => ({ id: Number(id), name }))
        .sort((a, b) => a.id - b.id);
    },
  });
}

export function useProjectsByJob(roleId?: number) {
  return useInfiniteQuery({
    queryKey: projectKeys.list(roleId),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const body: Record<string, string> = {
        page: String(pageParam),
        pageSize: String(PAGE_SIZE),
      };
      if (roleId != null) body.roleId = String(roleId);
      // api-client unwraps `body.data`, so postForm returns just the
      // ProjectListItem[]. The legacy page also reads `sum` from the
      // envelope, but `length < PAGE_SIZE` covers the common stop case.
      const items = await api.postForm<ProjectListItem[]>("/project/job/project/list", body);
      return { items: items ?? [], page: pageParam as number };
    },
    getNextPageParam: (last) => {
      if (last.items.length < PAGE_SIZE) return undefined;
      return last.page + 1;
    },
  });
}

export const PROJECT_PAGE_SIZE = PAGE_SIZE;

// ──────────────────────────────────────────────────────────────────
// Detail-page contracts (mirrors legacy fizzdragon-web/projectDetail)
// ──────────────────────────────────────────────────────────────────

export interface ProjectDetail {
  id: number;
  name: string;
  description?: string;
  bannerLink?: string;
  ownerId?: number;
  contact?: string;
  tags?: string[];
}

export interface ProjectJob {
  id: number;
  projectId?: number;
  roleId: number;
  jobDescription?: string;
  jobNumber?: number;
}

export interface ProjectMember {
  id?: number;
  userId?: number;
  nickName?: string;
  avatar?: string;
  roleId?: number;
  roleName?: string;
}

export interface OwnerInfo {
  userId?: number;
  nickName?: string;
  avatar?: string;
}

const detailKeys = {
  detail: (id: string | number) => ["project", "detail", String(id)] as const,
  jobs: (id: string | number) => ["project", "jobs", String(id)] as const,
  members: (id: string | number) => ["project", "members", String(id)] as const,
  videoLink: (id: string | number) => ["project", "videoLink", String(id)] as const,
  owner: (userId: string | number) => ["user", "info", String(userId)] as const,
  applyStatus: (jobId: string | number) => ["project", "job", "hasApply", String(jobId)] as const,
};

export function useProjectDetail(projectId: string | number | undefined) {
  return useQuery({
    queryKey: detailKeys.detail(projectId ?? ""),
    enabled: projectId != null && projectId !== "",
    queryFn: () => api.postForm<ProjectDetail>("/project/query", { projectId: String(projectId) }),
  });
}

export function useProjectJobs(projectId: string | number | undefined) {
  return useQuery({
    queryKey: detailKeys.jobs(projectId ?? ""),
    enabled: projectId != null && projectId !== "",
    queryFn: async () => {
      const data = await api.postForm<ProjectJob[]>("/project/job/find/jobs", {
        projectId: String(projectId),
      });
      return data ?? [];
    },
  });
}

export function useProjectMembers(projectId: string | number | undefined) {
  return useQuery({
    queryKey: detailKeys.members(projectId ?? ""),
    enabled: projectId != null && projectId !== "",
    queryFn: async () => {
      const data = await api.postForm<ProjectMember[]>("/project/member/query", {
        projectId: String(projectId),
      });
      return data ?? [];
    },
  });
}

export function useProjectVideoLink(projectId: string | number | undefined) {
  return useQuery({
    queryKey: detailKeys.videoLink(projectId ?? ""),
    enabled: projectId != null && projectId !== "",
    queryFn: () => api.postForm<string>("/vedio/play/project/getLink", { id: String(projectId) }),
  });
}

export function useOwnerInfo(userId: string | number | undefined) {
  return useQuery({
    queryKey: detailKeys.owner(userId ?? ""),
    enabled: userId != null && userId !== "",
    queryFn: () =>
      api.post<OwnerInfo>("/user/other/user/info", {
        params: { UserId: String(userId) },
      }),
  });
}

/**
 * Apply status: -2 = own project (no apply allowed); -1 = never applied
 * (eligible to apply); 0 = pending; 1 = approved; 2 = rejected; 6 = withdrawn.
 * The api-client unwraps `body.data`, but this endpoint returns the
 * status on the envelope itself, so we read the raw response via fetch.
 */
export function useJobApplyStatus(jobId: number | undefined) {
  return useQuery({
    queryKey: detailKeys.applyStatus(jobId ?? ""),
    enabled: jobId != null,
    queryFn: async () => {
      const res = await fetch("/project/job/hasApply", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: new URLSearchParams({ jobId: String(jobId) }).toString(),
      });
      const body = (await res.json()) as { code?: number; status?: number };
      if (body.code !== 200) throw new Error("hasApply failed");
      return body.status ?? -1;
    },
  });
}

export function useApplyJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: number) =>
      api.postForm<unknown>("/project/job/apply", { jobId: String(jobId) }),
    onSuccess: (_data, jobId) => {
      qc.invalidateQueries({ queryKey: detailKeys.applyStatus(jobId) });
    },
  });
}
