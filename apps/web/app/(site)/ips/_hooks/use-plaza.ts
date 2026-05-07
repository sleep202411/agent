/**
 * Plaza homepage data: Featured carousel + For You rail (P1).
 *
 *   - `usePlazaFeatured`  — POST /project/featured/list (queryFeaturedProject)
 *   - `usePlazaForYou`    — POST /project/foryou/list
 *
 * Both return the same wire shape as `/project/list`
 * (`{code, data: WireProject[], sum}`).
 */

import { useQuery } from "@tanstack/react-query";
import { acceptLanguage, bearerHeader, ipImageUrl, ipKeys, splitTags } from "./shared";
import type { FeaturedSlide, RailItem } from "./types";

// Wire shape for `/project/featured/list`. Mirrors `WireProject` from
// the listing endpoint — same controller-projection, just sorted /
// filtered to the editor-curated featured set. Most metadata fields
// (`tags`, `viewStatus`, `videoNumber`, …) come back null today; the
// renderer falls back gracefully so the carousel still has key-art +
// title + subtitle to work with.
interface WireFeaturedRow {
  id: number | null;
  projectId: number;
  videoBanner: string | null;
  contact: string | null;
  viewStatus: number | null;
  tags: string | null;
  creator: string | null;
  title: string | null;
  introduction: string | null;
  ipInfo: unknown;
  message: unknown;
  videoNumber: number | null;
  createTime: string | null;
  updateTime: string | null;
  review: unknown;
}

function mapFeaturedRow(row: WireFeaturedRow): FeaturedSlide {
  return {
    id: String(row.projectId),
    title: row.title ?? "",
    subtitle: row.creator ?? "",
    eyebrow: "",
    description: row.introduction ?? "",
    keyArt: ipImageUrl(row.videoBanner),
    tags: splitTags(row.tags),
    episodes: row.videoNumber ?? 0,
  };
}

async function fetchPlazaFeatured(): Promise<FeaturedSlide[]> {
  const res = await fetch("/project/featured/list", {
    method: "POST",
    credentials: "include",
    headers: { "accept-language": acceptLanguage(), Authorization: bearerHeader() },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { code: number; data?: WireFeaturedRow[] };
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows.map(mapFeaturedRow);
}

// Wire shape from `/project/foryou/list` — same as `/project/list`.
interface WireForYouRow {
  id: number | null;
  projectId: number;
  title: string | null;
  introduction: string | null;
  creator: string | null;
  videoBanner: string | null;
  contact: string | null;
  tags: string | null;
  viewStatus: number | null;
  videoNumber?: number | null;
  createTime: string | null;
}

function mapForYouRow(row: WireForYouRow): RailItem {
  return {
    id: String(row.projectId),
    title: row.title ?? "",
    cover: ipImageUrl(row.videoBanner),
    // Rail card hides the "N episodes" line when count is 0, so a
    // missing field on the wire degrades quietly.
    episodes: row.videoNumber ?? 0,
  };
}

async function fetchPlazaForYou(
  page: number,
  pageSize: number
): Promise<{ list: RailItem[]; total: number }> {
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const res = await fetch(`/project/foryou/list?${qs.toString()}`, {
    method: "POST",
    credentials: "include",
    headers: { "accept-language": acceptLanguage(), Authorization: bearerHeader() },
  });
  if (!res.ok) return { list: [], total: 0 };
  const json = (await res.json()) as {
    code: number;
    data?: WireForYouRow[];
    sum?: number;
  };
  const rows = Array.isArray(json.data) ? json.data : [];
  return { list: rows.map(mapForYouRow), total: json.sum ?? rows.length };
}

export function usePlazaFeatured() {
  return useQuery<FeaturedSlide[]>({
    queryKey: ipKeys.plazaFeatured,
    queryFn: fetchPlazaFeatured,
    staleTime: 1000 * 60 * 5,
  });
}

export function usePlazaForYou(params?: { page?: number; pageSize?: number }) {
  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 10;
  return useQuery<{ list: RailItem[]; total: number }>({
    queryKey: ipKeys.plazaForYou(page, pageSize),
    queryFn: () => fetchPlazaForYou(page, pageSize),
  });
}
