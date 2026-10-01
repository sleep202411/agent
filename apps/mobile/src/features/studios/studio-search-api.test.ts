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
