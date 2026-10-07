import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
vi.mock("@/lib/admin-api", () => ({
  adminApiUrl: (p: string) => `http://server/admin${p}`,
  adminCookiePath: () => "/admin",
}));
const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());
it("relays only the task release API with session and exact amount strings", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"code":200,"data":{}}')));
  const body = JSON.stringify({ expectedAmountMinor: "9007199254740993", fundsReceived: true });
  const request = new NextRequest("http://localhost/api/admin/task-payments", {
    method: "POST",
    headers: { cookie: "fd_admin_session=fixture", "content-type": "application/json" },
    body,
  });
  const response = await POST(request, { params: Promise.resolve({ path: [id, "release"] }) });
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe(`http://server/admin/task-payments/${id}/release`);
  expect(new Headers(init?.headers).get("cookie")).toBe("fd_admin_session=fixture");
  expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe(body);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("rejects arbitrary upstream routes and oversized bodies", async () => {
  vi.stubGlobal("fetch", vi.fn());
  expect(
    (
      await GET(new NextRequest("http://localhost"), {
        params: Promise.resolve({ path: ["users"] }),
      })
    ).status
  ).toBe(404);
  expect(
    (
      await POST(new NextRequest("http://localhost", { method: "POST", body: "x".repeat(65537) }), {
        params: Promise.resolve({ path: [id, "release"] }),
      })
    ).status
  ).toBe(413);
  expect(fetch).not.toHaveBeenCalled();
});
