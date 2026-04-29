/**
 * Plaza homepage data: Featured carousel + For You rail (P1).
 *
 *   - `usePlazaFeatured`  — GET /project/plaza/featured
 *   - `usePlazaForYou`    — GET /project/plaza/for-you?page=&pageSize=
 */

import { useQuery } from "@tanstack/react-query";
import { acceptLanguage, bearerHeader, ipKeys } from "./shared";
import type { FeaturedSlide, RailItem } from "./types";

async function fetchPlazaFeatured(): Promise<FeaturedSlide[]> {
  const res = await fetch("/project/plaza/featured", {
    credentials: "include",
    headers: { "accept-language": acceptLanguage(), Authorization: bearerHeader() },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    code: number;
    data: { list: FeaturedSlide[] } | FeaturedSlide[];
  };
  if (Array.isArray(json.data)) return json.data;
  return json.data?.list ?? [];
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
