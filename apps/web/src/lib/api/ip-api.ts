import { env } from "@/src/env";

// ─── Types ──────────────────────────────────────────

export interface IPProject {
  id: number;
  ownerId: number;
  ownerName: string;
  ownerAvatar: string;
  name: string;
  typeId: number;
  bannerLink: string;
  videoLink: string | null;
  description: string;
  createTime: string;
  projectStatus: number;
  contact: string;
  tag: string | null;
  background: string | null;
}

export interface IPListResponse {
  data: IPProject[];
  sum: number;
}

/** Category map: { "1": "AIGC影视", "2": "热血动漫", ... } */
export type CategoryMap = Record<string, string>;

export interface TagListResponse {
  /** All tags: { "1": "AIGC影视", "11": "悬疑", ... } */
  all: Record<string, string>;
  /** Tags grouped by category name: { "AIGC影视": ["宫廷权谋", ...], ... } */
  data: Record<string, string[]>;
  /** Tag ID→name grouped by category name: { "AIGC影视": { "48": "宫廷权谋", ... }, ... } */
  map: Record<string, Record<string, string>>;
}

// ─── API Calls ──────────────────────────────────────

const CONTENT_PREFIX = "/vedio";

/**
 * Search IP projects (paginated)
 * POST /vedio/project/search
 */
export async function searchIPProjects(params: {
  page?: number;
  pageSize?: number;
}): Promise<{ list: IPProject[]; total: number }> {
  const res = await fetch(`${CONTENT_PREFIX}/project/search`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 20),
    }),
  });
  const json = (await res.json()) as { code: number; data: IPProject[]; sum: number };
  return { list: json.data ?? [], total: json.sum ?? 0 };
}

/**
 * Get project categories
 * POST /vedio/type/list
 */
export async function getCategories(): Promise<CategoryMap> {
  const res = await fetch(`${CONTENT_PREFIX}/type/list`, { method: "POST" });
  const json = (await res.json()) as { code: number; data: Record<string, string> };
  return json.data ?? {};
}

/**
 * Get tag list with category mapping
 * GET /vedio/type/tag/list
 */
export async function getTagList(): Promise<TagListResponse> {
  const res = await fetch(`${CONTENT_PREFIX}/type/tag/list`);
  const json = (await res.json()) as TagListResponse & { code: number };
  return { all: json.all ?? {}, data: json.data ?? {}, map: json.map ?? {} };
}

// ─── Helpers ────────────────────────────────────────

/** Convert a relative image path to full banner OSS URL */
export function ipImageUrl(path?: string | null): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${env.BANNER_BASE_URL}/${path}`;
}
