/**
 * Personal-video publish data layer. Mirrors the legacy
 * `pages/publicVideo/publicVideoPC.vue` flow but only the personal
 * branch — team-video is intentionally out of scope.
 *
 *   POST /vedio/create/personal/video     — { title, introduction, tags, viewStatus } → id
 *   POST /vedio/update/personal/video     — { id, title, introduction, tags, viewStatus }
 *   POST /content/vedio/upload/personal/video/backup  — multipart { id, file }
 *   POST /content/vedio/personal/uploadBanner               — multipart { id, file } → { path }
 *
 * Pre-resolved helpers in `@/src/services/project.ts` are reused
 * for create / update / upload-video. The tag-list reader (used by
 * both this page and the IP plaza filter chips) lives in shared
 * `src/hooks/use-tag-list` so both surfaces hit the same React Query
 * cache.
 */

import { useMutation } from "@tanstack/react-query";
import { notifyUnauthorized } from "@/src/lib/api";
import { uploadPersonalVideo } from "@/src/services/project";

export { useTagList, tagListKeys, type Tag } from "@/src/hooks/use-tag-list";

export {
  useCreatePersonalWork as useCreatePersonalVideo,
  useUpdatePersonalWork as useUpdatePersonalVideo,
} from "@/src/hooks/use-my-projects";

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
      signal?.throwIfAborted();
      try {
        return await uploadPersonalVideo(personalId, file, signal);
      } catch (err) {
        const msg = String((err as Error)?.message ?? "");
        if (!signal?.aborted && msg === "Upload failed: HTTP 401") notifyUnauthorized();
        throw err;
      }
    },
  });
}

/**
 * Cover image upload for an existing personal video record. Multipart
 * to /content/vedio/personal/uploadBanner (yes, "vedio" — Java's
 * spelling). Response shape is `{ code, msg, path }` where `path` is
 * the OSS-relative key (e.g. `2259/personal/<uuid>.jpg`); the legacy
 * `data` field was an earlier guess that never matched.
 */
export interface UploadCoverArgs {
  personalId: number;
  file: File;
  signal?: AbortSignal;
}

export function useUploadPersonalCover() {
  return useMutation({
    mutationFn: async ({ personalId, file, signal }: UploadCoverArgs) => {
      signal?.throwIfAborted();
      const formData = new FormData();
      formData.append("file", file);
      formData.append("id", String(personalId));

      const res = await fetch("/content/vedio/personal/uploadBanner", {
        method: "POST",
        credentials: "include",
        body: formData,
        signal,
      });

      signal?.throwIfAborted();
      if (res.status === 401) notifyUnauthorized();
      if (!res.ok) throw new Error(`Cover upload failed: HTTP ${res.status}`);

      const body = (await res.json()) as { code?: number; msg?: string; path?: string };
      signal?.throwIfAborted();
      if (body.code !== 200) throw new Error(body.msg || "Cover upload failed");
      return body.path ?? "";
    },
  });
}

/** Convenience: max number of tags a user can pick. Mirrors legacy. */
export const MAX_TAGS = 5;
