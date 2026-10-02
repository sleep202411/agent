import {
  ContentGpsSearchRequestSchema,
  ContentGpsSearchResultSchema,
  type ContentGpsQuery,
  type ContentGpsSearchResult,
} from "@repo/shared/content-gps";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
export type GpsQuery = ContentGpsQuery;
export type GpsPage = ContentGpsSearchResult;
export type GpsSearchScope = { generation: number; viewerId: string | null };
export type GpsViewport = GpsPage["mapScope"];
export type GpsSearchOptions = {
  selectedIpId: string | null;
  placeSearch: string;
  coordinateSystem: "WGS84" | "GCJ02";
  viewport?: GpsViewport;
};
export class GpsSearchChanged extends Error {}
function current(scope: GpsSearchScope, signal: AbortSignal) {
  if (signal.aborted || getAuthGeneration() !== scope.generation)
    throw Error("IP search session expired.");
}
export async function searchGps(
  scope: GpsSearchScope,
  query: GpsQuery,
  cursor: GpsPage["nextCursor"],
  requestId: string,
  signal: AbortSignal,
  options: GpsSearchOptions
) {
  current(scope, signal);
  if (options.viewport && options.viewport.coordinateSystem !== options.coordinateSystem)
    throw new GpsSearchChanged("The map coordinate system does not match this region.");
  const data = ContentGpsSearchRequestSchema.parse({
    requestId,
    query,
    cursor,
    limit: 20,
    selectedIpId: options.selectedIpId,
    placeSearch: options.placeSearch,
    map: options.viewport ?? {
      coordinateSystem: options.coordinateSystem,
      west: -180,
      east: 180,
      south: -90,
      north: 90,
    },
  });
  const parsed = ContentGpsSearchResultSchema.safeParse(
    await api.post("/ip-commerce/content-gps/search", {
      service: "aurora",
      signal,
      retry: false,
      credentials: scope.viewerId ? "include" : "omit",
      data,
    })
  );
  current(scope, signal);
  if (!parsed.success)
    throw new GpsSearchChanged("Invalid Content GPS response. Refresh the search.");
  const page = parsed.data;
  if (
    page.requestId !== data.requestId ||
    JSON.stringify(page.query) !== JSON.stringify(data.query) ||
    JSON.stringify(page.mapScope) !== JSON.stringify(data.map) ||
    (cursor && cursor.queryId !== page.queryId) ||
    (page.selected && page.selected.id !== options.selectedIpId) ||
    page.items.length > data.limit ||
    page.items.length > page.matchedCount ||
    page.matchedCount > page.accessibleCount ||
    page.mapIpCount > page.accessibleCount ||
    page.mapMatchedIpCount > page.mapIpCount ||
    page.items.some((item) => !item.matched) ||
    new Set(page.items.map((v) => v.id)).size !== page.items.length ||
    (page.nextCursor &&
      (page.nextCursor.queryId !== page.queryId ||
        page.nextCursor.afterId === cursor?.afterId ||
        page.nextCursor.afterId !== page.items.at(-1)?.id))
  )
    throw new GpsSearchChanged("Content GPS results changed. Refresh the search.");
  return page;
}
