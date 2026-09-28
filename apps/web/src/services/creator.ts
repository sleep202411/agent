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
  /** Cover/banner image — relative path resolved against
   *  `NEXT_PUBLIC_BANNER_BASE_URL`. */
  banner?: string | null;
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

export interface CreatorListResult {
  list: CreatorRow[];
  total: number;
}

/**
 * List users for the talent market. Backend expects
 * `application/x-www-form-urlencoded`, not JSON, and returns the page
 * data in `body.data` plus the total row count in `body.sum`. The
 * shared API client uses raw mode to retain `sum` for pagination while
 * still rejecting HTTP and business-envelope errors.
 */
export async function listCreators(params: CreatorListPayload = {}): Promise<CreatorListResult> {
  const body = await api.post<{ data?: CreatorRow[]; sum?: number }>("/user/list/user/info", {
    form: { page: params.page, pageSize: params.pageSize },
    raw: true,
  });
  return { list: Array.isArray(body.data) ? body.data : [], total: body.sum ?? 0 };
}

/**
 * Search users for the talent market by free-text `key` (matches name /
 * nickname server-side). Backend signature: `POST /user/search/users`
 * (`queryOtherUserInfo`) with `key` / `page` / `pageSize` as query params
 * (Spring `@RequestParam`), no body. Same `{ data, sum }` envelope as the
 * list endpoint, so we use raw API mode to keep `sum` for pagination —
 * mirroring `listCreators`. Rows map through the same `toCreator`, which
 * tolerates both `{ level, info }` and flat-info shapes.
 */
export async function searchCreators(params: {
  key: string;
  page?: number;
  pageSize?: number;
}): Promise<CreatorListResult> {
  const body = await api.post<{ data?: CreatorRow[]; sum?: number; total?: number }>(
    "/user/search/users",
    { params, raw: true }
  );
  const list = Array.isArray(body.data) ? body.data : [];
  return { list, total: body.sum ?? body.total ?? list.length };
}

/**
 * Fetch a single creator's basic info + level set, scoped by `userId`.
 * Used by the detail page so deep links work without depending on the
 * list cache. Returns the same `{ level, info }` row shape as the list
 * endpoint.
 *
 * Backend signature: `POST /user/other/user/info?UserId=<id>` — Spring
 * `@RequestParam`, so the field goes in the query string (capital I)
 * with no request body. Uses `raw: true` because the response envelope
 * carries BOTH `info` and `level` at the top level; the default api
 * unwrap (`body.data ?? body.info ?? …`) would silently discard the
 * `level` array, leaving creator pages without their cert chips.
 */
export const getCreatorBasicInfo = async (userId: number | string): Promise<CreatorRow> => {
  const envelope = await api.post<{
    info?: CreatorInfo;
    level?: CreatorLevelEntry[];
  }>("/user/other/user/info", {
    params: { UserId: String(userId) },
    raw: true,
  });
  return {
    info: envelope?.info ?? ({} as CreatorInfo),
    level: Array.isArray(envelope?.level) ? envelope.level : [],
  };
};
