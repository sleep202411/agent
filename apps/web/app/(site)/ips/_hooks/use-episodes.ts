/**
 * Episode CRUD + list (P0).
 *
 *   - `useProjectEpisodes`   — GET /vedio/project/episode/list
 *   - `useCreateEpisode`     — POST /vedio/add/project/episode
 *   - `useUpdateEpisode`     — POST /vedio/project/episode/update
 *   - `useDeleteEpisode`     — POST /project/episode/delete
 *   - `useReorderEpisode`    — POST /project/episode/reorder
 *
 * Backend hasn't shipped these yet — fetch will surface real errors;
 * UI components should render an empty / disabled state on failure
 * rather than masking with mock data.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { acceptLanguage, bearerHeader, ipKeys } from "./shared";
import type { Episode, CreateEpisodeInput, UpdateEpisodeInput } from "./types";

async function fetchEpisodes(projectId: string): Promise<Episode[]> {
  const res = await fetch(
    `/vedio/project/episode/list?projectId=${encodeURIComponent(projectId)}`,
    {
      credentials: "include",
      headers: { "accept-language": acceptLanguage(), Authorization: bearerHeader() },
    }
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { code: number; data: { list: Episode[] } | Episode[] };
  if (Array.isArray(json.data)) return json.data;
  return json.data?.list ?? [];
}

export function useProjectEpisodes(id: string) {
  return useQuery<Episode[]>({
    queryKey: ipKeys.episodes(id),
    queryFn: () => fetchEpisodes(id),
    enabled: !!id,
    staleTime: 1000 * 60,
  });
}

async function createEpisode(input: CreateEpisodeInput): Promise<Episode> {
  // Wire shape diverges from the UI-facing input: backend renames
  // description → introduction, videoUrl → videoLink, cover → videoBanner,
  // sort → videoNumber, and stringifies videoMeta. tags / other /
  // viewStatus / sort itself are unused — backend defaults them.
  const body = {
    projectId: Number(input.projectId),
    title: input.title,
    introduction: input.description,
    videoBanner: input.cover,
    videoLink: input.videoUrl,
    videoNumber: input.sort ?? 0,
    videometa: input.videoMeta ? JSON.stringify(input.videoMeta) : "",
  };
  const res = await fetch("/vedio/add/project/episode", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Create episode failed: HTTP ${res.status}`);
  }
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
  // README still spells this `/vedio/project/episode/update` (the typo'd
  // legacy controller); other episode endpoints have been moved to
  // `/project/episode/*`. Honour the README until backend confirms the
  // unified path.
  const res = await fetch("/vedio/project/episode/update", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify(input),
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
  const res = await fetch("/project/episode/delete", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify({ id: input.id }),
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
  /** id of the episode being moved. */
  currentVideoId: string;
  /** id of the episode it should land before. Omit to move to the end. */
  beforeVideoId?: string;
  /** Used only for cache invalidation; not part of the backend payload. */
  projectId: string;
}

async function reorderEpisode(input: ReorderEpisodeInput): Promise<void> {
  const res = await fetch("/project/episode/reorder", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify({
      currentVideoId: input.currentVideoId,
      beforeVideoId: input.beforeVideoId,
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
