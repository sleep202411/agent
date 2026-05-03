/**
 * IP listing + taxonomy hooks (new contract).
 *
 *   - `useIPList`       — POST /project/list (JSON, data.{list,total,...})
 *   - `useIPTypes`      — GET /vedio/project/type/list (flat [{id, name}])
 *   - `useIPTagList`    — alias to `src/hooks/use-tag-list#useTagList`
 *                          (shared with /publish so both surfaces hit
 *                           the same React Query cache)
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

export function useIPTypes() {
  return useQuery<IPType[]>({
    queryKey: ipKeys.types,
    queryFn: fetchTypeList,
    staleTime: 1000 * 60 * 30,
  });
}

/**
 * IP Plaza filter chips. Delegates to the shared `useTagList` so this
 * page and `/publish` share the same React Query cache — visiting
 * either page warms the chip list for the other.
 *
 * `IPTag` and the shared `Tag` type are structurally identical
 * (`{ id: number; name: string }`); the alias is kept so existing
 * call sites that import `IPTag` from this barrel don't need touching.
 */
export { useTagList as useIPTagList } from "@/src/hooks/use-tag-list";
