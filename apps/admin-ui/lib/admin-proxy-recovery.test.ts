import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as overview } from "@/app/api/admin/billing/overview/route";
import { GET as refundList, POST as refundCreate } from "@/app/api/admin/billing/refunds/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { POST as logout } from "@/app/api/admin/auth/logout/route";
import { POST as moderate } from "@/app/api/admin/crews/[crewId]/moderation/route";
import { GET as catalog } from "@/app/api/admin/crew-delivery-catalog/route";
import { POST as catalogUpdate } from "@/app/api/admin/crew-delivery-catalog/[id]/route";
import { PATCH as stage } from "@/app/api/admin/ip-commerce/ips/[ipId]/production-stage/route";
vi.mock("@/lib/admin-api", () => ({
  adminApiUrl: (path: string) => `http://fixture.invalid/admin${path}`,
  adminCookiePath: () => "/console",
}));
const routes = [
  { name: "catalog", method: "GET", run: catalog },
  {
    name: "catalog-update",
    method: "POST",
    run: (request: NextRequest) =>
      catalogUpdate(request, { params: Promise.resolve({ id: "catalog" }) }),
  },
  {
    name: "stage",
    method: "PATCH",
    run: (request: NextRequest) => stage(request, { params: Promise.resolve({ ipId: "ip" }) }),
  },
  { name: "overview", method: "GET", run: overview },
  { name: "refund-list", method: "GET", run: refundList },
  { name: "refund-create", method: "POST", run: refundCreate },
  { name: "login", method: "POST", run: login },
  { name: "logout", method: "POST", run: logout },
  {
    name: "moderation",
    method: "POST",
    run: (request: NextRequest) =>
      moderate(request, { params: Promise.resolve({ crewId: "crew" }) }),
  },
];
afterEach(() => vi.unstubAllGlobals());
function request(method: string, signal?: AbortSignal) {
  return new NextRequest("http://localhost/api/admin/fixture?limit=30", {
    method,
    signal,
    headers: { cookie: "session=fixture", "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: "{}" }),
  });
}
for (const route of routes) {
  it(`${route.name}: forwards request cancellation and retains authorized request/response headers`, async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"code":200}', {
        headers: {
          "set-cookie": "session=updated; Path=/; HttpOnly",
          "cache-control": "no-store",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const req = request(route.method);
    const result = await route.run(req);
    expect(result.status).toBe(200);
    expect(fetchMock.mock.calls[0][1].signal).toBe(req.signal);
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("cookie")).toBe("session=fixture");
    expect(result.headers.get("set-cookie")).toContain("Path=/console");
  });
  it(`${route.name}: rejects abandoned requests before upstream dispatch`, async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    const result = await route.run(request(route.method, controller.signal));
    expect(result.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it(`${route.name}: catches failures while reading the upstream response body`, async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("Body failed"));
            },
          })
        )
      )
    );
    const result = await route.run(request(route.method));
    expect(result.status).toBe(503);
  });
}
it("abandons a stalled response body without relaying its late session cookie", async () => {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const upstream = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller;
      },
    }),
    { headers: { "set-cookie": "session=old; Path=/" } }
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstream));
  const controller = new AbortController();
  const result = login(request("POST", controller.signal));
  await vi.waitFor(() => expect(upstream.bodyUsed).toBe(true));
  controller.abort();
  const response = await result;
  expect(response.status).toBe(503);
  expect(response.headers.has("set-cookie")).toBe(false);
  body.enqueue(new TextEncoder().encode('{"code":200}'));
  body.close();
});
it("does not dispatch a moderation request abandoned during the route-parameter wait", async () => {
  let resolve!: (params: { crewId: string }) => void;
  const params = new Promise<{ crewId: string }>((yes) => {
    resolve = yes;
  });
  const controller = new AbortController();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const result = moderate(request("POST", controller.signal), { params });
  controller.abort();
  resolve({ crewId: "crew" });
  expect((await result).status).toBe(503);
  expect(fetchMock).not.toHaveBeenCalled();
});
