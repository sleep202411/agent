/**
 * Creators / talent-market service — transport-level wrapper around
 * `/user/list/user/info` (Java Content). The list payload powers the
 * `/creators` page; detail / interaction endpoints don't exist yet.
 */

import { api } from "@/src/lib/api";

/**
 * Per-row info block as returned by `/user/list/user/info`. Mirrors the
 * shared `UserInfo` shape but kept permissive — backend may add or drop
 * fields without us crashing the page. Mapping into the feature-private
 * `Creator` type lives in the creators hook.
 */
export interface CreatorInfo {
  id: number | string;
  nickName?: string | null;
  name?: string | null;
  contact?: string | null;
  avatar?: string | null;
  description?: string | null;
  createTime?: string | null;
  other?: string | null;
  jobseeking?: number | boolean | null;
  study?: string | null;
  [key: string]: unknown;
}

/** Certification level entry attached to each row. */
export interface CreatorLevelEntry {
  id: number;
  name: string;
  description?: string;
  imagePath?: string;
  type?: number;
  remark?: string | null;
  content?: string;
  [key: string]: unknown;
}

/** Outer row shape: `{ level: [...], info: { ... } }`. */
export interface CreatorRow {
  level: CreatorLevelEntry[];
  info: CreatorInfo;
}

interface CreatorListPayload {
  page?: number;
  pageSize?: number;
}

/**
 * List users for the talent market. Backend expects
 * `application/x-www-form-urlencoded`, not JSON.
 */
export const listCreators = (params: CreatorListPayload = {}) => {
  const form: Record<string, string> = {};
  if (params.page !== undefined) form.page = String(params.page);
  if (params.pageSize !== undefined) form.pageSize = String(params.pageSize);
  return api.postForm<CreatorRow[]>("/user/list/user/info", form);
};

/**
 * Fetch a single creator's basic info + level set, scoped by `userId`.
 * Used by the detail page so deep links work without depending on the
 * list cache. Returns the same `{ level, info }` row shape as the list
 * endpoint.
 *
 * Backend signature: `POST /user/other/user/info` with
 * `application/x-www-form-urlencoded` body (`userId=<id>`).
 */
export const getCreatorBasicInfo = (userId: number | string) =>
  api.postForm<CreatorRow>("/user/other/user/info", {
    userId: String(userId),
  });
