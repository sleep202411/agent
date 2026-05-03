/**
 * Plaza homepage data: Featured carousel + For You rail (P1).
 *
 *   - `usePlazaFeatured`  — POST /project/featured/list (queryFeaturedProject)
 *   - `usePlazaForYou`    — GET /project/plaza/for-you?page=&pageSize=
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

async function fetchPlazaForYou(
  page: number,
  pageSize: number
): Promise<{ list: RailItem[]; total: number }> {
  const res = await fetch(`/project/plaza/for-you?page=${page}&pageSize=${pageSize}`, {
    credentials: "include",
    headers: { "accept-language": acceptLanguage(), Authorization: bearerHeader() },
  });
  if (!res.ok) return { list: [], total: 0 };
  const json = (await res.json()) as {
    code: number;
    data: { list: RailItem[]; total: number };
  };
  return { list: json.data?.list ?? [], total: json.data?.total ?? 0 };
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
