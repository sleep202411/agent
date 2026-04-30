/**
 * Personal-video publish data layer. Mirrors the legacy
 * `pages/publicVideo/publicVideoPC.vue` flow but only the personal
 * branch — team-video is intentionally out of scope.
 *
 *   GET  /vedio/type/tag/list             — { all: { typeId: catName }, map: { catName: { tagId: name } } }
 *   POST /vedio/create/personal/video     — { title, introduction, tags, viewStatus } → id
 *   POST /vedio/update/personal/video     — { id, title, introduction, tags, viewStatus }
 *   POST /content/vedio/upload/personal/video/backup  — multipart { id, file }
 *   POST /content/personal/uploadBanner               — multipart { id, file }
 *
 * Pre-resolved helpers in `@/src/services/project.ts` are reused
 * for create / update / upload-video. Tag fetch + banner upload are
 * feature-local because no other surface needs them yet.
 */

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, notifyUnauthorized } from "@/src/lib/api";
import {
  createPersonalWork,
  updatePersonalWork,
  uploadPersonalVideo,
} from "@/src/services/project";

export interface Tag {
  id: number;
  name: string;
  /** Category name the tag came from (e.g. "情感", "悬疑"). */
  category: string;
}

/**
 * Raw shape of `/vedio/type/tag/list`. The whole envelope (no `data`
 * field) is returned, so api-client passes the full body through.
 *
 *   all: { [typeId]: categoryName }              — typeId → category label
 *   map: { [categoryName]: { [tagId]: name } }   — category → its tags
 */
interface RawTagListResponse {
  all?: Record<string, string>;
  map?: Record<string, Record<string, string>>;
}

const tagKeys = {
  list: ["publish", "tags"] as const,
};

/**
 * Returns a flat list of every tag across every category. Personal
 * videos don't filter by project type — the legacy page mirrored
 * this same flatten when `videoType === 'personal'`.
 */
export function useTagList() {
  return useQuery({
    queryKey: tagKeys.list,
    queryFn: async () => {
      const data = await api.get<RawTagListResponse>("/vedio/type/tag/list");
      const tags: Tag[] = [];
      for (const [category, group] of Object.entries(data?.map ?? {})) {
        for (const [idStr, name] of Object.entries(group ?? {})) {
          tags.push({ id: Number(idStr), name, category });
        }
      }
      return tags;
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useCreatePersonalVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPersonalWork,
    onSuccess: () => {
      // Profile's "Personal Works" tab queries this list; refresh after
      // a new upload lands so it appears without a manual reload.
      qc.invalidateQueries({ queryKey: ["my-personal-works"] });
    },
  });
}

export function useUpdatePersonalVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updatePersonalWork,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-personal-works"] });
    },
  });
}

/**
 * Multipart upload for the actual video file. Bypasses api-client
 * (multipart + 5GB cap + AbortController) so we hand-roll the 401
 * fallthrough — calling notifyUnauthorized on a 401 keeps the global
 * AuthInterceptor in sync with token expiry mid-upload.
 */
export interface UploadVideoArgs {
  personalId: number;
  file: File;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}

export function useUploadPersonalVideoFile() {
  return useMutation({
    mutationFn: async ({ personalId, file, signal, onProgress }: UploadVideoArgs) => {
      void onProgress; // reserved — XHR path can wire it; fetch can't easily
      void signal;
      try {
        return await uploadPersonalVideo(personalId, file);
      } catch (err) {
        const msg = String((err as Error)?.message ?? "");
        if (msg.includes("401")) notifyUnauthorized();
        throw err;
      }
    },
  });
}

/**
 * Cover image upload for an existing personal video record. Multipart
 * to /content/personal/uploadBanner (legacy parity).
 */
export interface UploadCoverArgs {
  personalId: number;
  file: File;
}

export function useUploadPersonalCover() {
  return useMutation({
    mutationFn: async ({ personalId, file }: UploadCoverArgs) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("id", String(personalId));

      const res = await fetch("/content/personal/uploadBanner", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (res.status === 401) notifyUnauthorized();

      const body = (await res.json()) as { code?: number; msg?: string; data?: string };
      if (body.code !== 200) throw new Error(body.msg || "Cover upload failed");
      return body.data ?? "";
    },
  });
}

/** Convenience: max number of tags a user can pick. Mirrors legacy. */
export const MAX_TAGS = 5;

/** All keys in one place so a future "publish drafts" feature can invalidate. */
export const publishKeys = {
  tags: tagKeys.list,
};

/** Re-export for callers that want the raw flat tag list utility. */
export type { RawTagListResponse };

/** Stable memo helper so consumers can sort once instead of every render. */
export function useSortedTags() {
  const { data, ...rest } = useTagList();
  const sorted = useMemo(
    () => [...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data]
  );
  return { tags: sorted, ...rest };
}
