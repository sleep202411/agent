/**
 * IP feature data layer.
 *
 * This file is the **reference implementation** of the project's
 * feature-colocation convention. The IP feature is self-contained: types,
 * fetchers, and React Query hooks for every IP-private concern live here.
 * The IP routes import only from this file (or sibling _data / _components),
 * never from `src/hooks/*` or `src/services/*`.
 *
 * ## What lives here vs. what stays in `src/`
 *
 *   - **Feature-private data** (IP listing, categories, tags, project
 *     detail/members/jobs as consumed *by the IP UI*) → lives here.
 *   - **App-level shared infrastructure** (auth, current user, generic
 *     API client, env config) → stays in `src/services/` and
 *     `src/hooks/`. The IP feature imports those unchanged.
 *   - **Service functions reused across multiple features**
 *     (e.g. `updateProject` is also called by `(site)/profile`) → stay
 *     in `src/services/project.ts`. Only the React-Query *hook wrappers*
 *     live here, so the IP feature owns its caching keys and
 *     invalidation rules without duplicating the transport layer.
 *
 * ## When to add to this file
 *
 * Anything the IP feature uses that no other feature should depend on.
 * If a second feature later needs the same data, that's a real signal —
 * promote the hook to `src/hooks/` at that point, don't try to predict
 * sharing in advance.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { env } from "@/src/env";
import {
  getProjectDetail,
  getProjectVideoLink,
  getProjectMembers,
  getProjectJobs,
  uploadProjectVideo,
  updateProject,
  type Project,
  type ProjectMember,
  type ProjectJob,
} from "@/src/services/project";

// ─── IP-listing types ───────────────────────────────

export interface IPProject {
  id: number;
  ownerId: number;
  ownerName: string;
  ownerAvatar: string;
  name: string;
  typeId: number;
  bannerLink: string;
  videoLink: string | null;
  description: string;
  createTime: string;
  projectStatus: number;
  contact: string;
  tag: string | null;
  background: string | null;
}

/** Category map: { "1": "AIGC影视", "2": "热血动漫", ... } */
export type CategoryMap = Record<string, string>;

export interface TagListResponse {
  /** All tags: { "1": "AIGC影视", "11": "悬疑", ... } */
  all: Record<string, string>;
  /** Tags grouped by category name: { "AIGC影视": ["宫廷权谋", ...], ... } */
  data: Record<string, string[]>;
  /** Tag ID→name grouped by category name: { "AIGC影视": { "48": "宫廷权谋", ... }, ... } */
  map: Record<string, Record<string, string>>;
}

// Re-export shared project types so IP code only ever imports from here.
export type { Project, ProjectMember, ProjectJob };

// ─── Fetchers ───────────────────────────────────────
//
// All endpoints sit under /vedio/* — that path matches the next.config.ts
// rewrite for JAVA_CONTENT_URL and the (typo'd) backend route. Coordinate
// with the backend before renaming.
//
// `credentials: "include"` is required so the SaToken auth cookie rides
// along; without it the backend can't identify the user and 500s on the
// missing context. `accept-language` is required for the i18n layer.

function acceptLanguage(): string {
  if (typeof document !== "undefined") {
    const htmlLang = document.documentElement.lang;
    if (htmlLang) return htmlLang;
  }
  return "en-US";
}

async function searchIPProjects(params: {
  page?: number;
  pageSize?: number;
  key?: string;
}): Promise<{ list: IPProject[]; total: number }> {
  const res = await fetch("/vedio/project/search", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "accept-language": acceptLanguage(),
    },
    body: new URLSearchParams({
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 20),
      key: params.key ?? "",
    }),
  });
  const json = (await res.json()) as { code: number; data: IPProject[]; sum: number };
  return { list: json.data ?? [], total: json.sum ?? 0 };
}

async function getCategories(): Promise<CategoryMap> {
  const res = await fetch("/vedio/type/list", {
    credentials: "include",
    headers: { "accept-language": acceptLanguage() },
  });
  const json = (await res.json()) as { code: number; data: Record<string, string> };
  return json.data ?? {};
}

async function getTagList(): Promise<TagListResponse> {
  const res = await fetch("/vedio/type/tag/list", {
    credentials: "include",
    headers: { "accept-language": acceptLanguage() },
  });
  const json = (await res.json()) as TagListResponse & { code: number };
  return { all: json.all ?? {}, data: json.data ?? {}, map: json.map ?? {} };
}

// ─── Query keys ─────────────────────────────────────

export const ipKeys = {
  all: ["ip"] as const,
  projects: (page: number, pageSize: number) => ["ip", "projects", { page, pageSize }] as const,
  categories: ["ip", "categories"] as const,
  tags: ["ip", "tags"] as const,
  detail: (id: string) => ["ip", "detail", id] as const,
  video: (id: string) => ["ip", "video", id] as const,
  members: (id: string) => ["ip", "members", id] as const,
  jobs: (id: string) => ["ip", "jobs", id] as const,
};

// ─── List hooks ─────────────────────────────────────

export function useIPProjects(params?: { page?: number; pageSize?: number }) {
  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 20;
  return useQuery<{ list: IPProject[]; total: number }>({
    queryKey: ipKeys.projects(page, pageSize),
    queryFn: () => searchIPProjects({ page, pageSize }),
  });
}

// Categories and tags are reference data — they barely change between
// sessions, so cache them aggressively to skip redundant trips.
export function useIPCategories() {
  return useQuery<CategoryMap>({
    queryKey: ipKeys.categories,
    queryFn: getCategories,
    staleTime: 1000 * 60 * 30,
  });
}

export function useIPTags() {
  return useQuery<TagListResponse>({
    queryKey: ipKeys.tags,
    queryFn: getTagList,
    staleTime: 1000 * 60 * 30,
  });
}

// ─── Detail hooks ───────────────────────────────────
//
// These wrap the shared `src/services/project.ts` functions. The service
// is reused across features (also called from `(site)/profile`), but the
// hook wrappers + cache keys are IP-private.

export function useProjectDetail(id: string) {
  return useQuery<Project>({
    queryKey: ipKeys.detail(id),
    queryFn: () => getProjectDetail(id),
    enabled: !!id,
  });
}

export function useProjectVideoLink(id: string) {
  return useQuery<string>({
    queryKey: ipKeys.video(id),
    queryFn: () => getProjectVideoLink(id),
    enabled: !!id,
  });
}

export function useProjectMembers(id: string) {
  return useQuery<ProjectMember[]>({
    queryKey: ipKeys.members(id),
    queryFn: () => getProjectMembers(id),
    enabled: !!id,
  });
}

export function useProjectJobs(id: string) {
  return useQuery<ProjectJob[]>({
    queryKey: ipKeys.jobs(id),
    queryFn: () => getProjectJobs(id),
    enabled: !!id,
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProject,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ipKeys.detail(String(variables.id)) });
      queryClient.invalidateQueries({ queryKey: ["ip", "projects"] });
    },
  });
}

export function useUploadProjectVideo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, file }: { projectId: string; file: File }) =>
      uploadProjectVideo(projectId, file),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ipKeys.video(variables.projectId) });
    },
  });
}

// ─── Helpers ────────────────────────────────────────

/** Convert a relative image path to a full banner OSS URL. */
export function ipImageUrl(path?: string | null): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${env.BANNER_BASE_URL}/${path}`;
}
