/**
 * IP listing + taxonomy hooks (new contract).
 *
 *   - `useIPList`       — POST /project/list (JSON, data.{list,total,...})
 *   - `useIPTypes`      — GET /vedio/project/type/list (flat [{id, name}])
 *   - `useIPTagList`    — GET /vedio/project/tag/list (flat [{id, name, typeId}])
 */

import { useQuery } from "@tanstack/react-query";
import { acceptLanguage, bearerHeader, ipKeys } from "./shared";
import type { IPProject, IPListResult, IPType, IPTag } from "./types";

// ─── /project/list ──────────────────────────────────

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

// ─── /vedio/project/type/list, /vedio/project/tag/list ────

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
