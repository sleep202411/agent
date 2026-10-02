import { beforeEach, expect, it, vi } from "vitest";
import { searchGps, type GpsSearchOptions } from "./search-api";
import {
  EMPTY_GPS_DRAFT,
  normalizeGpsDraft,
  gpsDraftUrl,
  gpsDraftFromUrl,
  readGpsLink,
} from "./search-draft";
const h = vi.hoisted(() => ({ post: vi.fn(), generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  hash = "a".repeat(64);
const query = normalizeGpsDraft(EMPTY_GPS_DRAFT, "en-US").data!;
const card = {
  id,
  creatorId: "owner",
  title: "IP",
  roomNumber: "123",
  summary: "Story",
  coverUrl: null,
  matched: true,
  locationSource: "unknown",
  locations: [],
  eras: [],
  episode: null,
};
const options: GpsSearchOptions = {
  coordinateSystem: "WGS84",
  selectedIpId: null,
  placeSearch: "",
};
const scope = { viewerId: null, generation: 1 },
  signal = () => new AbortController().signal;
const result = () => ({
  requestId: id,
  queryId: hash,
  query,
  nextCursor: null,
  items: [card],
  selected: null,
  matchedCount: 1,
  accessibleCount: 2,
  countScope: "accessible_ips_with_published_translation",
  mapScope: { coordinateSystem: "WGS84", west: -180, east: 180, south: -90, north: 90 },
  mapIpCount: 1,
  mapMatchedIpCount: 1,
  places: [],
  placeCount: 0,
  placesTruncated: false,
  clusters: [],
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.post.mockResolvedValue(result());
});
it("sends the official guest contract and includes credentials only for a signed-in viewer", async () => {
  const s = signal();
  expect((await searchGps(scope, query, null, id, s, options)).accessibleCount).toBe(2);
  expect(h.post).toHaveBeenCalledExactlyOnceWith("/ip-commerce/content-gps/search", {
    service: "aurora",
    signal: s,
    retry: false,
    credentials: "omit",
    data: {
      requestId: id,
      query,
      cursor: null,
      limit: 20,
      selectedIpId: null,
      placeSearch: "",
      map: result().mapScope,
    },
  });
  await searchGps({ ...scope, viewerId: "owner" }, query, null, id, s, options);
  expect(h.post.mock.calls[1][1].credentials).toBe("include");
});
it("rejects swapped response scopes, duplicate results and broken cursors", async () => {
  for (const patch of [
    { requestId: other },
    { query: { ...query, genreCodes: ["changed"] } },
    { mapScope: { ...result().mapScope, coordinateSystem: "GCJ02" } },
    { selected: card },
    { items: [card, card] },
    { items: [{ ...card, matched: false }] },
    { matchedCount: 3 },
    { nextCursor: { afterId: other, queryId: hash } },
    { nextCursor: { afterId: id, queryId: "b".repeat(64) } },
  ]) {
    h.post.mockResolvedValueOnce({ ...result(), ...patch });
    await expect(searchGps(scope, query, null, id, signal(), options)).rejects.toThrow("changed");
  }
  await expect(
    searchGps(scope, query, { afterId: other, queryId: "b".repeat(64) }, id, signal(), options)
  ).rejects.toThrow("changed");
});
it("keeps separately selected out-of-filter IPs and accepts an unavailable selection without inventing it", async () => {
  h.post.mockResolvedValueOnce({ ...result(), selected: { ...card, id: other, matched: false } });
  expect(
    (await searchGps(scope, query, null, id, signal(), { ...options, selectedIpId: other }))
      .selected?.matched
  ).toBe(false);
  expect(
    (await searchGps(scope, query, null, id, signal(), { ...options, selectedIpId: other }))
      .selected
  ).toBeNull();
});
it("refuses invalid input or aborted sessions before sending and rejects late account replies", async () => {
  const c = new AbortController();
  c.abort();
  await expect(searchGps(scope, query, null, id, c.signal, options)).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
  await expect(
    searchGps(
      scope,
      { ...query, duration: { unit: "episode", maxSeconds: 0, unknown: "exclude" } },
      null,
      id,
      signal(),
      options
    )
  ).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
  h.post.mockImplementationOnce(async () => {
    h.generation = 2;
    return result();
  });
  await expect(searchGps(scope, query, null, id, signal(), options)).rejects.toThrow("expired");
});
it("preserves official year-zero chronology, opaque places and all advanced conditions through links", () => {
  const draft = {
    ...EMPTY_GPS_DRAFT,
    places: ["label:Singapore", "provider:place"],
    genres: ["drama"],
    startYear: "-100",
    endYear: "0",
    maxSeconds: "120",
    locationKind: "production_origin",
    locationRelation: "all",
    eraRelation: "contained",
    durationUnit: "episode",
    unknownDuration: "include_labelled",
  };
  expect(gpsDraftFromUrl(new URLSearchParams(gpsDraftUrl(draft)))).toEqual(draft);
  expect(normalizeGpsDraft(draft, "zh-CN")).toMatchObject({
    success: true,
    data: {
      locale: "zh-CN",
      location: { kind: "production_origin", relation: "all" },
      era: {
        startYear: -100,
        endYear: 0,
        calendar: "proleptic_gregorian_astronomical",
        relation: "contained",
      },
      duration: { unit: "episode", maxSeconds: 120, unknown: "include_labelled" },
    },
  });
  for (const patch of [
    { startYear: "2", endYear: "1" },
    { startYear: "2", endYear: "" },
    { maxSeconds: "1.5" },
    { maxSeconds: "0" },
    { places: Array.from({ length: 9 }, (_, i) => String(i)) },
  ])
    expect(normalizeGpsDraft({ ...draft, ...patch }, "en-US").success).toBe(false);
});
it("permits repeated list filters but blocks ambiguous single-value conditions or invalid selection", () => {
  expect(
    readGpsLink({ place: ["a", "b"], genre: ["a", "b"], mood: ["calm"], selected: other }).invalid
  ).toBe(false);
  expect(readGpsLink({ from: ["1", "2"] }).invalid).toBe(true);
  expect(readGpsLink({ selected: "not-an-ip" }).invalid).toBe(true);
  expect(readGpsLink({ selected: [id, other] }).invalid).toBe(true);
});

it("requests the visible viewport and rejects stale bounds or coordinate mismatches", async () => {
  for (const coordinateSystem of ["WGS84", "GCJ02"] as const) {
    const viewport = { coordinateSystem, west: 170, east: -170, south: -20, north: 20 };
    h.post.mockResolvedValueOnce({ ...result(), mapScope: viewport });
    await searchGps(scope, query, null, id, signal(), { ...options, coordinateSystem, viewport });
    expect(h.post.mock.lastCall?.[1].data).toMatchObject({ query, map: viewport });
    h.post.mockResolvedValueOnce(result());
    await expect(
      searchGps(scope, query, null, id, signal(), {
        ...options,
        coordinateSystem,
        viewport,
      })
    ).rejects.toThrow("changed");
  }
});
it("rejects invalid bounds and regional coordinate mismatch before dispatch", async () => {
  for (const patch of [
    { west: 0, east: 0 },
    { south: 20, north: 10 },
    { west: NaN },
    { east: 181 },
    { coordinateSystem: "GCJ02" },
  ]) {
    await expect(
      searchGps(scope, query, null, id, signal(), {
        ...options,
        viewport: { ...result().mapScope, ...patch } as never,
      })
    ).rejects.toThrow();
  }
  expect(h.post).not.toHaveBeenCalled();
});
