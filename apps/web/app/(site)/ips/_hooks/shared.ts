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

// ─── Fetch helpers (feature-private) ────────────────
//
// Java endpoints accept either form-encoded bodies (most legacy
// controllers) or JSON bodies. These two helpers let the IP fetchers
// stay terse without depending on `src/lib/api`. Each unwraps the
// `{code, msg, data}` envelope and surfaces a real Error on failure
// so React Query reports `isError`.

export interface ApiEnvelope<T> {
  code: number;
  msg?: string;
  data?: T;
}

function commonHeaders(): Record<string, string> {
  return {
    "accept-language": acceptLanguage(),
    Authorization: bearerHeader(),
  };
}

function unwrap<T>(json: ApiEnvelope<T>, fallbackErr: string): T {
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || fallbackErr);
  }
  return json.data as T;
}

export async function postForm<T>(path: string, data: Record<string, string>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      ...commonHeaders(),
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: new URLSearchParams(data).toString(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return unwrap<T>(await res.json(), `POST ${path} failed`);
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { ...commonHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return unwrap<T>(await res.json(), `POST ${path} failed`);
}

// ─── Query keys ─────────────────────────────────────

export const ipKeys = {
  all: ["ip"] as const,
  list: (filter: { page: number; pageSize: number; key: string; typeId: string; tag: string }) =>
    ["ip", "list", filter] as const,
  types: ["ip", "types"] as const,
  tagList: ["ip", "tagList"] as const,
  detail: (id: string) => ["ip", "detail", id] as const,
  video: (id: string) => ["ip", "video", id] as const,
  members: (id: string) => ["ip", "members", id] as const,
  jobs: (id: string) => ["ip", "jobs", id] as const,
  legacyJobsByRole: (roleId: string) => ["ip", "legacy-jobs-by-role", roleId] as const,
  episodes: (id: string) => ["ip", "episodes", id] as const,
  episodeVideo: (episodeId: string) => ["ip", "episodeVideo", episodeId] as const,
  faqs: (id: string) => ["ip", "faqs", id] as const,
  plazaFeatured: ["ip", "plaza", "featured"] as const,
  plazaForYou: (page: number, pageSize: number) =>
    ["ip", "plaza", "for-you", page, pageSize] as const,
  pricing: (id: string) => ["ip", "pricing", id] as const,
  merchandise: (id: string) => ["ip", "merchandise", id] as const,
};

// ─── Image URL helpers ──────────────────────────────

/** Convert a relative image path to a full banner OSS URL. */
export function ipImageUrl(path?: string | null): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${env.BANNER_BASE_URL}/${path}`;
}

// ─── Legacy URL helpers ─────────────────────────────
//
// The new IP edit page (`/ips/[id]/edit`) isn't finished yet. Until it
// ships, every user-facing "edit IP" entry point in the platform should
// keep landing on the legacy fizzdragon-web edit page so we don't drop
// people into a half-built UI on production. Drop this helper (and the
// callers) once the new edit page is feature-complete.

export function legacyProjectEditUrl(projectId: string | number): string {
  const origin = env.PARENT_ORIGIN || (typeof window !== "undefined" ? window.location.origin : "");
  return `${origin}/pages/createProject/createProject?projectId=${projectId}`;
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

// ─── Misc utilities ─────────────────────────────────

/** Legacy: backend used to store tags as a single string (comma /
 *  pipe / semi-colon / space / Chinese-comma separated). Newer rows
 *  store `JSON.stringify([id, id])` instead — prefer `parseTagIds`
 *  + `resolveTagNames` for new code. This shim is kept for the
 *  homepage Featured / ForYou rails which haven't been migrated yet
 *  and accept whatever shape the backend hands back. */
export function splitTags(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(/[,|;、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3);
}

/** Backend stores `project.tag` as a JSON-stringified array of numeric
 *  tag IDs (e.g. `"[11,4]"`). Returns the parsed IDs or `[]` for any
 *  unparseable / empty value. Pair with `resolveTagNames` to surface
 *  human-readable labels. */
export function parseTagIds(raw: string | null | undefined): number[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

/** Translate tag IDs to display names against a `id → name` map (built
 *  from `useTagList()`). Unknown IDs fall through as `#${id}` so a
 *  stale cache or out-of-band tag never renders blank. */
export function resolveTagNames(
  ids: number[],
  tagMap: Map<number, string> | Record<number, string>
): string[] {
  const lookup = (id: number): string | undefined =>
    tagMap instanceof Map ? tagMap.get(id) : tagMap[id];
  return ids.map((id) => lookup(id) ?? `#${id}`);
}

/** Deterministic 32-bit string hash (FNV-ish). Plenty for picking
 *  bucketed values (avatar colors, mock fixtures) per id. */
export function hashId(id: number | string): number {
  const s = String(id);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
  }
  return Math.abs(h);
}

const AVATAR_COLORS = [
  "bg-amber-500/20 text-amber-300",
  "bg-rose-500/20 text-rose-300",
  "bg-violet-500/20 text-violet-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-sky-500/20 text-sky-300",
  "bg-fuchsia-500/20 text-fuchsia-300",
];

/** Stable color hash for an avatar fallback initial. */
export function avatarFallbackTone(seed: string | number | null | undefined): string {
  if (seed === null || seed === undefined) return AVATAR_COLORS[0];
  return AVATAR_COLORS[hashId(String(seed)) % AVATAR_COLORS.length];
}
