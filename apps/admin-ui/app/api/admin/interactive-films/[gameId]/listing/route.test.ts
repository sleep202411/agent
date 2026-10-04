import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getAdminSession } from "@/lib/admin-session";
import { adminFetch } from "@/lib/admin-route";
import { GET } from "./route";

vi.mock("@/lib/admin-session", () => ({ getAdminSession: vi.fn() }));
vi.mock("@/lib/admin-route", async (original) => ({
  ...(await original<typeof import("@/lib/admin-route")>()),
  adminFetch: vi.fn(),
}));
const GAME = "10000000-0000-4000-8000-000000000001";
const VERSION = "20000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ gameId: GAME }) };
function request(query = `contentVersion=${VERSION}`) {
  return new NextRequest(`http://localhost/api/admin/interactive-films/${GAME}/listing?${query}`, {
    headers: { cookie: "fd_admin_session=fixture" },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_API_BASE_URL", "https://nest.invalid/admin");
  vi.mocked(getAdminSession).mockResolvedValue({ user: { permissions: ["ip.moderate"] } } as never);
});

it("requires authenticated moderation permission before reading a candidate", async () => {
  vi.mocked(getAdminSession).mockResolvedValueOnce(null);
  expect((await GET(request(), context)).status).toBe(401);
  vi.mocked(getAdminSession).mockResolvedValueOnce({ user: { permissions: ["ip.read"] } } as never);
  expect((await GET(request(), context)).status).toBe(403);
  expect(adminFetch).not.toHaveBeenCalled();
});
it.each([
  "",
  "contentVersion=bad%20id",
  `contentVersion=${VERSION}&contentVersion=${VERSION}`,
  `contentVersion=${VERSION}&extra=1`,
])("rejects invalid or ambiguous queries (%s)", async (query) => {
  expect((await GET(request(query), context)).status).toBe(400);
  expect(adminFetch).not.toHaveBeenCalled();
});
it("forwards only the exact version with the session and relays upstream conflicts", async () => {
  vi.mocked(adminFetch).mockResolvedValue(
    Response.json({ code: 409, msg: "Candidate changed." }, { status: 409 })
  );
  const response = await GET(request(), context);
  expect(response.status).toBe(409);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ code: 409, msg: "Candidate changed." });
  const [originalRequest, url, options] = vi.mocked(adminFetch).mock.calls[0]!;
  expect(originalRequest).toBeInstanceOf(NextRequest);
  expect(url).toBe(
    `https://nest.invalid/admin/story-publications/${GAME}/listing?contentVersion=${VERSION}`
  );
  expect(new Headers(options?.headers).get("cookie")).toBe("fd_admin_session=fixture");
  expect(options?.method).toBe("GET");
  expect(options?.redirect).toBe("error");
});
