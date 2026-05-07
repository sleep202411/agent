/**
 * IP listing + taxonomy hooks (new contract).
 *
 *   - `useIPList`       — POST /project/list (JSON, data.{list,total,...})
 *   - `useIPTypes`      — GET /vedio/project/type/list (flat [{id, name}])
 *   - `useIPTagList`    — alias to `src/hooks/use-tag-list#useTagList`
 *                          (shared with /publish so both surfaces hit
 *                           the same React Query cache)
 */

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { acceptLanguage, bearerHeader, ipKeys } from "./shared";
import type { IPProject, IPListResult, IPType } from "./types";

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
  // Backend contract (`README.md` §`/project/list`):
  //   page     int    required
  //   pageSize int    required
  //   key      string optional — omit = "no keyword filter"
  //   typeId   string optional — omit = "all categories"
  //   tag      string optional — omit = "all tags"
  // Empty filters are sent by *omission*, not as `key=` empty
  // params — keeps the URL legible (`?page=1&pageSize=20`) and
  // avoids any backend that might LIKE `%%` on a literal empty
  // string instead of skipping the WHERE clause.
  const qs = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.key) qs.set("key", params.key);
  if (params.typeId) qs.set("typeId", params.typeId);
  if (params.tag) qs.set("tag", params.tag);
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

/**
 * Infinite-scroll variant of `useIPList` for the IP plaza homepage.
 * Wraps the same `fetchIPList` fetcher but pages on demand: each
 * `fetchNextPage()` call loads the next contiguous page; `getNextPageParam`
 * compares accumulated rows against the backend-reported `total` (which
 * comes back as `sum` on `/project/list`) to decide when to stop.
 *
 * Filter changes (key / typeId / tag) reset the cursor automatically by
 * keying off them — TanStack treats a different `queryKey` as a fresh
 * scroll, so flipping a category chip resets the list.
 */
export function useInfiniteIPList(params?: {
  pageSize?: number;
  key?: string;
  typeId?: string;
  tag?: string;
}) {
  const pageSize = params?.pageSize ?? 20;
  const key = params?.key ?? "";
  const typeId = params?.typeId ?? "";
  const tag = params?.tag ?? "";
  return useInfiniteQuery<
    IPListResult,
    Error,
    { pages: IPListResult[]; pageParams: number[] },
    readonly unknown[],
    number
  >({
    queryKey: ["ip", "list-infinite", { pageSize, key, typeId, tag }] as const,
    queryFn: ({ pageParam }) => fetchIPList({ page: pageParam, pageSize, key, typeId, tag }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.list.length, 0);
      if (loaded >= lastPage.total) return undefined;
      return allPages.length + 1;
    },
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
