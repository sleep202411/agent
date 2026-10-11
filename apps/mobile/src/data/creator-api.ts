import { appEnv, resolveAssetUrl } from "@/config";
import { api } from "@/lib/api-client";

import type { CreatorLevel, CreatorSummary } from "./types";

type CreatorInfoDto = {
  id?: number | string | null;
  nickName?: string | null;
  name?: string | null;
  avatar?: string | null;
  banner?: string | null;
  description?: string | null;
  study?: string | null;
  createTime?: string | null;
  jobseeking?: number | boolean | null;
};

type CreatorLevelDto = {
  type?: number | null;
  id?: number | string | null;
  name?: string | null;
  description?: string | null;
  imagePath?: string | null;
};

type CreatorRowDto = {
  level?: CreatorLevelDto[] | null;
  info?: CreatorInfoDto | null;
};

type CreatorDetailEnvelope = {
  info?: CreatorInfoDto;
  level?: CreatorLevelDto[];
};

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveMaybe(path: string | undefined, baseUrl: string): string | undefined {
  return path ? resolveAssetUrl(path, baseUrl) : undefined;
}

function mapLevel(level: CreatorLevelDto | null): CreatorLevel | undefined {
  // Match Web's assigned creator qualifications: FD, AI Producer, skills.
  // Account privileges and qualification application submissions are not badges.
  if (
    !level ||
    !Number.isSafeInteger(level.id) ||
    Number(level.id) <= 0 ||
    !(level.id === 13 || level.type === 1 || level.type === 4)
  )
    return undefined;
  const name = nonEmpty(level.name);
  if (!name) return undefined;
  return {
    id: String(level.id ?? name),
    name,
    description: nonEmpty(level.description),
    iconUrl: resolveMaybe(nonEmpty(level.imagePath), appEnv.assets.staticBaseUrl),
  };
}

function mapCreator(row: CreatorRowDto): CreatorSummary | undefined {
  const info = row.info;
  if (!info?.id) return undefined;
  const id = String(info.id);
  const name = nonEmpty(info.nickName) ?? nonEmpty(info.name) ?? "Creator";
  const levels = (Array.isArray(row.level) ? row.level : [])
    .map(mapLevel)
    .filter((level): level is CreatorLevel => !!level);

  return {
    id,
    name,
    avatarUrl: resolveMaybe(nonEmpty(info.avatar), appEnv.assets.userBaseUrl),
    bannerUrl: resolveMaybe(nonEmpty(info.banner), appEnv.assets.bannerBaseUrl),
    bio: nonEmpty(info.description),
    study: nonEmpty(info.study),
    joinedAt: nonEmpty(info.createTime),
    levels,
    primaryLevel: levels[0]?.name,
    openToWork: info.jobseeking === true || info.jobseeking === 1,
  };
}

export interface CreatorsPage {
  creators: CreatorSummary[];
  total: number;
  /** Guest hit the public cap (50) and there are more behind a login. */
  requiresLogin: boolean;
  nextOffset?: number;
}

type CreatorsListDto = {
  items?: {
    id?: string | null;
    name?: string | null;
    /** Server-resolved: an absolute image URL or a DiceBear data URI. */
    avatarUrl?: string | null;
    openToWork?: boolean | null;
  }[];
  total?: number;
  requiresLogin?: boolean;
};

/**
 * Public creators directory — OUR Nest endpoint (`/aurora/creators`), which
 * reads client_user directly + resolves avatars server-side (no Java HTTP, so
 * no login wall). Guests see up to 50 then `requiresLogin`; a signed-in viewer
 * gets the full window.
 */
export async function fetchCreators(limit = 50, offset = 0): Promise<CreatorsPage> {
  // Let callers distinguish transport failures from a successful empty directory.
  const res = await api.get<CreatorsListDto>("/creators", {
    service: "aurora",
    params: { limit, offset },
  });
  const seen = new Set<string>();
  const creators: CreatorSummary[] = [];
  for (const item of res.items ?? []) {
    const id = nonEmpty(item.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    creators.push({
      id,
      name: nonEmpty(item.name) ?? "Creator",
      avatarUrl: nonEmpty(item.avatarUrl),
      openToWork: item.openToWork === true,
      levels: [],
    });
  }
  return {
    creators,
    total: res.total ?? creators.length,
    requiresLogin: res.requiresLogin === true,
  };
}

export async function fetchCreatorById(id: string): Promise<CreatorSummary | undefined> {
  const envelope = await api.post<CreatorDetailEnvelope>("/user/other/user/info", {
    params: { UserId: id },
    raw: true,
    service: "content",
  });
  return mapCreator({ info: envelope.info, level: envelope.level });
}

/** Web's server-side name search; page offsets count transport rows, not mapped cards. */
export async function searchCreators(key: string, limit = 50, offset = 0): Promise<CreatorsPage> {
  if (!key.trim()) return fetchCreators(limit, offset);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset % limit !== 0
  )
    throw new Error("Invalid creator search page.");
  const result = await api.post<{
    data?: (CreatorRowDto | CreatorInfoDto)[];
    sum?: number;
    total?: number;
  }>("/user/search/users", {
    service: "content",
    params: { key: key.trim(), page: offset / limit + 1, pageSize: limit },
    raw: true,
    retry: false,
  });
  if (!Array.isArray(result.data)) throw new Error("Invalid creator search response.");
  const total = result.sum ?? result.total ?? offset + result.data.length;
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("Invalid creator search total.");
  const seen = new Set<string>();
  const creators = result.data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const creator = mapCreator(
      "info" in row ? (row as CreatorRowDto) : { info: row as CreatorInfoDto }
    );
    if (!creator || seen.has(creator.id)) return [];
    seen.add(creator.id);
    return [creator];
  });
  return {
    creators,
    total,
    requiresLogin: false,
    nextOffset: result.data.length ? offset + limit : offset,
  };
}
