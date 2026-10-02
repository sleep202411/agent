import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
vi.mock("@/lib/admin-api", () => ({
  adminApiUrl: (p: string) => `http://server/admin${p}`,
  adminCookiePath: () => "/admin",
}));
const id = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const base = "http://localhost/api/admin/interactive-film-playback";
afterEach(() => vi.unstubAllGlobals());
const params = (parts: string[]) => ({ params: Promise.resolve({ parts }) });

it("forwards the overview read with its query, session and no cache", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response('{"code":"ADMIN_PERMISSION_DENIED"}', { status: 403 }))
  );
  const req = new NextRequest(`${base}?gameIds=${id},film_1&include=clips`, {
    headers: { cookie: "fd_admin_session=current" },
  });
  const res = await GET(req, params([]));
  expect(res.status).toBe(403);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  const [url, options] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe(
    `http://server/admin/interactive-film-playback?gameIds=${id},film_1&include=clips`
  );
  expect(options?.method).toBe("GET");
  expect(options?.signal).toBe(req.signal);
  expect(new Headers(options?.headers).get("cookie")).toBe("fd_admin_session=current");
});

it.each([
  [["reconcile"], "/interactive-film-playback/reconcile"],
  [["games", id, "retry-failed"], `/interactive-film-playback/games/${id}/retry-failed`],
])("forwards the %j mutation body exactly, without the query", async (parts, path) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ code: 200, data: { outcome: "already_running" } }))
  );
  const req = new NextRequest(`${base}?ignored=1`, {
    method: "POST",
    body: "{}",
    headers: { cookie: "fd_admin_session=current" },
  });
  const res = await POST(req, params(parts));
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  const [url, options] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe(`http://server/admin${path}`);
  expect(options?.body).toBe("{}");
  expect(new Headers(options?.headers).get("content-type")).toBe("application/json");
});

it.each([
  ["GET", ["reconcile"]],
  ["GET", ["games", id, "retry-failed"]],
  ["POST", []],
  ["POST", ["games", "not-a-uuid", "retry-failed"]],
  ["POST", ["games", id]],
  ["POST", ["games", id, "retry-failed", "extra"]],
  ["POST", ["reconcile", "now"]],
] as const)("rejects %s %j without upstream access", async (method, parts) => {
  vi.stubGlobal("fetch", vi.fn());
  const req = new NextRequest(base, { method, ...(method === "POST" ? { body: "{}" } : {}) });
  const res = await (method === "GET" ? GET : POST)(req, params([...parts]));
  expect(res.status).toBe(404);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(fetch).not.toHaveBeenCalled();
});

it("reports a lost upstream as unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Lost response")));
  const res = await POST(
    new NextRequest(base, { method: "POST", body: "{}" }),
    params(["reconcile"])
  );
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  await expect(res.json()).resolves.toMatchObject({ msg: "后台服务暂时不可用，请稍后重试。" });
});
