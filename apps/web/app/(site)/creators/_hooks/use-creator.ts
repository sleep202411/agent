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

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listCreators, getCreatorBasicInfo, type CreatorRow } from "@/src/services/creator";
import {
  getUserPersonalWorks,
  getUserProjects,
  getUserJoinedProjects,
  type PersonalWork,
  type Project,
} from "@/src/services/project";
import { env } from "@/src/env";

export interface CreatorLevel {
  id: number;
  name: string;
}

export interface Creator {
  id: string;
  name: string;
  avatar: string;
  bio: string;
  joinedAt: string;
  levels: CreatorLevel[];
}

function safeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Backend serves a default person-silhouette PNG for users who haven't
 * uploaded an avatar (`<userId>/d17b1d5e-282e-47e0-bd99-9a72477adf93.png`).
 * That image looks worse than a plain gray block, so treat it as "no
 * avatar" and let the UI render its own empty state.
 */
const DEFAULT_AVATAR_FILE = "d17b1d5e-282e-47e0-bd99-9a72477adf93.png";

/**
 * User avatars live on a different OSS bucket than studio assets, so they
 * resolve via `NEXT_PUBLIC_USER_BASE_URL` (with `OSS_BASE_URL` as fallback).
 * Already-absolute URLs pass through unchanged. Returns "" for empty paths
 * and for the known backend placeholder.
 */
function buildAvatarUrl(path: string): string {
  if (!path) return "";
  if (path.endsWith(DEFAULT_AVATAR_FILE)) return "";
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  const base = env.USER_BASE_URL || env.OSS_BASE_URL;
  if (!base) return "";
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  return `${base.replace(/\/+$/, "")}/${trimmed}`;
}

function toCreator(row: CreatorRow | null | undefined): Creator | null {
  if (!row || typeof row !== "object") return null;
  const info = row.info ?? ({} as CreatorRow["info"]);
  if (info.id === null || info.id === undefined) return null;

  const id = String(info.id);
  const name = safeStr(info.nickName).trim() || safeStr(info.name).trim() || "Unknown";
  const avatarPath = safeStr(info.avatar);
  const levels: CreatorLevel[] = Array.isArray(row.level)
    ? row.level
        .filter((l): l is NonNullable<typeof l> => !!l && typeof l.name === "string")
        .map((l) => ({ id: Number(l.id) || 0, name: l.name }))
    : [];

  return {
    id,
    name,
    avatar: buildAvatarUrl(avatarPath),
    bio: safeStr(info.description),
    joinedAt: safeStr(info.createTime),
    levels,
  };
}

async function fetchCreators(): Promise<Creator[]> {
  const rows = await listCreators({ page: 1, pageSize: 60 });
  if (!Array.isArray(rows)) return [];
  return rows.map(toCreator).filter((c): c is Creator => c !== null);
}

export const creatorKeys = {
  all: ["creator"] as const,
  list: () => ["creator", "list"] as const,
  detail: (id: string) => ["creator", "detail", id] as const,
};

export function useCreators() {
  return useQuery({
    queryKey: creatorKeys.list(),
    queryFn: fetchCreators,
  });
}

/**
 * Resolve a creator by id. Tries the list cache first (the Talent Market
 * grid usually populated it), then falls back to
 * `POST /user/query/user/info { userId }` so direct URL hits and
 * page reloads still work.
 */
export function useCreatorDetail(id: string) {
  const qc = useQueryClient();
  return useQuery<Creator | null>({
    queryKey: ["creator", "detail", id],
    queryFn: async () => {
      const cached = qc.getQueryData<Creator[]>(creatorKeys.list());
      const fromCache = Array.isArray(cached) ? cached.find((c) => c.id === id) : undefined;
      if (fromCache) return fromCache;
      if (!id) return null;
      const row = await getCreatorBasicInfo(id);
      return toCreator(row);
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

/**
 * Personal works for a given creator. Backend endpoint:
 *   POST /vedio/query/user/personal  { userId, page, pageSize }
 */
export function useCreatorPersonalWorks(creatorId: string) {
  return useQuery<PersonalWork[]>({
    queryKey: ["creator", "personal-works", creatorId],
    queryFn: () => getUserPersonalWorks(creatorId, 1, 50),
    enabled: !!creatorId,
  });
}

/**
 * Projects (IPs) created by a given creator. Backend endpoint:
 *   POST /project/user/projects  { userId, page, pageSize }
 */
export function useCreatorProjects(creatorId: string) {
  return useQuery<Project[]>({
    queryKey: ["creator", "projects", creatorId],
    queryFn: () => getUserProjects(creatorId, 1, 50),
    enabled: !!creatorId,
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
