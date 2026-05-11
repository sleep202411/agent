"use client";

import { useQuery } from "@tanstack/react-query";
import { backendApi, type Paginated } from "@/src/lib/api";

/**
 * Item shape returned by `/api/user/world/list/myproduct`.
 *
 * Java surfaces a flat list of the user's projects sorted by recency,
 * which is what the studio home preview wants — vs. the world-grouped
 * `useWorldsWithProducts` flow that powers the full /projects page.
 *
 * Only the fields the home preview reads are declared here; the
 * backend ships extras (adminUserId, sort, enable, selectedCase, aiId,
 * chapterLength, …) that the preview doesn't render.
 */
export interface MyProduct {
  id: string;
  name: string;
  imagePath: string;
  description: string | null;
  worldId: string;
  createTime?: string;
  updateTime?: string;
}

const myProductsKeys = {
  all: ["studio", "my-products"] as const,
  page: (page: number, pageSize: number) => [...myProductsKeys.all, { page, pageSize }] as const,
};

async function fetchMyProducts(page: number, pageSize: number) {
  return backendApi.post<Paginated<MyProduct>>("/api/user/world/list/myproduct", {
    data: { page, pageSize },
  });
}

/**
 * Recent-projects feed for the studio home preview. Defaults to the
 * first 8 items, sized so a wide layout shows one row of project cards
 * with a "View all →" link to the full /projects page.
 *
 * Pagination params go in the body — Swagger lists "No parameters"
 * but the response carries `{ page, totalCount, list }`, so the Java
 * controller does read them server-side. Sending sensible defaults
 * keeps the preview cheap.
 */
export function useMyProducts({
  page = 1,
  pageSize = 8,
}: { page?: number; pageSize?: number } = {}) {
  const query = useQuery({
    queryKey: myProductsKeys.page(page, pageSize),
    queryFn: () => fetchMyProducts(page, pageSize),
  });

  return {
    products: query.data?.list ?? [],
    totalCount: query.data?.totalCount ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
