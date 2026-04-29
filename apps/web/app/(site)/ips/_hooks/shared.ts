/**
 * IP feature data layer — shared helpers + cache keys + URL helpers.
 *
 * The IP feature is self-contained: types, fetchers, and React Query
 * hooks for every IP-private concern live in this `_hooks/` folder.
 * Routes import only from `_hooks/use-ip` (re-export shim) or sibling
 * `_data/_components/`, never from `src/hooks/*` or `src/services/*`.
 *
 * ## What lives here vs. what stays in `src/`
 *
 *   - **Feature-private data** (IP listing, categories, tags, project
 *     detail/members/jobs/episodes/faqs/plaza as consumed *by the IP
 *     UI*) → lives in this `_hooks/` folder.
 *   - **App-level shared infrastructure** (auth, current user, generic
 *     API client, env config) → stays in `src/services/` and
 *     `src/hooks/`. The IP feature imports those unchanged.
 *   - **Service functions reused across multiple features**
 *     (e.g. `updateProject` is also called by `(site)/profile`) → stay
 *     in `src/services/project.ts`. Only the React-Query *hook
 *     wrappers* live here, so the IP feature owns its caching keys
 *     and invalidation rules without duplicating the transport layer.
 *
 * ## When to add to this folder
 *
 * Anything the IP feature uses that no other feature should depend on.
 * If a second feature later needs the same data, that's a real signal —
 * promote the hook to `src/hooks/` at that point, don't try to predict
 * sharing in advance.
 */

import { env } from "@/src/env";

// ─── Header helpers ─────────────────────────────────
//
// `credentials: "include"` is required so the SaToken auth cookie rides
// along; without it the backend can't identify the user and 500s on the
// missing context. `accept-language` is required for the i18n layer.

export function acceptLanguage(): string {
  if (typeof document !== "undefined") {
    const htmlLang = document.documentElement.lang;
    if (htmlLang) return htmlLang;
  }
  return "en-US";
}

// Read the SaToken from cookie if present. Backend requires the
// `Authorization: Bearer <token>` header even when the token is empty
// (legacy fizzdragon-web always sends `Bearer ${token || ''}`); without
// the header at all the backend NPEs with a 500.
export function bearerHeader(): string {
  if (typeof document === "undefined") return "Bearer ";
  const match = document.cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
  return `Bearer ${match?.[1] ?? ""}`;
}

// ─── Query keys ─────────────────────────────────────

export const ipKeys = {
  all: ["ip"] as const,
  projects: (filter: {
    page: number;
    pageSize: number;
    key: string;
    typeId: string;
    tag: string;
  }) => ["ip", "projects", filter] as const,
  list: (filter: { page: number; pageSize: number; key: string; typeId: string; tag: string }) =>
    ["ip", "list", filter] as const,
  categories: ["ip", "categories"] as const,
  types: ["ip", "types"] as const,
  tags: ["ip", "tags"] as const,
  tagList: ["ip", "tagList"] as const,
  detail: (id: string) => ["ip", "detail", id] as const,
  video: (id: string) => ["ip", "video", id] as const,
  members: (id: string) => ["ip", "members", id] as const,
  jobs: (id: string) => ["ip", "jobs", id] as const,
  episodes: (id: string) => ["ip", "episodes", id] as const,
  faqs: (id: string) => ["ip", "faqs", id] as const,
  plazaFeatured: ["ip", "plaza", "featured"] as const,
  plazaForYou: (page: number, pageSize: number) =>
    ["ip", "plaza", "for-you", page, pageSize] as const,
};

// ─── Image URL helpers ──────────────────────────────

/** Convert a relative image path to a full banner OSS URL. */
export function ipImageUrl(path?: string | null): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${env.BANNER_BASE_URL}/${path}`;
}

/** Convert a relative user-avatar path to a full URL. User avatars live on
 *  a different OSS bucket than IP banners (USER_BASE_URL, e.g.
 *  avatar.fizzspace.cn for the CN deploy), so they need a separate helper. */
export function userAvatarUrl(path?: string | null): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = env.USER_BASE_URL || env.OSS_BASE_URL;
  if (!base) return "";
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  return `${base.replace(/\/+$/, "")}/${trimmed}`;
}
