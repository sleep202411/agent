/**
 * IP listing + taxonomy hooks (new contract).
 *
 *   - `useIPList`       — POST /project/list (JSON, data.{list,total,...})
 *   - `useIPTypes`      — GET /vedio/project/type/list (flat [{id, name}])
 *   - `useIPTagList`    — GET /vedio/type/tag/list (flat [{id, name}] from `all`)
 */

import { useQuery } from "@tanstack/react-query";
import { acceptLanguage, bearerHeader, ipKeys } from "./shared";
import type { IPProject, IPListResult, IPType, IPTag } from "./types";

// ─── /project/list ──────────────────────────────────

// Backend wire shape for `/project/list` rows. Diverges from the
// UI-facing `IPProject` (renames: title → name, introduction →
// description, creator → ownerName, videoBanner → bannerLink, …).
interface WireProject {
  id: number | null;
  projectId: number;
  title: string | null;
  introduction: string | null;
  creator: string | null;
  videoBanner: string | null;
  contact: string | null;
  tags: string | null;
  viewStatus: number | null;
  createTime: string | null;
}

function mapWireProject(w: WireProject): IPProject {
  return {
    id: w.projectId,
    ownerId: 0,
    ownerName: w.creator ?? "",
    ownerAvatar: "",
    name: w.title ?? "",
    typeId: 0,
    bannerLink: w.videoBanner ?? "",
    videoLink: null,
    description: w.introduction ?? "",
    createTime: w.createTime ?? "",
    projectStatus: w.viewStatus ?? 0,
    contact: w.contact ?? "",
    tag: w.tags,
    background: null,
  };
}

async function fetchIPList(params: {
  page: number;
  pageSize: number;
  key: string;
  typeId: string;
  tag: string;
}): Promise<IPListResult> {
  // Backend takes page / pageSize as query params (Swagger §queryProject).
  // key / typeId / tag aren't surfaced yet — kept in the hook signature so
  // the call sites don't change once filters are wired in.
  const qs = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  const res = await fetch(`/project/list?${qs.toString()}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
  });
  if (!res.ok) {
    return { list: [], total: 0, currentPage: params.page, pageSize: params.pageSize };
  }
  const json = (await res.json()) as {
    code: number;
    data: WireProject[];
    sum: number;
  };
  const rows = Array.isArray(json.data) ? json.data : [];
  return {
    list: rows.map(mapWireProject),
    total: json.sum ?? rows.length,
    currentPage: params.page,
    pageSize: params.pageSize,
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

// ─── /vedio/project/type/list, /vedio/type/tag/list ────

/**
 * `/vedio/type/list` returns `{ code, data: { [id]: name } }` — same
 * `id → name` object map shape as `/vedio/type/tag/list` `all`. We
 * flatten to `{ id, name }[]` so the filter rail can iterate naturally.
 */
async function fetchTypeList(): Promise<IPType[]> {
  const res = await fetch("/vedio/type/list", {
    credentials: "include",
    headers: { "accept-language": acceptLanguage(), Authorization: bearerHeader() },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { code: number; data?: Record<string, string> };
  const data = json.data ?? {};
  return Object.entries(data).map(([id, name]) => ({ id: Number(id), name }));
}

/**
 * `/vedio/type/tag/list` returns three parallel views of the same dictionary:
 *   - `all`: `{ [id]: name }`              flat lookup of every category + tag
 *   - `data`: `{ [category]: name[] }`     names grouped by category
 *   - `map`: `{ [category]: { [id]: name } }`  ids grouped by category
 *
 * IP Plaza only needs the flat list (filter chips, search facets), so we
 * read `all` and emit `{ id, name }[]`. The category→tag relationship in
 * `map` is intentionally ignored — if a future feature needs it, add a
 * sibling fetcher rather than overloading this one.
 */
async function fetchTagList(): Promise<IPTag[]> {
  const res = await fetch("/vedio/type/tag/list", {
    credentials: "include",
    headers: { "accept-language": acceptLanguage(), Authorization: bearerHeader() },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { code: number; all?: Record<string, string> };
  const all = json.all ?? {};
  return Object.entries(all).map(([id, name]) => ({ id: Number(id), name }));
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
