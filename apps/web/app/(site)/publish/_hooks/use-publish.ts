/**
 * Personal-video publish data layer. Mirrors the legacy
 * `pages/publicVideo/publicVideoPC.vue` flow but only the personal
 * branch — team-video is intentionally out of scope.
 *
 *   POST /vedio/create/personal/video     — { title, introduction, tags, viewStatus } → id
 *   POST /vedio/update/personal/video     — { id, title, introduction, tags, viewStatus }
 *   POST /content/vedio/upload/personal/video/backup  — multipart { id, file }
 *   POST /content/personal/uploadBanner               — multipart { id, file }
 *
 * Pre-resolved helpers in `@/src/services/project.ts` are reused
 * for create / update / upload-video. The tag-list reader (used by
 * both this page and the IP plaza filter chips) lives in shared
 * `src/hooks/use-tag-list` so both surfaces hit the same React Query
 * cache.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifyUnauthorized } from "@/src/lib/api";
import {
  createPersonalWork,
  updatePersonalWork,
  uploadPersonalVideo,
} from "@/src/services/project";

export { useTagList, tagListKeys, type Tag } from "@/src/hooks/use-tag-list";

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
