import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session" }) }) }));
vi.mock("./admin-api", () => ({
  ADMIN_SESSION_COOKIE: "admin",
  adminApiUrl: (path: string) => `https://admin.invalid${path}`,
  adminAuthHeaders: () => ({ authorization: "test" }),
  parseAdminEnvelope: async (response: Response) => (await response.json()).data,
}));
import { loadAdminHomework, loadAdminTeachingIncome } from "./admin-academy-learning";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("forwards the homework cursor even when a scoped page is empty", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ data: { items: [], nextCursor: "next" } })));
  vi.stubGlobal("fetch", fetcher);
  expect(await loadAdminHomework("submitted", "before")).toEqual({
    data: { items: [], nextCursor: "next" },
    error: null,
  });
  expect(fetcher.mock.calls[0][0]).toContain("status=submitted&after=before");
  expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
it.each([loadAdminHomework, loadAdminTeachingIncome])(
  "bounds Academy loaders and preserves failures for retry",
  async (load) => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Academy timed out")));
    expect(await load()).toEqual({ data: null, error: "Academy timed out" });
    expect(timeout).toHaveBeenCalledWith(15000);
  }
);
