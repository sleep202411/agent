import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";

vi.mock("@/lib/admin-api", () => ({
  adminApiUrl: (path: string) => `http://server/admin${path}`,
  adminCookiePath: () => "/admin",
}));
const origin = "http://localhost/api/admin/creator-revenue";
afterEach(() => vi.unstubAllGlobals());
it.each(["members", "contracts", "distributions"])(
  "forwards scoped %s reads with cursor and session",
  async (kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"code":200,"data":{}}')));
    const request = new NextRequest(`${origin}?after=cursor`, {
      headers: { cookie: "fd_admin_session=fixture" },
    });
    const response = await GET(request, {
      params: Promise.resolve({ path: ["crews", "crew", kind] }),
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`http://server/admin/creator-revenue/crews/crew/${kind}?after=cursor`);
    expect(new Headers(init?.headers).get("cookie")).toBe("fd_admin_session=fixture");
    expect(init?.signal).toBe(request.signal);
  }
);
it("preserves multipart PDF bytes and boundary without forwarding a client destination", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response('{"code":200,"data":{}}', { status: 201 }))
  );
  const form = new FormData();
  form.set("crewId", "crew");
  form.set(
    "file",
    new Blob(["%PDF-1.7\nfixture\n%%EOF"], { type: "application/pdf" }),
    "contract.pdf"
  );
  const request = new NextRequest(origin, { method: "POST", body: form });
  const original = await request.clone().arrayBuffer();
  const response = await POST(request, { params: Promise.resolve({ path: ["contracts"] }) });
  expect(response.status).toBe(201);
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe("http://server/admin/creator-revenue/contracts");
  expect(new Headers(init?.headers).get("content-type")).toBe(request.headers.get("content-type"));
  expect(new Uint8Array(init?.body as Uint8Array)).toEqual(new Uint8Array(original));
});
it("forwards only UUID-addressed receipt reads with private cache policy", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"code":200,"data":{}}')));
  const id = "11111111-1111-4111-8111-111111111111";
  const result = await GET(new NextRequest(origin), {
    params: Promise.resolve({ path: ["distributions", id] }),
  });
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
    `http://server/admin/creator-revenue/distributions/${id}`
  );
  expect(
    (
      await GET(new NextRequest(origin), {
        params: Promise.resolve({ path: ["distributions", "invalid"] }),
      })
    ).status
  ).toBe(404);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("preserves exact allocation JSON and conflict details", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(new Response('{"message":"Different allocation terms"}', { status: 409 }))
  );
  const body = JSON.stringify({ requestId: "same-retry", amountMinor: "9007199254740993" });
  const response = await POST(
    new NextRequest(origin, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ path: ["distributions"] }) }
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ message: "Different allocation terms" });
  expect(new TextDecoder().decode(vi.mocked(fetch).mock.calls[0][1]?.body as Uint8Array)).toBe(
    body
  );
});
it("enforces the byte limit even without a Content-Length header", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const response = await POST(
    new NextRequest(origin, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(256 * 1024 + 1),
    }),
    { params: Promise.resolve({ path: ["distributions"] }) }
  );
  expect(response.status).toBe(413);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects wrong upload content types and oversized declared uploads before upstream access", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const params = Promise.resolve({ path: ["contracts"] });
  const wrong = await POST(new NextRequest(origin, { method: "POST", body: "{}" }), { params });
  expect(wrong.status).toBe(415);
  const huge = await POST(
    new NextRequest(origin, {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=fixture",
        "content-length": "999999999",
      },
      body: "fixture",
    }),
    { params }
  );
  expect(huge.status).toBe(413);
  expect(fetch).not.toHaveBeenCalled();
});
it.each([["crews", "../other", "members"], ["contracts"], ["crews", "crew", "bank"]])(
  "rejects unapproved read paths %j",
  async (...path) => {
    vi.stubGlobal("fetch", vi.fn());
    const response = await GET(new NextRequest(origin), { params: Promise.resolve({ path }) });
    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  }
);

it("forwards global revenue history filters with private caching", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"code":200,"data":{}}')));
  const query = "q=license&currency=USD&recordedFrom=2026-10-01&recordedThrough=2026-10-05";
  const response = await GET(new NextRequest(`${origin}?${query}`), {
    params: Promise.resolve({ path: ["distributions"] }),
  });
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
    `http://server/admin/creator-revenue/distributions?${query}`
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("forwards private draft reads and versioned saves", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => Promise.resolve(new Response('{"code":200,"data":{}}')))
  );
  const params = Promise.resolve({ path: ["crews", "crew", "draft"] });
  const read = await GET(new NextRequest(origin), { params });
  expect(read.headers.get("cache-control")).toBe("private, no-store");
  const body = JSON.stringify({ revision: 2, data: null });
  const save = await POST(
    new NextRequest(origin, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
    { params }
  );
  expect(save.status).toBe(200);
  expect(vi.mocked(fetch).mock.calls[1][0]).toBe(
    "http://server/admin/creator-revenue/crews/crew/draft"
  );
  expect(new TextDecoder().decode(vi.mocked(fetch).mock.calls[1][1]?.body as Uint8Array)).toBe(
    body
  );
});
