import { beforeEach, expect, it, vi } from "vitest";
import { fetchIpStudios } from "./ip-studios-api";
const h = vi.hoisted(() => ({ post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const requestId = "11111111-1111-4111-8111-111111111111",
  ipId = "22222222-2222-4222-8222-222222222222",
  queryId = "a".repeat(64);
const item = {
  studio: {
    id: "studio",
    name: "Studio",
    avatarUrl: "",
    openToWork: true,
    matched: true,
    basedIn: null,
    serves: [],
    remote: true,
    showOnMap: false,
    point: null,
    serviceCount: 2,
    matchingServiceCount: 2,
  },
  roles: [{ role: "director", customRole: null }],
};
const page = {
  requestId,
  ipId,
  locale: "en-US",
  queryId,
  items: [item],
  nextCursor: null,
  requiresLogin: false,
};
const scope = { viewerId: null as string | null, generation: 1 };
const call = (
  viewerId: string | null = null,
  cursor: { queryId: string; afterId: string } | null = null,
  signal = new AbortController().signal
) => fetchIpStudios({ ...scope, viewerId }, ipId, "en-US", cursor, requestId, signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.post.mockResolvedValue(page);
});
it("uses the official guest relationship request without credentials or retries", async () => {
  expect(await call()).toEqual(page);
  expect(h.post).toHaveBeenCalledWith(
    "/ip-commerce/content-gps/studios",
    expect.objectContaining({
      credentials: "omit",
      retry: false,
      data: { requestId, ipId, locale: "en-US", limit: 20, cursor: null },
    })
  );
});
it("includes authentication for viewer-bound cursor requests", async () => {
  await call("viewer", { afterId: "previous", queryId });
  expect(h.post).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ credentials: "include" })
  );
});
it.each([
  { ipId: requestId },
  { requestId: ipId },
  { locale: "zh-CN" },
  { items: [item, item] },
  { nextCursor: { afterId: "wrong", queryId } },
  { nextCursor: { afterId: "studio", queryId: "b".repeat(64) } },
  { requiresLogin: true },
])("rejects mismatched signed-in relationship receipts %j", async (patch) => {
  h.post.mockResolvedValue({ ...page, ...patch });
  await expect(call("viewer")).rejects.toThrow();
});
it("rejects changed cursor scope and cursor loops", async () => {
  await expect(call("viewer", { queryId: "b".repeat(64), afterId: "previous" })).rejects.toThrow();
  h.post.mockResolvedValue({ ...page, nextCursor: { queryId, afterId: "studio" } });
  await expect(call("viewer", { queryId, afterId: "studio" })).rejects.toThrow();
});
it("allows the official 50-item guest preview and login prompt", async () => {
  h.post.mockResolvedValue({
    ...page,
    requiresLogin: true,
    items: Array.from({ length: 50 }, (_, i) => ({
      ...item,
      studio: { ...item.studio, id: String(i) },
    })),
  });
  expect((await call()).items).toHaveLength(50);
  await expect(call("viewer")).rejects.toThrow();
});
it("rejects guest pagination before dispatch", async () => {
  await expect(call(null, { queryId, afterId: "previous" })).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects stale sessions and aborted reads before dispatch", async () => {
  const c = new AbortController();
  c.abort();
  await expect(call(null, null, c.signal)).rejects.toThrow();
  h.generation = 2;
  await expect(call()).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects late responses after account change", async () => {
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return page;
  });
  await expect(call()).rejects.toThrow();
});
