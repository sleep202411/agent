/**
 * Episode CRUD + list (P0).
 *
 *   - `useProjectEpisodes`   — list (still stub until backend ships)
 *   - `useCreateEpisode`     — POST /project/episode/create
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

// TODO: backend endpoint not implemented yet — see ips/README.md.
// When `GET /vedio/project/episode/list?projectId=xxx` lands, swap the
// queryFn to a real fetcher and remove the empty-array stub.
export function useProjectEpisodes(id: string) {
  return useQuery<Episode[]>({
    queryKey: ipKeys.episodes(id),
    queryFn: async () => [],
    enabled: !!id,
    staleTime: 1000 * 60,
  });
}

async function createEpisode(input: CreateEpisodeInput): Promise<Episode> {
  const res = await fetch("/project/episode/create", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify(input),
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
