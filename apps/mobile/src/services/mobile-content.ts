import { appEnv, resolveAssetUrl } from "@/config";
import { api } from "@/lib/api-client";

type UnknownRecord = Record<string, unknown>;

export type FeedItem = {
  contact?: string;
  coverUrl: string;
  creator?: string;
  description?: string;
  id: string;
  projectId?: number | string;
  title: string;
};

export type ProjectItem = {
  coverUrl: string;
  description?: string;
  id: string;
  meta?: string;
  status?: string;
  title: string;
};

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: UnknownRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function idField(record: UnknownRecord, ...keys: string[]) {
  return stringField(record, ...keys) ?? `${Date.now()}-${Math.random()}`;
}

function flattenList(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];

  const candidates = [value.list, value.records, value.rows, value.data, value.info];
  for (const candidate of candidates) {
    const list = flattenList(candidate);
    if (list.length) return list;
  }

  return Object.values(value).flatMap((entry) =>
    Array.isArray(entry) ? entry.filter(isRecord) : []
  );
}

function resolveCover(path?: string) {
  return resolveAssetUrl(path ?? "", appEnv.assets.bannerBaseUrl || appEnv.assets.ossBaseUrl);
}

function normalizeFeedItem(raw: UnknownRecord): FeedItem {
  const projectId = stringField(raw, "projectId", "id");
  const title = stringField(raw, "title", "name", "projectName") ?? "Untitled";

  return {
    contact: stringField(raw, "contact"),
    coverUrl: resolveCover(
      stringField(raw, "videoBanner", "bannerLink", "projectBanner", "imagePath")
    ),
    creator: stringField(raw, "creator", "nickName", "nickname", "ownerName"),
    description: stringField(raw, "introduction", "description", "message"),
    id: idField(raw, "id", "projectId"),
    projectId,
    title,
  };
}

function normalizeProjectItem(raw: UnknownRecord): ProjectItem {
  return {
    coverUrl: resolveCover(
      stringField(raw, "bannerLink", "projectBanner", "videoBanner", "imagePath")
    ),
    description: stringField(raw, "description", "introduction"),
    id: idField(raw, "id", "projectId"),
    meta: stringField(raw, "createTime", "updateTime", "applyTime"),
    status: stringField(raw, "status", "applyStatus", "projectStatus"),
    title: stringField(raw, "name", "title", "projectName") ?? "Untitled project",
  };
}

export async function getRecommendedFeed(limit = 12) {
  const data = await api.postForm<unknown>("/vedio/recommend", { page: 1, pageSize: limit });
  return flattenList(data).map(normalizeFeedItem).slice(0, limit);
}

export async function getPublicProjectFeed(limit = 8) {
  const data = await api.postForm<unknown>("/project/list", { page: 1, pageSize: limit });
  return flattenList(data).map(normalizeFeedItem).slice(0, limit);
}

export async function getMyProjects(limit = 20) {
  const data = await api.postForm<unknown>("/project/myprojects", { page: 1, pageSize: limit });
  return flattenList(data).map(normalizeProjectItem);
}

export async function getJoinedProjects(limit = 20) {
  const data = await api.postForm<unknown>("/project/myjoined", { page: 1, pageSize: limit });
  return flattenList(data).map(normalizeProjectItem);
}
