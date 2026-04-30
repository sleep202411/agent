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
  body: Record<string, unknown>
): Promise<SignedUrlResponse> {
  const res = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`getUploadUrl failed: HTTP ${res.status}`);
  const json = (await res.json()) as { code?: number; msg?: string; data?: SignedUrlResponse };
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || "getUploadUrl failed");
  }
  return json.data ?? {};
}

function extractStoragePath(signedUrl: string): string {
  const url = new URL(signedUrl);
  return url.pathname.replace(/^\//, "");
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
// Backend dedicated endpoints for episode video / image are still
// pending. Until they ship, route everything through the generic
// `/api/user/file/getUploadUrl` with a per-asset `uploadType` tag.
// When the dedicated endpoints land, swap the URL inside the matching
// helper — call sites don't change.

/** Episode source video. */
export async function uploadEpisodeVideo(file: File): Promise<UploadedAsset> {
  // TODO: swap to `/vedio/episode/getUploadUrl` (or whatever backend ships).
  const info = await requestSignedUrl("/api/user/file/getUploadUrl", {
    fileName: file.name || `episode_video_${Date.now()}`,
    uploadType: "PROJECT",
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

/** IP-level banner (cover image used on the plaza card and detail hero). */
export async function uploadIPBanner(file: File): Promise<UploadedAsset> {
  const info = await requestSignedUrl("/api/user/file/getUploadUrl", {
    fileName: file.name || `ip_banner_${Date.now()}`,
    uploadType: "PROJECT",
  });
  const path = await putBytesToOss(info, file);
  return composeResult(file, path);
}
