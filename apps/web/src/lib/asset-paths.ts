/**
 * Shared OSS path helpers + role column IDs. Used by the project feature and by
 * cross-feature utilities (e.g. ai-fusion-queue) that don't want to reach into
 * project-private code.
 */

import { env } from "@/src/env";

const OSS_BASE = env.OSS_BASE_URL;

export const ROLE_RECORD_COLUMN_ID = -1;
export const ROLE_FUSION_COLUMN_ID = -6;
export const ROLE_THREE_VIEW_COLUMN_ID = -11;

export function ossUrl(path?: string | null) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return `${OSS_BASE}/${path}`;
}

export function normalizeStoragePath(path?: string | null) {
  const raw = String(path ?? "").trim();
  if (!raw) return "";
  const prefix = `${OSS_BASE}/`;
  if (raw.startsWith(prefix)) {
    return raw.slice(prefix.length);
  }
  return raw;
}
