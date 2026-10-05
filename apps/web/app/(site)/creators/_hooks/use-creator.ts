/**
 * Creators feature data layer.
 *
 * Backend currently exposes one endpoint:
 *   POST /user/list/user/info  → list users for the talent market
 *
 * Response shape: `Array<{ level: LevelEntry[]; info: CreatorInfo }>`.
 * Every field is treated as possibly null/undefined — backend rows are
 * incomplete in practice (nickName: "", description: null, level: []).
 *
 * `/api/creators/:id` (detail) and the social mutations (like / save /
 * invite / contact / community feed / cert levels / skill demand) are
 * not yet on the roadmap, so the UI only renders fields the list payload
 * actually carries: id, name, avatar, bio, joinedAt, level.
 */

"use client";

import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  listCreators,
  searchCreators,
  getCreatorBasicInfo,
  type CreatorListResult,
  type CreatorRow,
} from "@/src/services/creator";
import {
  getMyPersonalWorks,
  getUserPersonalWorks,
  getUserProjects,
  getUserJoinedProjects,
  type PersonalWork,
  type Project,
} from "@/src/services/project";
import { api } from "@/src/lib/api";
import { isCreatorQualification } from "@/src/services/creator-qualification";
import type { ExperienceEntry } from "@/app/(site)/profile/_hooks/use-profile-extras";
import { env } from "@/src/env";
import { useLocale } from "@/src/i18n/i18n";

export interface CreatorLevel {
  id: number;
  type?: number;
  name: string;
  /** Resolved icon URL (STATIC_BASE_URL + raw imagePath). Empty when
   *  the level has no badge image. */
  iconUrl: string;
  description: string;
}

export interface Creator {
  id: string;
  name: string;
  avatar: string;
  /** Resolved full URL for the cover/banner image, or empty string when
   *  the creator hasn't set one. Wire field is `banner`; we resolve here
   *  so the header component can render `<img src={banner}>` directly. */
  banner: string;
  bio: string;
  joinedAt: string;
  levels: CreatorLevel[];
  contact: string;
  /** Raw `study` JSON string from the backend — parse with
   *  `parseEducation()` from `@/src/services/user` at render time. */
  study: string;
}

function safeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * User avatars live on a different OSS bucket than studio assets, so they
 * resolve via `NEXT_PUBLIC_USER_BASE_URL` (with `OSS_BASE_URL` as fallback).
 * Already-absolute URLs pass through unchanged.
 */
function buildAvatarUrl(path: string): string {
  if (!path) return "";
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  const base = env.USER_BASE_URL || env.OSS_BASE_URL;
  if (!base) return "";
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  return `${base.replace(/\/+$/, "")}/${trimmed}`;
}

/** Cert-level badge icons live on the static CDN (`STATIC_BASE_URL`,
 *  e.g. `https://static.fizzspace.cn/static/icon/...`). Same pass-through
 *  rules as avatars / banners. */
function buildLevelIconUrl(path: string): string {
  if (!path) return "";
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  const base = env.STATIC_BASE_URL;
  if (!base) return "";
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  return `${base.replace(/\/+$/, "")}/${trimmed}`;
}

/** Banner/cover assets live on `NEXT_PUBLIC_BANNER_BASE_URL`. Same
 *  pass-through rules as avatars. */
function buildBannerUrl(path: string): string {
  if (!path) return "";
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  const base = env.BANNER_BASE_URL;
  if (!base) return "";
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  return `${base.replace(/\/+$/, "")}/${trimmed}`;
}

function toCreator(row: CreatorRow | null | undefined): Creator | null {
  if (!row || typeof row !== "object") return null;
  // The list endpoint (`/user/list/user/info`) returns rows shaped as
  // `{ level, info }`. The single-user endpoint (`/user/other/user/info`)
  // returns `{ msg, code, level, info }` — but the shared api client
  // unwraps `body.info` automatically (`body.data ?? body.info ?? …`),
  // so we receive the flat info object with `level` lost. Detect both:
  // if `info` is missing but the row itself looks like an info object,
  // treat the row as info and default `level` to [].
  const looksLikeInfo = !("info" in row) && ("id" in row || "nickName" in row || "avatar" in row);
  const info = looksLikeInfo
    ? (row as unknown as CreatorRow["info"])
    : (row.info ?? ({} as CreatorRow["info"]));
  const levelRaw = looksLikeInfo ? [] : Array.isArray(row.level) ? row.level : [];
  if (info.id === null || info.id === undefined) return null;

  const id = String(info.id);
  const name = safeStr(info.nickName).trim() || safeStr(info.name).trim() || "Unknown";
  const avatarPath = safeStr(info.avatar);
  const levels: CreatorLevel[] = levelRaw
    .filter(
      (l): l is NonNullable<typeof l> =>
        !!l && typeof l.name === "string" && l.name.trim().length > 0
    )
    .map((l) => ({
      id: Number(l.id) || 0,
      type: l.type,
      name: l.name,
      iconUrl: buildLevelIconUrl(safeStr(l.imagePath)),
      description: safeStr(l.description),
    }));

  return {
    id,
    name,
    avatar: buildAvatarUrl(avatarPath),
    banner: buildBannerUrl(safeStr(info.banner)),
    bio: safeStr(info.description),
    joinedAt: safeStr(info.createTime),
    levels,
    contact: safeStr(info.contact).trim(),
    study: safeStr(info.study),
  };
}

const PAGE_SIZE = 60;

export const creatorKeys = {
  all: ["creator"] as const,
  /** Level names are localized by Java via Accept-Language. */
  list: (locale: string) => ["creator", "list", locale] as const,
  search: (key: string, locale: string) => ["creator", "search", key, locale] as const,
  detail: (id: string, locale: string) => ["creator", "detail", id, locale] as const,
};

interface CreatorsView {
  list: Creator[];
  total: number;
}

/**
 * Flatten + map + de-dupe the infinite-query pages into the view model.
 * Shared by the list and search hooks so both dedupe identically (backend
 * pages can repeat rows across page boundaries). `total` comes from the
 * first page's authoritative count.
 */
function selectCreators(data: { pages: CreatorListResult[] }): CreatorsView {
  const seen = new Set<string>();
  const out: Creator[] = [];
  for (const page of data.pages) {
    for (const row of page.list) {
      // Pax (2026-10-06): discovery includes all returned creators. Assigned
      // qualifications still control badges and explicit qualification filters.
      const levels = Array.isArray(row?.level) ? row.level.filter(isCreatorQualification) : [];
      const c = toCreator(row?.info ? { ...row, level: levels } : row);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  }
  const total = data.pages[0]?.total ?? out.length;
  return { list: out, total };
}

/** Shared stop-condition for the list / search infinite queries. */
function nextCreatorsPage(
  lastPage: CreatorListResult,
  allPages: CreatorListResult[]
): number | undefined {
  const loaded = allPages.reduce((acc, p) => acc + p.list.length, 0);
  if (lastPage.list.length === 0) return undefined;
  if (lastPage.list.length < PAGE_SIZE) return undefined;
  if (lastPage.total > 0 && loaded >= lastPage.total) return undefined;
  return allPages.length + 1;
}

/**
 * Infinite-scroll list of creators. Each page fetches `PAGE_SIZE` rows;
 * `total` comes from `sum` on the first page so the UI can show the
 * authoritative total and stop fetching once `loaded.length >= total`.
 */
export function useCreators() {
  const locale = useLocale();
  return useInfiniteQuery<
    CreatorListResult,
    Error,
    CreatorsView,
    ReturnType<typeof creatorKeys.list>,
    number
  >({
    queryKey: creatorKeys.list(locale),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => listCreators({ page: pageParam, pageSize: PAGE_SIZE }),
    // Stop conditions (in `nextCreatorsPage`): empty page, short page
    // (< PAGE_SIZE — most reliable end signal; backend `sum` can overstate
    // due to soft-deleted/filtered users), or loaded >= reported `sum`.
    getNextPageParam: nextCreatorsPage,
    select: selectCreators,
  });
}

/**
 * Infinite-scroll search over the talent market, by free-text `key`
 * (name / nickname). Disabled until `key` is non-empty so an empty box
 * never fires a request; the page falls back to the full `useCreators`
 * list in that case. Same dedupe + pagination as the list.
 */
export function useCreatorSearch(key: string, enabled = true) {
  const locale = useLocale();
  const trimmed = key.trim();
  return useInfiniteQuery<
    CreatorListResult,
    Error,
    CreatorsView,
    ReturnType<typeof creatorKeys.search>,
    number
  >({
    queryKey: creatorKeys.search(trimmed, locale),
    enabled: enabled && trimmed.length > 0,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      searchCreators({ key: trimmed, page: pageParam, pageSize: PAGE_SIZE }),
    getNextPageParam: nextCreatorsPage,
    select: selectCreators,
  });
}

/** Seed the profile from a fresh directory row, then refresh from its own API.
 * Directory data must not intercept refetches or extend the row's freshness. */
export function useCreatorDetail(id: string) {
  const locale = useLocale();
  const qc = useQueryClient();
  const listKey = creatorKeys.list(locale);
  return useQuery<Creator | null>({
    queryKey: creatorKeys.detail(id, locale),
    initialData: () => {
      const cached = qc.getQueryData<{ pages: CreatorListResult[] }>(listKey);
      for (const page of cached?.pages ?? []) {
        for (const row of page.list) {
          const mapped = toCreator(row);
          if (mapped?.id === id) return mapped;
        }
      }
      return undefined;
    },
    initialDataUpdatedAt: () => qc.getQueryState(listKey)?.dataUpdatedAt,
    queryFn: async () => toCreator(await getCreatorBasicInfo(id)),
    enabled: !!id,
    staleTime: 30_000,
  });
}

/**
 * Personal works for a given creator. Two backend endpoints because Java
 * exposes a separate "mine" path that includes records the public list
 * filters out (just-published / pending-review / private). Match the
 * legacy fizzdragon-web behaviour:
 *   - owner self-view   → POST /vedio/query/mypersonal  { page, pageSize }
 *   - visitor / others  → POST /vedio/query/user/personal { userId, ... }
 * Cache key carries `viewer` so owner ≠ visitor caches don't collide.
 */
export function useCreatorPersonalWorks(creatorId: string, isOwner = false) {
  return useQuery<PersonalWork[]>({
    queryKey: ["creator", "personal-works", creatorId, isOwner ? "owner" : "visitor"],
    queryFn: () => (isOwner ? getMyPersonalWorks(1, 50) : getUserPersonalWorks(creatorId, 1, 50)),
    enabled: !!creatorId,
  });
}

/**
 * Projects (IPs) created by a given creator. Backend endpoint:
 *   POST /project/user/projects  { userId, page, pageSize }
 */
export function useCreatorProjects(creatorId: string, options?: { enabled?: boolean }) {
  return useQuery<Project[]>({
    queryKey: ["creator", "projects", creatorId],
    queryFn: () => getUserProjects(creatorId, 1, 50),
    enabled: !!creatorId && (options?.enabled ?? true),
  });
}

/**
 * Work-experience entries for a given creator (read-only view of someone
 * else's resume). Backend endpoint:
 *   GET /user/resumer/list/{userId}
 *
 * Distinct from the self-profile `useExperience` hook which hits
 * `/user/resumer/me`. Same row shape on the wire — reuses
 * `ExperienceEntry` from the profile feature for typing only.
 */
export function useCreatorExperience(creatorId: string) {
  return useQuery<ExperienceEntry[]>({
    queryKey: ["creator", "experience", creatorId],
    enabled: !!creatorId,
    queryFn: async () => {
      const raw = await api.get<ExperienceEntry[] | { list?: ExperienceEntry[] } | null>(
        `/user/resumer/list/${encodeURIComponent(creatorId)}`
      );
      const list = Array.isArray(raw) ? raw : (raw?.list ?? []);
      return list.map((e) => ({
        id: e?.id,
        title: typeof e?.title === "string" ? e.title : "",
        organization: typeof e?.organization === "string" ? e.organization : "",
        location: typeof e?.location === "string" ? e.location : "",
        startTime: typeof e?.startTime === "string" ? e.startTime : "",
        endTime: typeof e?.endTime === "string" ? e.endTime : "",
        description: typeof e?.description === "string" ? e.description : "",
      }));
    },
  });
}

/**
 * Projects (IPs) the creator has joined as a contributor. Backend endpoint:
 *   POST /project/user/joined  { userId, page, pageSize }
 */
export function useCreatorJoinedProjects(creatorId: string) {
  return useQuery<Project[]>({
    queryKey: ["creator", "joined", creatorId],
    queryFn: () => getUserJoinedProjects(creatorId, 1, 50),
    enabled: !!creatorId,
  });
}
