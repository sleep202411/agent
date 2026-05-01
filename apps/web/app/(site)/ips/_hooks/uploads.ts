/**
 * IP-feature-private file uploads — semantic helpers.
 *
 * Each public export names *what* the caller is uploading (an episode
 * video, an episode cover, an IP banner …), never *how*. The wire
 * detail (which backend endpoint, which `uploadType` flag, what body
 * shape) is encapsulated inside this file. When the backend ships
 * dedicated episode upload endpoints, only the internal `getXxxUrl`
 * helper bodies move — public signatures and call sites stay put.
 *
 * The two-step pipeline (request signed URL → PUT bytes to OSS) is
 * duplicated here on purpose, per the AGENTS.md rule: feature-private
 * wins over reaching into a shared `src/lib/uploads/*`. If a second
 * feature later needs a similar uploader, it should redefine its own
 * — duplication is cheaper than coupling our IP flow to a helper that
 * could evolve out from under us.
 */

import { acceptLanguage, bearerHeader } from "./shared";

interface SignedUrlResponse {
  url?: string;
  headers?: Record<string, string>;
  method?: string;
}

export interface UploadedAsset {
  /** OSS storage key, persists in DB. */
  path: string;
  name: string;
  size: number;
  mimeType: string;
}

// ─── Internal helpers ──────────────────────────────────

async function requestSignedUrl(
  endpoint: string,
  query: Record<string, string | number | undefined>
): Promise<SignedUrlResponse> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const url = qs.toString() ? `${endpoint}?${qs.toString()}` : endpoint;
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
  });
  if (!res.ok) throw new Error(`getUploadUrl failed: HTTP ${res.status}`);
  const json = (await res.json()) as {
    code?: number | string;
    msg?: string;
    message?: string;
    success?: boolean;
    data?: SignedUrlResponse;
  };
  // Envelope varies across endpoints: the IP banner endpoint returns
  // `{code: 200, msg, data}`; older Java endpoints return
  // `{success: true, code: "0", message, data}`. Accept either as OK.
  const codeNum = typeof json.code === "string" ? Number(json.code) : json.code;
  const ok = json.success === true || codeNum === 0 || codeNum === 200;
  if (!ok) {
    throw new Error(json.message || json.msg || "getUploadUrl failed");
  }
  return json.data ?? {};
}

function extractStoragePath(signedUrl: string): string {
  const url = new URL(signedUrl);
  // Pathname comes URL-encoded (`%20`, `%E2%80%A6`); decode so the key we
  // persist matches what the backend sees (`13/My Banner.png` vs.
  // `13/My%20Banner.png`). Wrap the decode so a malformed input doesn't
  // crash the upload.
  const raw = url.pathname.replace(/^\//, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function putBytesToOss(info: SignedUrlResponse, file: File): Promise<string> {
  if (!info.url) throw new Error("Upload URL missing");
  const res = await fetch(info.url, {
    method: info.method ?? "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      ...(info.headers ?? {}),
    },
    body: file,
  });
  if (!res.ok) throw new Error(`OSS upload failed: HTTP ${res.status}`);
  return extractStoragePath(info.url);
}

function composeResult(file: File, path: string): UploadedAsset {
  return { path, name: file.name, size: file.size, mimeType: file.type };
}

// ─── Public uploaders ──────────────────────────────────
//
// IP banner + episode video each have their own dedicated presigned-URL
// endpoint (`/vedio/getuploadurl/project/banner` / `…/project/video/`),
// both scoped to a project (and optionally an existing video) via query
// params. Episode cover still rides the legacy generic uploader.

interface UploadEpisodeVideoInput {
  /** Project this episode belongs to (required). */
  projectId: number | string;
  /** Existing episode/video id when re-uploading; omit on first upload. */
  videoId?: number | string;
}

/** Episode source video. */
export async function uploadEpisodeVideo(
  file: File,
  input: UploadEpisodeVideoInput
): Promise<UploadedAsset> {
  const info = await requestSignedUrl("/vedio/getuploadurl/project/video/", {
    fileName: file.name || `episode_video_${Date.now()}`,
    projectId: input.projectId,
    videoId: input.videoId,
  });
  const path = await putBytesToOss(info, file);
  return composeResult(file, path);
}

/** Episode cover / banner image. */
export async function uploadEpisodeCover(file: File): Promise<UploadedAsset> {
  // TODO: swap to `/vedio/episode/cover/getUploadUrl` (or whatever ships).
  const info = await requestSignedUrl("/api/user/file/getUploadUrl", {
    fileName: file.name || `episode_cover_${Date.now()}`,
    uploadType: "PROJECT",
  });
  const path = await putBytesToOss(info, file);
  return composeResult(file, path);
}

interface UploadIPBannerInput {
  /** Project this banner belongs to (required by backend). */
  projectId: number | string;
  /** Optional video id — when set, banner is scoped to that video
   *  (e.g., a specific episode cover) instead of the project hero. */
  videoId?: number | string;
}

/** IP-level banner (cover image used on the plaza card and detail hero). */
export async function uploadIPBanner(
  file: File,
  input: UploadIPBannerInput
): Promise<UploadedAsset> {
  const info = await requestSignedUrl("/vedio/getuploadurl/project/banner", {
    fileName: file.name || `ip_banner_${Date.now()}`,
    projectId: input.projectId,
    videoId: input.videoId,
  });
  const path = await putBytesToOss(info, file);
  return composeResult(file, path);
}
