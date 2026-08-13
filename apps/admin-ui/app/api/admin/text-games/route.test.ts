import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getAdminSession } from "@/lib/admin-session";
import { getAdminTextGames } from "@/lib/admin-text-games";
import { GET } from "./route";

vi.mock("@/lib/admin-session", () => ({ getAdminSession: vi.fn() }));
vi.mock("@/lib/admin-text-games", () => ({ getAdminTextGames: vi.fn() }));

function session(permissions: string[]) {
  return { user: { permissions } } as never;
}

describe("admin text-game list route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated requests before calling Java", async () => {
    vi.mocked(getAdminSession).mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/admin/text-games"));
    expect(response.status).toBe(401);
    expect(getAdminTextGames).not.toHaveBeenCalled();
  });

  it("rejects malformed filters and pagination", async () => {
    vi.mocked(getAdminSession).mockResolvedValue(session(["ip.moderate"]));
    const response = await GET(
      new NextRequest("http://localhost/api/admin/text-games?status=deleted&page=0")
    );
    expect(response.status).toBe(400);
    expect(getAdminTextGames).not.toHaveBeenCalled();
  });

  it("forwards validated filters to the Java admin catalogue", async () => {
    vi.mocked(getAdminSession).mockResolvedValue(session(["ip.moderate"]));
    vi.mocked(getAdminTextGames).mockResolvedValue({
      list: [],
      stats: { total: 0, draft: 0, reviewing: 0, published: 0, offline: 0 },
      total: 0,
    });
    const response = await GET(
      new NextRequest(
        "http://localhost/api/admin/text-games?status=reviewing&q=Mist&page=2&pageSize=10"
      )
    );

    expect(response.status).toBe(200);
    expect(getAdminTextGames).toHaveBeenCalledWith({
      status: "reviewing",
      q: "Mist",
      page: 2,
      pageSize: 10,
    });
  });
});
