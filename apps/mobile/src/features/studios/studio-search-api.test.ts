import { beforeEach, expect, it, vi } from "vitest";
import { emptyStudioQuery, searchStudios, parseStudioQuery } from "./studio-search-api";
const h = vi.hoisted(() => ({ post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const scope = { generation: 1, viewerId: null },
  requestId = "11111111-1111-4111-8111-111111111111",
  queryId = "a".repeat(64);
const card = {
  id: "1",
  name: "Studio",
  avatarUrl: "",
  openToWork: true,
  matched: true,
  basedIn: { countryCode: "SG", city: "Singapore" },
  serves: [],
  remote: true,
  showOnMap: true,
  point: null,
  serviceCount: 2,
  matchingServiceCount: 1,
};
const result = () => ({
  requestId,
  queryId,
  query: emptyStudioQuery,
  items: [card],
  selected: null,
  nextCursor: null,
  matchedCount: 1,
  accessibleCount: 2,
  requiresLogin: false,
  island: { creatorCount: 0, matchedCreatorCount: 0 },
  countScope: "public_platform_creators_with_listed_services",
  map: null,
});
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.post.mockResolvedValue(result());
});
it("sends the official guest POST search contract without retries and retains authoritative counts", async () => {
  const s = signal();
  expect((await searchStudios(scope, emptyStudioQuery, null, requestId, s)).matchedCount).toBe(1);
  expect(h.post).toHaveBeenCalledExactlyOnceWith("/creator-location/search", {
    service: "aurora",
    signal: s,
    retry: false,
    credentials: "omit",
    data: {
      requestId,
      query: emptyStudioQuery,
      cursor: null,
      selectedCreatorId: null,
      map: null,
      limit: 20,
    },
  });
  await searchStudios({ ...scope, viewerId: "viewer" }, emptyStudioQuery, null, requestId, s);
  expect(h.post.mock.calls[1][1].credentials).toBe("include");
});
it("rejects malformed filters before dispatch and normalizes official text/city fields", async () => {
  expect(
    parseStudioQuery({
      ...emptyStudioQuery,
      text: "  Film  ",
      basedIn: { countryCode: "SG", city: " Singapore " },
    })
  ).toMatchObject({ success: true, data: { text: "Film", basedIn: { city: "Singapore" } } });
  for (const query of [
    { ...emptyStudioQuery, category: "unknown" },
    { ...emptyStudioQuery, basedIn: { countryCode: "", city: "Tokyo" } },
    { ...emptyStudioQuery, text: "a".repeat(121) },
  ])
    await expect(searchStudios(scope, query as never, null, requestId, signal())).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects swapped receipts, query scopes, duplicate rows, unrequested selection/map and invalid next cursors", async () => {
  for (const patch of [
    { requestId: "22222222-2222-4222-8222-222222222222" },
    { query: { ...emptyStudioQuery, text: "changed" } },
    { items: [card, card] },
    { items: [{ ...card, matched: false }] },
    { selected: card },
    { nextCursor: { afterId: "other", queryId } },
    { nextCursor: { afterId: "1", queryId: "b".repeat(64) } },
  ]) {
    h.post.mockResolvedValueOnce({ ...result(), ...patch });
    await expect(searchStudios(scope, emptyStudioQuery, null, requestId, signal())).rejects.toThrow(
      "does not match"
    );
  }
  h.post.mockResolvedValueOnce(result());
  await expect(
    searchStudios(
      scope,
      emptyStudioQuery,
      { afterId: "0", queryId: "b".repeat(64) },
      requestId,
      signal()
    )
  ).rejects.toThrow("does not match");
});
it("never exposes an unconsented base city even if a response mistakenly contains it", async () => {
  h.post.mockResolvedValueOnce({ ...result(), items: [{ ...card, showOnMap: false }] });
  expect(
    (await searchStudios(scope, emptyStudioQuery, null, requestId, signal())).items[0].basedIn
  ).toBeNull();
});
it("aborts before dispatch and rejects late account results", async () => {
  const c = new AbortController();
  c.abort();
  await expect(searchStudios(scope, emptyStudioQuery, null, requestId, c.signal)).rejects.toThrow(
    "expired"
  );
  expect(h.post).not.toHaveBeenCalled();
  h.post.mockImplementationOnce(async () => {
    h.generation = 2;
    return result();
  });
  await expect(searchStudios(scope, emptyStudioQuery, null, requestId, signal())).rejects.toThrow(
    "expired"
  );
});
it("resolves the requested selected studio independently of filters and sanitizes its location", async () => {
  h.post.mockResolvedValueOnce({
    ...result(),
    selected: { ...card, id: "outside", matched: false, showOnMap: false },
  });
  const page = await searchStudios(scope, emptyStudioQuery, null, requestId, signal(), "outside");
  expect(h.post.mock.calls[0][1].data.selectedCreatorId).toBe("outside");
  expect(page.selected).toMatchObject({
    id: "outside",
    matched: false,
    basedIn: null,
    point: null,
  });
  expect(page.items).toHaveLength(1);
  h.post.mockResolvedValueOnce({ ...result(), selected: { ...card, id: "wrong" } });
  await expect(
    searchStudios(scope, emptyStudioQuery, null, requestId, signal(), "outside")
  ).rejects.toThrow("does not match");
  h.post.mockResolvedValueOnce(result());
  expect(
    (await searchStudios(scope, emptyStudioQuery, null, requestId, signal(), "missing")).selected
  ).toBeNull();
});

const viewport = {
  coordinateSystem: "WGS84" as const,
  west: 170,
  east: -170,
  south: -20,
  north: 20,
};
const mapResult = () => ({
  viewport,
  creatorCount: 1,
  matchedCreatorCount: 1,
  scope: "visible_creator_results",
  clusters: [
    { cell: "cell", matched: true, count: 1, creatorId: "1", latitude: 0, longitude: 175 },
  ],
});
it("accepts map results for the requested viewport without changing filters", async () => {
  for (const coordinateSystem of ["WGS84", "GCJ02"] as const) {
    const map = { ...mapResult(), viewport: { ...viewport, coordinateSystem } };
    h.post.mockResolvedValueOnce({ ...result(), map });
    const page = await searchStudios(
      scope,
      emptyStudioQuery,
      null,
      requestId,
      signal(),
      null,
      map.viewport
    );
    expect(page.map).toEqual(map);
    expect(h.post.mock.lastCall?.[1].data).toMatchObject({
      map: map.viewport,
      query: emptyStudioQuery,
    });
  }
});
it("rejects missing, unsolicited or stale map results and inconsistent counts", async () => {
  for (const map of [
    null,
    { ...mapResult(), viewport: { ...viewport, east: -160 } },
    { ...mapResult(), viewport: { ...viewport, coordinateSystem: "GCJ02" } },
    { ...mapResult(), creatorCount: 3 },
    { ...mapResult(), matchedCreatorCount: 2 },
  ]) {
    h.post.mockResolvedValueOnce({ ...result(), map });
    await expect(
      searchStudios(scope, emptyStudioQuery, null, requestId, signal(), null, viewport)
    ).rejects.toThrow("does not match");
  }
  h.post.mockResolvedValueOnce({ ...result(), map: mapResult() });
  await expect(searchStudios(scope, emptyStudioQuery, null, requestId, signal())).rejects.toThrow(
    "does not match"
  );
});
it("rejects identifiable map pins for creators who withheld map consent", async () => {
  for (const patch of [
    { items: [{ ...card, showOnMap: false }] },
    { items: [], selected: { ...card, showOnMap: false } },
  ]) {
    h.post.mockResolvedValueOnce({ ...result(), ...patch, map: mapResult() });
    await expect(
      searchStudios(scope, emptyStudioQuery, null, requestId, signal(), "1", viewport)
    ).rejects.toThrow("does not match");
  }
});
it("validates viewport bounds before sending a map request", async () => {
  for (const patch of [{ east: 181 }, { south: 30, north: 20 }, { west: 0, east: 0 }]) {
    await expect(
      searchStudios(scope, emptyStudioQuery, null, requestId, signal(), null, {
        ...viewport,
        ...patch,
      })
    ).rejects.toThrow();
  }
  expect(h.post).not.toHaveBeenCalled();
});

it("retains island counts for creators without services outside the normal studio result count", async () => {
  h.post.mockResolvedValue({ ...result(), island: { creatorCount: 10, matchedCreatorCount: 8 } });
  expect(
    (await searchStudios(scope, emptyStudioQuery, null, requestId, signal())).island.creatorCount
  ).toBe(10);
});
