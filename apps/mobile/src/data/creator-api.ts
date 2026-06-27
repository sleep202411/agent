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
  createTime?: string | null;
  jobseeking?: number | boolean | null;
};

type CreatorLevelDto = {
  id?: number | string | null;
  name?: string | null;
  description?: string | null;
  imagePath?: string | null;
};

type CreatorRowDto = {
  level?: CreatorLevelDto[] | null;
  info?: CreatorInfoDto | null;
};

type CreatorListEnvelope = {
  data?: CreatorRowDto[];
  sum?: number;
  total?: number;
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

function mapLevel(level: CreatorLevelDto): CreatorLevel | undefined {
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
  const levels = (row.level ?? []).map(mapLevel).filter((level): level is CreatorLevel => !!level);

  return {
    id,
    name,
    avatarUrl: resolveMaybe(nonEmpty(info.avatar), appEnv.assets.userBaseUrl),
    bannerUrl: resolveMaybe(nonEmpty(info.banner), appEnv.assets.bannerBaseUrl),
    bio: nonEmpty(info.description),
    joinedAt: nonEmpty(info.createTime),
    levels,
    primaryLevel: levels[0]?.name,
    openToWork: info.jobseeking === true || info.jobseeking === 1,
  };
}

export async function fetchCreators(limit = 18): Promise<CreatorSummary[]> {
  try {
    const envelope = await api.postForm<CreatorListEnvelope>(
      "/user/list/user/info",
      { page: 1, pageSize: limit },
      { raw: true, service: "content" }
    );
    const rows = Array.isArray(envelope.data) ? envelope.data : [];
    const seen = new Set<string>();
    return rows.map(mapCreator).filter((creator): creator is CreatorSummary => {
      if (!creator || seen.has(creator.id)) return false;
      seen.add(creator.id);
      return true;
    });
  } catch {
    return [];
  }
}

export async function fetchCreatorById(id: string): Promise<CreatorSummary | undefined> {
  try {
    const envelope = await api.post<CreatorDetailEnvelope>("/user/other/user/info", {
      params: { UserId: id },
      raw: true,
      service: "content",
    });
    return mapCreator({ info: envelope.info, level: envelope.level });
  } catch {
    return undefined;
  }
}
