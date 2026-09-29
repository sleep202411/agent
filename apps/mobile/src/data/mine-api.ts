/** Owner-only personal video listing, matching Web's Java content contract. */
import { appEnv, resolveAssetUrl } from "@/config";
import { api } from "@/lib/api-client";
export interface MyWork {
  id: string;
  title: string;
  introduction?: string;
  hasVideo?: boolean;
  coverUrl?: string;
  reviewStatus?: number;
  isPrivate: boolean;
}
export const MY_WORKS_PAGE_SIZE = 30;
function extractList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const row = raw as Record<string, unknown>;
    for (const key of ["list", "records", "data"]) {
      if (Array.isArray(row[key])) return row[key];
    }
    if (row.data && typeof row.data === "object") {
      const data = row.data as Record<string, unknown>;
      if (Array.isArray(data.list)) return data.list;
      if (Array.isArray(data.records)) return data.records;
    }
  }
  throw new Error("Invalid personal works response");
}
export async function fetchMyWorksPage(page: number, signal?: AbortSignal) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("Invalid page");
  const raw = await api.postForm<unknown>(
    "/vedio/query/mypersonal",
    {
      page: String(page),
      pageSize: String(MY_WORKS_PAGE_SIZE),
    },
    { service: "content", signal }
  );
  const rows = extractList(raw);
  const works: MyWork[] = [];
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    if ((typeof row.id !== "string" && typeof row.id !== "number") || !String(row.id).trim())
      continue;
    works.push({
      id: String(row.id),
      title: typeof row.title === "string" ? row.title : "",
      introduction: typeof row.introduction === "string" ? row.introduction : "",
      hasVideo: typeof row.videoLink === "string" && !!row.videoLink.trim(),
      coverUrl:
        typeof row.videoBanner === "string" && row.videoBanner.trim()
          ? resolveAssetUrl(row.videoBanner, appEnv.assets.bannerBaseUrl)
          : undefined,
      reviewStatus: typeof row.review === "number" ? row.review : undefined,
      isPrivate: row.viewStatus != null && String(row.viewStatus) !== "1",
    });
  }
  return { works, hasMore: rows.length >= MY_WORKS_PAGE_SIZE };
}

/** No dedicated detail API exists in Web; resolve only from the current owner's list. */
export async function findMyWork(id: string, signal: AbortSignal): Promise<MyWork> {
  const seen = new Set<string>();
  for (let page = 1; ; page++) {
    signal.throwIfAborted();
    const result = await fetchMyWorksPage(page, signal);
    signal.throwIfAborted();
    const found = result.works.find((work) => work.id === id);
    if (found) return found;
    if (!result.hasMore) throw new Error("Work is not available in this account");
    const previous = seen.size;
    result.works.forEach((work) => seen.add(work.id));
    if (seen.size === previous) throw new Error("Work listing did not advance");
  }
}
