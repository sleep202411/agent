"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  ContentGpsSearchRequestSchema,
  ContentGpsSearchResultSchema,
  type ContentGpsQuery,
  type ContentGpsSearchRequest,
  type ContentGpsSearchResult,
} from "@repo/shared/content-gps";
import { api } from "@/src/lib/api";
import type { GpsViewport } from "../_data/content-gps-map-types";

/** Compare validated objects without depending on JSON property insertion order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export async function fetchContentGpsSearch(
  input: ContentGpsSearchRequest,
  viewerId: string | null,
  signal: AbortSignal,
  mismatchMessage: string
): Promise<ContentGpsSearchResult> {
  const request = ContentGpsSearchRequestSchema.parse(input);
  const result = ContentGpsSearchResultSchema.parse(
    await api.post("/aurora/ip-commerce/content-gps/search", {
      data: request,
      signal,
      credentials: viewerId ? "include" : "omit",
    })
  );
  if (
    result.requestId !== request.requestId ||
    canonical(result.query) !== canonical(request.query) ||
    canonical(result.mapScope) !== canonical(request.map) ||
    (request.cursor && request.cursor.queryId !== result.queryId) ||
    (result.nextCursor && result.nextCursor.queryId !== result.queryId) ||
    (result.selected && result.selected.id !== request.selectedIpId) ||
    result.items.some((item) => !item.matched)
  )
    throw new Error(mismatchMessage);
  return result;
}

export function useContentGpsCards(
  query: ContentGpsQuery,
  viewerId: string | null,
  coordinateSystem: GpsViewport["coordinateSystem"],
  mismatchMessage: string
) {
  return useInfiniteQuery({
    queryKey: ["content-gps-cards", viewerId, query, coordinateSystem],
    initialPageParam: null as ContentGpsSearchResult["nextCursor"],
    queryFn: ({ pageParam, signal }) =>
      fetchContentGpsSearch(
        {
          requestId: crypto.randomUUID(),
          query,
          cursor: pageParam,
          limit: 20,
          selectedIpId: null,
          placeSearch: "",
          map: { coordinateSystem, west: -180, east: 180, south: -90, north: 90 },
        },
        viewerId,
        signal,
        mismatchMessage
      ),
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Viewport and selection refresh independently of the paginated card feed. */
export function useContentGpsOverview(
  query: ContentGpsQuery,
  viewerId: string | null,
  map: GpsViewport,
  selectedIpId: string | null,
  placeSearch: string,
  mismatchMessage: string
) {
  return useQuery({
    queryKey: ["content-gps-overview", viewerId, query, map, selectedIpId, placeSearch],
    queryFn: ({ signal }) =>
      fetchContentGpsSearch(
        {
          requestId: crypto.randomUUID(),
          query,
          cursor: null,
          limit: 1,
          selectedIpId,
          placeSearch,
          map,
        },
        viewerId,
        signal,
        mismatchMessage
      ),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export function gpsResponsesAgree(
  pages: ContentGpsSearchResult[] | undefined,
  overview: ContentGpsSearchResult | undefined
): boolean {
  return Boolean(
    pages?.length && overview && pages.every((page) => page.queryId === overview.queryId)
  );
}

export function useContentGpsGenres(locale: string) {
  return useQuery({
    queryKey: ["content-gps-genres", locale],
    queryFn: ({ signal }) =>
      api.get<{ items: { code: string; label: string }[] }>("/aurora/ip-commerce/taxonomy", {
        params: { type: "genre", locale },
        signal,
      }),
    retry: false,
  });
}
