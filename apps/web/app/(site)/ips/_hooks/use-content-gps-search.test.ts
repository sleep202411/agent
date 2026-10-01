import { beforeEach, expect, it, vi } from "vitest";
import type { ContentGpsSearchRequest, ContentGpsSearchResult } from "@repo/shared/content-gps";
import { fetchContentGpsSearch, gpsResponsesAgree } from "./use-content-gps-search";
vi.mock("@/src/lib/api", () => ({ api: { post: vi.fn() } }));
import { api } from "@/src/lib/api";
const request: ContentGpsSearchRequest = {
  requestId: "10000000-0000-4000-8000-000000000001",
  query: {
    schemaVersion: 1,
    locale: "en-US",
    location: null,
    era: null,
    duration: null,
    genreCodes: [],
    moodPreferences: [],
  },
  cursor: null,
  limit: 20,
  selectedIpId: null,
  placeSearch: "",
  map: { coordinateSystem: "WGS84", west: -180, east: 180, south: -90, north: 90 },
};
function response(): ContentGpsSearchResult {
  return {
    requestId: request.requestId,
    queryId: "a".repeat(64),
    query: request.query,
    nextCursor: null,
    items: [],
    selected: null,
    matchedCount: 0,
    accessibleCount: 0,
    countScope: "accessible_ips_with_published_translation",
    mapScope: request.map,
    mapIpCount: 0,
    mapMatchedIpCount: 0,
    places: [],
    placeCount: 0,
    placesTruncated: false,
    clusters: [],
  };
}
const signal = new AbortController().signal;
beforeEach(() => vi.resetAllMocks());
it("passes cancellation and guest credential isolation to the real transport boundary", async () => {
  vi.mocked(api.post).mockResolvedValue(response());
  await fetchContentGpsSearch(request, null, signal, "Mismatch");
  expect(api.post).toHaveBeenCalledWith("/aurora/ip-commerce/content-gps/search", {
    data: request,
    credentials: "omit",
    signal,
  });
  await fetchContentGpsSearch(request, "owner", signal, "Mismatch");
  expect(api.post).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ credentials: "include" })
  );
});
it.each(["request", "query", "map", "cursor"])(
  "rejects a mismatched %s before rendering",
  async (kind) => {
    const result = response();
    if (kind === "request") result.requestId = "10000000-0000-4000-8000-000000000002";
    if (kind === "query") result.query = { ...request.query, locale: "zh-CN" };
    if (kind === "map") result.mapScope = { ...request.map, west: 0 };
    if (kind === "cursor")
      result.nextCursor = { afterId: request.requestId, queryId: "b".repeat(64) };
    vi.mocked(api.post).mockResolvedValue(result);
    await expect(fetchContentGpsSearch(request, null, signal, "Mismatch")).rejects.toThrow(
      "Mismatch"
    );
  }
);
it("rejects a changed analysis version on a subsequent page", async () => {
  vi.mocked(api.post).mockResolvedValue(response());
  await expect(
    fetchContentGpsSearch(
      { ...request, cursor: { afterId: request.requestId, queryId: "b".repeat(64) } },
      null,
      signal,
      "Mismatch"
    )
  ).rejects.toThrow("Mismatch");
});
it("requires all pages and overview to share a query identity", () => {
  expect(gpsResponsesAgree([response()], response())).toBe(true);
  expect(
    gpsResponsesAgree([response(), { ...response(), queryId: "b".repeat(64) }], response())
  ).toBe(false);
  expect(gpsResponsesAgree(undefined, response())).toBe(false);
});
