/**
 * Episode CRUD + list + per-episode play link.
 *
 *   - `useProjectEpisodes`     — POST /vedio/video/list  (queryProjectVideo)
 *   - `useEpisodeVideoLink`    — POST /vedio/play/getLink (per-episode playable URL)
 *   - `useCreateEpisode`       — POST /vedio/add/project/episode
 *   - `useUpdateEpisode`       — POST /vedio/upload/project/episode
 *   - `useDeleteEpisode`       — POST /vedio/delete/project/episode
 *   - `useReorderEpisode`      — POST /vedio/sort/project/episode
 *
 * `/vedio/upload/project/episode` is misleadingly named — backend's
 * controller method is `uploadProjectVideo`, but the body shape (id +
 * projectId + introduction + title + videoBanner + videoLink + …)
 * makes it an **update** call, not a multipart file upload. Actual
 * file uploads run through the IP-feature-private uploaders in
 * `_hooks/uploads.ts`; the resulting OSS paths are passed in as
 * `videoLink` / `videoBanner`.
 *
 * **Wire `videoLink` is NOT a direct OSS path.** Legacy fizzdragon-web
 * always fetches the playable URL through `/vedio/play/getLink` keyed
 * by episode id (parallel to the trailer's `/vedio/play/project/getLink`).
 * We mirror that here: the list fetcher only carries the id forward as
 * `videoUrl` is left as a "has video" boolean, and call sites that need
 * to actually play call `useEpisodeVideoLink(id)` to resolve the URL.
 *
 * `videoBanner` IS a relative OSS image key (e.g. `14/project/foo.jpg`)
 * and is concat'd at the fetcher boundary via `ipImageUrl`.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { acceptLanguage, bearerHeader, ipKeys, postForm } from "./shared";
import type { Episode, CreateEpisodeInput, UpdateEpisodeInput } from "./types";

interface WireEpisode {
  id: number | null;
  projectId: number | null;
  title: string | null;
  introduction: string | null;
  videoLink: string | null;
  videoBanner: string | null;
  videoNumber: number | null;
  videometa: string | null;
  createTime: string | null;
}

function mapWireEpisode(w: WireEpisode): Episode {
  let durationFromMeta = 0;
  if (w.videometa) {
    try {
      const meta = JSON.parse(w.videometa) as { duration?: number };
      if (typeof meta.duration === "number") durationFromMeta = meta.duration;
    } catch {
      // ignore — backend may return a non-JSON string
    }
  }
  return {
    id: w.id != null ? String(w.id) : "",
    projectId: w.projectId != null ? String(w.projectId) : "",
    title: w.title ?? "",
    description: w.introduction ?? "",
    videoLink: w.videoLink ?? "",
    videoBanner: w.videoBanner ?? "",
    duration: durationFromMeta,
    videoNumber: w.videoNumber ?? 0,
    createdAt: w.createTime ?? undefined,
  };
}

async function fetchEpisodes(projectId: string): Promise<Episode[]> {
  // Backend takes `projectId` as a query-string param (Swagger §queryProjectVideo).
  const qs = new URLSearchParams({ projectId: String(projectId) });
  const res = await fetch(`/vedio/video/list?${qs.toString()}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    code: number;
    data: WireEpisode[] | { list?: WireEpisode[] };
  };
  const rows = Array.isArray(json.data) ? json.data : (json.data?.list ?? []);
  return rows.map(mapWireEpisode);
}

export function useProjectEpisodes(id: string) {
  return useQuery<Episode[]>({
    queryKey: ipKeys.episodes(id),
    queryFn: () => fetchEpisodes(id),
    enabled: !!id,
    staleTime: 1000 * 60,
  });
}

// ─── Episode play link ─────────────────────────────────
//
// Mirrors the trailer's `useProjectVideoLink`. Backend resolves the
// internal `videoLink` OSS key into a directly-playable URL (signed or
// public depending on bucket policy). Only fetch when actually needed
// (dialog open in edit mode, full-screen episode viewer) — never on
// list render or hover, since each call hits the backend.

async function fetchEpisodeVideoLink(episodeId: string): Promise<string> {
  return postForm<string>("/vedio/play/getLink", { id: episodeId });
}

export function useEpisodeVideoLink(episodeId: string, enabled: boolean = true) {
  return useQuery<string>({
    queryKey: ipKeys.episodeVideo(episodeId),
    queryFn: () => fetchEpisodeVideoLink(episodeId),
    enabled: !!episodeId && enabled,
    staleTime: 1000 * 60 * 5,
  });
}

// Wire shape diverges from the UI-facing input only on `description` →
// `introduction` and `videoMeta` → `videometa` (stringified). Everything
// else uses wire names. tags / other / viewStatus / sort are unused —
// backend defaults them.
function toWireBody(input: CreateEpisodeInput | UpdateEpisodeInput) {
  return {
    projectId: Number(input.projectId),
    title: input.title,
    introduction: input.description,
    videoBanner: input.videoBanner,
    videoLink: input.videoLink,
    videoNumber: input.videoNumber ?? 0,
    videometa: input.videoMeta ? JSON.stringify(input.videoMeta) : "",
  };
}

async function createEpisode(input: CreateEpisodeInput): Promise<Episode> {
  const res = await fetch("/vedio/add/project/episode", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify(toWireBody(input)),
  });
  if (!res.ok) throw new Error(`Create episode failed: HTTP ${res.status}`);
  const json = (await res.json()) as { code: number; msg?: string; data: Episode };
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || "Create episode failed");
  }
  return json.data;
}

export function useCreateEpisode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createEpisode,
    onSuccess: (_episode, variables) => {
      queryClient.invalidateQueries({ queryKey: ipKeys.episodes(variables.projectId) });
    },
  });
}

async function updateEpisode(input: UpdateEpisodeInput): Promise<Episode> {
  const res = await fetch("/vedio/upload/project/episode", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify({ id: Number(input.id), ...toWireBody(input) }),
  });
  if (!res.ok) throw new Error(`Update episode failed: HTTP ${res.status}`);
  const json = (await res.json()) as { code: number; msg?: string; data: Episode };
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || "Update episode failed");
  }
  return json.data;
}

export function useUpdateEpisode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateEpisode,
    onSuccess: (_episode, variables) => {
      queryClient.invalidateQueries({ queryKey: ipKeys.episodes(variables.projectId) });
    },
  });
}

async function deleteEpisode(input: { id: string; projectId: string }): Promise<void> {
  const res = await fetch("/vedio/delete/project/episode", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify({ id: Number(input.id) }),
  });
  if (!res.ok) throw new Error(`Delete episode failed: HTTP ${res.status}`);
  const json = (await res.json()) as { code: number; msg?: string };
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || "Delete episode failed");
  }
}

export function useDeleteEpisode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteEpisode,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ipKeys.episodes(variables.projectId) });
    },
  });
}

interface ReorderEpisodeInput {
  /** id of the episode being moved. Sent to backend as `videoId`. */
  currentVideoId: string;
  /** id of the episode it should land before. Omit to move to the end. */
  beforeVideoId?: string;
  /** IP project id — REQUIRED by the backend (also used locally for
   *  React Query cache invalidation in the mutation `onSuccess`). */
  projectId: string;
}

async function reorderEpisode(input: ReorderEpisodeInput): Promise<void> {
  // Wire contract per Swagger `POST /vedio/sort/project/episode`:
  //   { beforeVideoId, projectId, videoId }
  // (Earlier code sent `currentVideoId` and omitted `projectId` —
  // wrong field name + missing required field. Now corrected.)
  const res = await fetch("/vedio/sort/project/episode", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify({
      videoId: input.currentVideoId,
      beforeVideoId: input.beforeVideoId ?? 0,
      projectId: input.projectId,
    }),
  });
  if (!res.ok) throw new Error(`Reorder episode failed: HTTP ${res.status}`);
  const json = (await res.json()) as { code: number; msg?: string };
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || "Reorder episode failed");
  }
}

export function useReorderEpisode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reorderEpisode,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ipKeys.episodes(variables.projectId) });
    },
  });
}
