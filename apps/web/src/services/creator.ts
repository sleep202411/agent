/**
 * Creators / talent-market service — transport-level wrapper around
 * `/user/list/user/info` (Java Content). The list payload powers the
 * `/creators` page; detail / interaction endpoints don't exist yet.
 */

import { api } from "@/src/lib/api";
import { defaultLocale, locales, type Locale } from "@/src/i18n/config";

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

function getAcceptLanguage(): Locale {
  if (typeof document !== "undefined") {
    const htmlLang = document.documentElement.lang;
    if (htmlLang && locales.includes(htmlLang as Locale)) return htmlLang as Locale;
  }
  return defaultLocale;
}

/**
 * List users for the talent market. Backend expects
 * `application/x-www-form-urlencoded`, not JSON, and returns the page
 * data in `body.data` plus the total row count in `body.sum`. The
 * shared api client only surfaces `body.data`, so this call drops down
 * to raw `fetch` to keep `sum` for pagination.
 */
export async function listCreators(params: CreatorListPayload = {}): Promise<CreatorListResult> {
  const form = new URLSearchParams();
  if (params.page !== undefined) form.append("page", String(params.page));
  if (params.pageSize !== undefined) form.append("pageSize", String(params.pageSize));
  const res = await fetch("/user/list/user/info", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "accept-language": getAcceptLanguage(),
    },
    body: form.toString(),
  });
  if (!res.ok) return { list: [], total: 0 };
  const body = (await res.json()) as { data?: CreatorRow[]; sum?: number };
  return { list: Array.isArray(body.data) ? body.data : [], total: body.sum ?? 0 };
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
