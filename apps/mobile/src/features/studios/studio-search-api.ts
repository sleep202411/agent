import {
  CreatorDiscoveryQuerySchema,
  CreatorDiscoveryRequestSchema,
  CreatorDiscoveryResultSchema,
  type CreatorDiscoveryRequest,
  type CreatorDiscoveryResult,
} from "@repo/shared/creator-location";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
export type StudioQuery = CreatorDiscoveryRequest["query"];
export type StudioPage = CreatorDiscoveryResult;
export type StudioViewport = NonNullable<CreatorDiscoveryRequest["map"]>;
export type StudioScope = { generation: number; viewerId: string | null };
export const emptyStudioQuery: StudioQuery = {
  basedIn: null,
  serves: null,
  remoteOnly: false,
  availableForWork: false,
  category: null,
  text: "",
};
export class StudioSearchChanged extends Error {}
function current(scope: StudioScope, signal: AbortSignal) {
  if (signal.aborted || getAuthGeneration() !== scope.generation)
    throw new Error("Studio search session expired.");
}
export function parseStudioQuery(value: unknown) {
  return CreatorDiscoveryQuerySchema.safeParse(value);
}
export async function searchStudios(
  scope: StudioScope,
  query: StudioQuery,
  cursor: StudioPage["nextCursor"],
  requestId: string,
  signal: AbortSignal,
  selectedCreatorId: string | null = null,
  viewport: StudioViewport | null = null
) {
  current(scope, signal);
  const data = CreatorDiscoveryRequestSchema.parse({
    requestId,
    query,
    cursor,
    selectedCreatorId,
    map: viewport,
    limit: 20,
  });
  const parsed = CreatorDiscoveryResultSchema.safeParse(
    await api.post("/creator-location/search", {
      service: "aurora",
      signal,
      retry: false,
      credentials: scope.viewerId ? "include" : "omit",
      data,
    })
  );
  current(scope, signal);
  if (!parsed.success)
    throw new StudioSearchChanged("Invalid studio search response. Please retry.");
  const page = parsed.data;
  if (
    page.requestId !== data.requestId ||
    JSON.stringify(page.query) !== JSON.stringify(data.query) ||
    (cursor && cursor.queryId !== page.queryId) ||
    (page.selected !== null && page.selected.id !== selectedCreatorId) ||
    JSON.stringify(page.map?.viewport ?? null) !== JSON.stringify(data.map) ||
    (page.map !== null &&
      (page.map.creatorCount > page.accessibleCount ||
        page.map.matchedCreatorCount > page.map.creatorCount ||
        page.map.matchedCreatorCount > page.matchedCount ||
        page.map.clusters.some(
          (cluster) =>
            cluster.creatorId !== null &&
            [page.selected, ...page.items].some(
              (item) => item?.id === cluster.creatorId && !item.showOnMap
            )
        ))) ||
    page.island.matchedCreatorCount > page.island.creatorCount ||
    page.items.length > data.limit ||
    page.matchedCount > page.accessibleCount ||
    page.items.length > page.matchedCount ||
    page.items.some((item) => !item.matched) ||
    new Set(page.items.map((item) => item.id)).size !== page.items.length ||
    (page.nextCursor &&
      (page.nextCursor.queryId !== page.queryId ||
        page.nextCursor.afterId === cursor?.afterId ||
        page.nextCursor.afterId !== page.items.at(-1)?.id))
  )
    throw new StudioSearchChanged(
      "The studio search response does not match this request. Please retry."
    );
  return {
    ...page,
    selected:
      page.selected && !page.selected.showOnMap
        ? { ...page.selected, basedIn: null, point: null }
        : page.selected,
    items: page.items.map((item) =>
      item.showOnMap ? item : { ...item, basedIn: null, point: null }
    ),
  };
}
