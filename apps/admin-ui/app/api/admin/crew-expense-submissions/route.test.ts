import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
vi.mock("@/lib/admin-api", () => ({
  adminApiUrl: (path: string) => `http://server/admin${path}`,
  adminCookiePath: () => "/",
}));
afterEach(() => vi.unstubAllGlobals());
it("forwards the current credentials, cursor and cancellation while preventing caching", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"code":403}', { status: 403 })));
  const request = new NextRequest(
    "http://localhost/api/admin/crew-expense-submissions?after=cursor&limit=50",
    { headers: { cookie: "session=current" } }
  );
  const result = await GET(request);
  expect(result.status).toBe(403);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  const [url, options] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe("http://server/admin/crew-expense-submissions?after=cursor&limit=50");
  expect(options?.signal).toBe(request.signal);
  expect(new Headers(options?.headers).get("cookie")).toBe("session=current");
});
it("returns a recoverable response when the upstream body fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("Interrupted body"));
          },
        })
      )
    )
  );
  const result = await GET(new NextRequest("http://localhost/api/admin/crew-expense-submissions"));
  expect(result.status).toBe(503);
});
