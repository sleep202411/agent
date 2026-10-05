import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
vi.mock("@/lib/admin-api", () => ({
  adminApiUrl: (p: string) => `http://server/admin${p}`,
  adminCookiePath: () => "/admin",
}));
const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());
it("forwards creator/status filters and the session without allowing caching", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"code":200,"data":{}}')));
  const req = new NextRequest(
    "http://localhost/api/admin/creator-withdrawals?status=pending&userId=creator",
    { headers: { cookie: "fd_admin_session=current" } }
  );
  const res = await GET(req, { params: Promise.resolve({}) });
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  const [url, options] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe("http://server/admin/creator-withdrawals?status=pending&userId=creator");
  expect(new Headers(options?.headers).get("cookie")).toBe("fd_admin_session=current");
  expect(options?.signal).toBe(req.signal);
});
it.each(["recipient", "decision"])(
  "forwards exact %s writes and preserves upstream errors",
  async (action) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"message":"Changed"}', { status: 409 }))
    );
    const body = JSON.stringify({ action: "pay", expectedVersion: 2, paymentReference: "fixture" });
    const res = await POST(
      new NextRequest("http://localhost/api/admin/creator-withdrawals", { method: "POST", body }),
      { params: Promise.resolve({ path: [id, action] }) }
    );
    expect(res.status).toBe(409);
    expect(new TextDecoder().decode(vi.mocked(fetch).mock.calls[0][1]?.body as Uint8Array)).toBe(
      body
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  }
);
it.each([["other"], [id, "recipient"], [id, "decision", "extra"]])(
  "rejects unsupported reads %j",
  async (...path) => {
    vi.stubGlobal("fetch", vi.fn());
    expect(
      (
        await GET(new NextRequest("http://localhost/api/admin/creator-withdrawals"), {
          params: Promise.resolve({ path }),
        })
      ).status
    ).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  }
);
it("does not cache unavailable bank-detail responses", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unavailable")));
  const res = await POST(
    new NextRequest("http://localhost/api/admin/creator-withdrawals", {
      method: "POST",
      body: "{}",
    }),
    { params: Promise.resolve({ path: [id, "recipient"] }) }
  );
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
});

it("forwards filtered exports through the finance session without caching", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response('{"code":200,"data":{"csv":"fixture"}}'))
  );
  const response = await GET(
    new NextRequest(
      "http://localhost/api/admin/creator-withdrawals/export?currency=USD&minAmountMinor=29&from=2026-10-01",
      { headers: { cookie: "fd_admin_session=current" } }
    ),
    { params: Promise.resolve({ path: ["export"] }) }
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
    "http://server/admin/creator-withdrawals/export?currency=USD&minAmountMinor=29&from=2026-10-01"
  );
});

it("preserves multipart bytes and boundary for private proof uploads", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"code":200}')));
  const form = new FormData();
  form.set("file", new Blob(["%PDF-1.7\n%%EOF"], { type: "application/pdf" }), "proof.pdf");
  const req = new NextRequest("http://localhost/api/admin/creator-withdrawals", {
    method: "POST",
    body: form,
  });
  const type = req.headers.get("content-type");
  const res = await POST(req, { params: Promise.resolve({ path: [id, "proofs"] }) });
  expect(res.status).toBe(200);
  const [url, options] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe(`http://server/admin/creator-withdrawals/${id}/proofs`);
  expect(new Headers(options?.headers).get("content-type")).toBe(type);
  expect(new TextDecoder().decode(options?.body as Uint8Array)).toContain("%PDF-1.7");
});
it("rejects oversized proof uploads before forwarding", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const res = await POST(
    new NextRequest("http://localhost/api/admin/creator-withdrawals", {
      method: "POST",
      body: "fixture",
      headers: {
        "content-type": "multipart/form-data; boundary=fixture",
        "content-length": String(11 * 1024 * 1024),
      },
    }),
    { params: Promise.resolve({ path: [id, "proofs"] }) }
  );
  expect(res.status).toBe(413);
  expect(fetch).not.toHaveBeenCalled();
});
it("forwards only a withdrawal-scoped proof download", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"code":200}')));
  const res = await POST(
    new NextRequest("http://localhost/api/admin/creator-withdrawals", {
      method: "POST",
      body: "{}",
    }),
    { params: Promise.resolve({ path: [id, "proofs", id, "download"] }) }
  );
  expect(res.status).toBe(200);
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
    `http://server/admin/creator-withdrawals/${id}/proofs/${id}/download`
  );
});
