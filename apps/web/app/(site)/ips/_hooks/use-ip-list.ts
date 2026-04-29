/**
 * IP listing + taxonomy hooks.
 *
 *   - `useIPProjects`    legacy `/vedio/project/search` (form-encoded, sum)
 *   - `useIPList`        new `/project/list` (JSON, data.{list,total,...})
 *   - `useIPCategories`  legacy `/vedio/type/list` (map shape)
 *   - `useIPTags`        legacy `/vedio/type/tag/list` (all/data/map shape)
 *   - `useIPTypes`       new `/vedio/project/type/list` (flat [{id, name}])
 *   - `useIPTagList`     new `/vedio/project/tag/list` (flat [{id, name, typeId}])
 *
 * Legacy + new hooks coexist until Plaza page migrates to the new contract.
 */

import { useQuery } from "@tanstack/react-query";
import { acceptLanguage, bearerHeader, ipKeys } from "./shared";
import type { IPProject, IPListResult, IPType, IPTag, CategoryMap, TagListResponse } from "./types";

// ─── Legacy: /vedio/project/search ──────────────────

async function searchIPProjects(params: {
  page?: number;
  pageSize?: number;
  key?: string;
  typeId?: string;
  tag?: string;
}): Promise<{ list: IPProject[]; total: number }> {
  // Body shape mirrors legacy: page, pageSize, key (always sent, may be
  // empty). Server-side parsers tolerate key="" but NPE without the field.
  // TypeId and tag are only sent when set — empty values would filter to nothing.
  const body = new URLSearchParams({
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 20),
    key: params.key ?? "",
  });
  if (params.typeId) body.append("TypeId", params.typeId);
  if (params.tag) body.append("tag", params.tag);
  const res = await fetch("/vedio/project/search", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body,
  });
  if (!res.ok) return { list: [], total: 0 };
  const json = (await res.json()) as { code: number; data: IPProject[]; sum: number };
  return { list: json.data ?? [], total: json.sum ?? 0 };
}

export function useIPProjects(params?: {
  page?: number;
  pageSize?: number;
  key?: string;
  typeId?: string;
  tag?: string;
}) {
  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 20;
  const key = params?.key ?? "";
  const typeId = params?.typeId ?? "";
  const tag = params?.tag ?? "";
  return useQuery<{ list: IPProject[]; total: number }>({
    queryKey: ipKeys.projects({ page, pageSize, key, typeId, tag }),
    queryFn: () => searchIPProjects({ page, pageSize, key, typeId, tag }),
  });
}

// ─── New: /project/list ─────────────────────────────

async function fetchIPList(params: {
  page: number;
  pageSize: number;
  key: string;
  typeId: string;
  tag: string;
}): Promise<IPListResult> {
  const res = await fetch("/project/list", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    return { list: [], total: 0, currentPage: params.page, pageSize: params.pageSize };
  }
  const json = (await res.json()) as {
    code: number;
    data: { list: IPProject[]; total: number; currentPage: number; pageSize: number };
  };
  return {
    list: json.data?.list ?? [],
    total: json.data?.total ?? 0,
    currentPage: json.data?.currentPage ?? params.page,
    pageSize: json.data?.pageSize ?? params.pageSize,
  };
}

export function useIPList(params?: {
  page?: number;
  pageSize?: number;
  key?: string;
  typeId?: string;
  tag?: string;
}) {
  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 20;
  const key = params?.key ?? "";
  const typeId = params?.typeId ?? "";
  const tag = params?.tag ?? "";
  return useQuery<IPListResult>({
    queryKey: ipKeys.list({ page, pageSize, key, typeId, tag }),
    queryFn: () => fetchIPList({ page, pageSize, key, typeId, tag }),
  });
}

// ─── Legacy taxonomy: /vedio/type/list, /vedio/type/tag/list ──

async function getCategories(): Promise<CategoryMap> {
  const res = await fetch("/vedio/type/list", {
    credentials: "include",
    headers: { "accept-language": acceptLanguage(), Authorization: bearerHeader() },
  });
  if (!res.ok) return {};
  const json = (await res.json()) as { code: number; data: Record<string, string> };
  return json.data ?? {};
}

async function getTagList(): Promise<TagListResponse> {
  const res = await fetch("/vedio/type/tag/list", {
    credentials: "include",
    headers: { "accept-language": acceptLanguage(), Authorization: bearerHeader() },
  });
  if (!res.ok) return { all: {}, data: {}, map: {} };
  const json = (await res.json()) as TagListResponse & { code: number };
  return { all: json.all ?? {}, data: json.data ?? {}, map: json.map ?? {} };
}

// Categories and tags are reference data — they barely change between
// sessions, so cache them aggressively to skip redundant trips.
export function useIPCategories() {
  return useQuery<CategoryMap>({
    queryKey: ipKeys.categories,
    queryFn: getCategories,
    staleTime: 1000 * 60 * 30,
  });
}

export function useIPTags() {
  return useQuery<TagListResponse>({
    queryKey: ipKeys.tags,
    queryFn: getTagList,
    staleTime: 1000 * 60 * 30,
  });
}

// ─── New flat taxonomy: /vedio/project/type/list, /tag/list ──

async function fetchTypeList(): Promise<IPType[]> {
  const res = await fetch("/vedio/project/type/list", {
    credentials: "include",
    headers: { "accept-language": acceptLanguage(), Authorization: bearerHeader() },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { code: number; data: IPType[] };
  return Array.isArray(json.data) ? json.data : [];
}

async function fetchTagList(): Promise<IPTag[]> {
  const res = await fetch("/vedio/project/tag/list", {
    credentials: "include",
    headers: { "accept-language": acceptLanguage(), Authorization: bearerHeader() },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { code: number; data: IPTag[] };
  return Array.isArray(json.data) ? json.data : [];
}

export function useIPTypes() {
  return useQuery<IPType[]>({
    queryKey: ipKeys.types,
    queryFn: fetchTypeList,
    staleTime: 1000 * 60 * 30,
  });
}

export function useIPTagList() {
  return useQuery<IPTag[]>({
    queryKey: ipKeys.tagList,
    queryFn: fetchTagList,
    staleTime: 1000 * 60 * 30,
  });
}
