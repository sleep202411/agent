/**
 * IP detail-page reads + project-level mutations.
 *
 *   - `useProjectDetail`        — POST /project/query (form-encoded)
 *   - `useProjectVideoLink`     — POST /vedio/play/project/getLink
 *   - `useProjectJobs`          — POST /project/job/find/jobs
 *   - `useUpdateProject`        — POST /project/update (form-encoded)
 *   - `useUploadProjectVideo`   — multipart /content/project/upload/project/video/backup
 *
 * Episode reads / member reads / FAQ reads live in their own files.
 *
 * Fetchers are inlined here (and only here) — the IP feature owns its
 * full data layer. If another feature later needs the same shapes,
 * it should redefine them locally rather than importing from us.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipKeys, postForm } from "./shared";
import type { Project, ProjectJob } from "./types";

// ─── Reads ─────────────────────────────────────────────

async function fetchProjectDetail(projectId: string): Promise<Project> {
  return postForm<Project>("/project/query", { projectId });
}

async function fetchProjectVideoLink(projectId: string): Promise<string> {
  return postForm<string>("/vedio/play/project/getLink", { id: projectId });
}

async function fetchProjectJobs(projectId: string): Promise<ProjectJob[]> {
  const res = await postForm<ProjectJob[] | { list?: ProjectJob[] }>("/project/job/find/jobs", {
    projectId,
  });
  if (Array.isArray(res)) return res;
  return res?.list ?? [];
}

/**
 * Legacy project-job query (`/project/job/project/list` aka
 * `queryProjectByrole`). Kept around solely so the IP detail page can
 * detect projects whose hiring data lives in the old shape and surface
 * a "岗位招聘" tab for them. Once historical data is migrated to the
 * new `/project/job/find/jobs` shape this hook + the conditional tab
 * can be deleted.
 *
 * `roleId` is required by the endpoint; we feed it the projectId by
 * default since that's how the legacy data was keyed. Adjust here if
 * a different scoping field turns out to match the historical wire.
 */
async function fetchLegacyJobsByRole(
  roleId: number | string,
  page: number,
  pageSize: number
): Promise<ProjectJob[]> {
  const res = await postForm<ProjectJob[] | { list?: ProjectJob[] }>("/project/job/project/list", {
    page: String(page),
    pageSize: String(pageSize),
    roleId: String(roleId),
  });
  if (Array.isArray(res)) return res;
  return res?.list ?? [];
}

export function useLegacyJobsByRole(roleId: number | string | undefined, enabled: boolean = true) {
  return useQuery<ProjectJob[]>({
    queryKey: ipKeys.legacyJobsByRole(String(roleId ?? "")),
    queryFn: () => fetchLegacyJobsByRole(roleId!, 1, 20),
    enabled: !!roleId && enabled,
  });
}

export function useProjectDetail(id: string) {
  return useQuery<Project>({
    queryKey: ipKeys.detail(id),
    queryFn: () => fetchProjectDetail(id),
    enabled: !!id,
  });
}

export function useProjectVideoLink(id: string, enabled: boolean = true) {
  return useQuery<string>({
    queryKey: ipKeys.video(id),
    queryFn: () => fetchProjectVideoLink(id),
    enabled: !!id && enabled,
  });
}

export function useProjectJobs(id: string) {
  return useQuery<ProjectJob[]>({
    queryKey: ipKeys.jobs(id),
    queryFn: () => fetchProjectJobs(id),
    enabled: !!id,
  });
}

// ─── Mutations ─────────────────────────────────────────

interface CreateProjectInput {
  name: string;
  typeId: string | number;
  description?: string;
  background?: string;
  bannerLink?: string;
  contact?: string;
  tag?: string;
}

async function createProject(input: CreateProjectInput): Promise<{ id: number }> {
  const body: Record<string, unknown> = {
    name: input.name,
    typeId: Number(input.typeId),
  };
  if (input.description) body.description = input.description;
  if (input.background) body.background = input.background;
  if (input.bannerLink) body.bannerLink = input.bannerLink;
  if (input.contact) body.contact = input.contact;
  if (input.tag) body.tag = input.tag;
  // Java's /project/create returns `{ code, msg, id }` (id at top level,
  // not inside `data`), so it doesn't fit the standard ApiEnvelope shape
  // postJson's unwrap expects. Inline the fetch to read id directly.
  const res = await fetch("/project/create", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { code?: number; msg?: string; id?: number };
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || "Create failed");
  }
  if (!json.id) throw new Error("Backend returned no project id");
  return { id: json.id };
}

interface UpdateProjectInput {
  id: number | string;
  name?: string;
  typeId?: string | number;
  description?: string;
  background?: string;
  bannerLink?: string;
  contact?: string;
  tag?: string;
  projectStatus?: number;
}

async function updateProject(input: UpdateProjectInput): Promise<unknown> {
  const body = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, String(v ?? "")]));
  return postForm("/project/update", body);
}

async function uploadProjectVideo({
  projectId,
  file,
}: {
  projectId: string;
  file: File;
}): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("projectId", projectId);
  const res = await fetch("/content/project/upload/project/video/backup", {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
  const json = (await res.json()) as { code?: number; msg?: string; data?: string; path?: string };
  if (json.code !== 200) throw new Error(json.msg || "Upload failed");
  return json.data ?? json.path ?? "";
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      // No specific detail key to invalidate yet (the new project's id
      // wasn't in cache); blow away the list so the new row shows up
      // when the user navigates back to /ips.
      queryClient.invalidateQueries({ queryKey: ["ip", "projects"] });
    },
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
    mutationFn: uploadProjectVideo,
    onSuccess: (_data, variables) => {
      // Invalidate the project detail too — `useProjectVideoLink` is
      // gated on `project.videoLink` being truthy, so without a detail
      // refetch a first-time upload leaves the getLink query disabled
      // and the just-uploaded video never resolves to a playable URL.
      queryClient.invalidateQueries({ queryKey: ipKeys.detail(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: ipKeys.video(variables.projectId) });
    },
  });
}
