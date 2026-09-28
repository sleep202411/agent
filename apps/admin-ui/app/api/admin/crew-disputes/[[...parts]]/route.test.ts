import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
vi.mock("@/lib/admin-api", () => ({
  adminApiUrl: (p: string) => `http://server/admin${p}`,
  adminCookiePath: () => "/admin",
}));
const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());
it.each([[], [id], [id, "attachments"], [id, "attachments", id, "read"]])(
  "forwards allowed read %j with session, query and no cache",
  async (...parts) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"message":"Denied"}', { status: 403 }))
    );
    const req = new NextRequest("http://localhost/api/admin/crew-disputes?limit=20&beforeId=x", {
      headers: { cookie: "fd_admin_session=current" },
    });
    const res = await GET(req, { params: Promise.resolve({ parts }) });
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(
      `http://server/admin/crew-disputes${parts.length ? "/" + parts.join("/") : ""}?limit=20&beforeId=x`
    );
    expect(options?.signal).toBe(req.signal);
    expect(new Headers(options?.headers).get("cookie")).toBe("fd_admin_session=current");
  }
);
it("forwards exact mutation body and credentials, preserving response status", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response('{"message":"Stale"}', { status: 409 }))
  );
  const body = JSON.stringify({
    requestKey: id,
    expectedVersion: 3,
    action: "resolve",
    message: "Reason",
  });
  const req = new NextRequest("http://localhost/api/admin/crew-disputes", {
    method: "POST",
    body,
    headers: { cookie: "fd_admin_session=current" },
  });
  const res = await POST(req, { params: Promise.resolve({ parts: [id, "events"] }) });
  expect(res.status).toBe(409);
  expect(vi.mocked(fetch).mock.calls[0][1]?.body).toBe(body);
});
it.each([["other"], [id, "upload"], [id, "attachments", id], [id, "events", "extra"]])(
  "rejects unsupported paths %j without upstream access",
  async (...parts) => {
    vi.stubGlobal("fetch", vi.fn());
    const req = new NextRequest("http://localhost/api/admin/crew-disputes");
    expect((await GET(req, { params: Promise.resolve({ parts }) })).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  }
);
it("reports interrupted writes as unavailable for identical-request recovery", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Lost response")));
  const res = await POST(
    new NextRequest("http://localhost/api/admin/crew-disputes", { method: "POST", body: "{}" }),
    { params: Promise.resolve({ parts: [id, "events"] }) }
  );
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
});
