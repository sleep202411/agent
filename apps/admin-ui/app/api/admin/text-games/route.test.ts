import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminSession } from "@/lib/admin-session";
import { getReviewingTextGames } from "@/lib/admin-text-games";
import { GET } from "./route";

vi.mock("@/lib/admin-session", () => ({ getAdminSession: vi.fn() }));
vi.mock("@/lib/admin-text-games", () => ({ getReviewingTextGames: vi.fn() }));

function session(permissions: string[]) {
  return { user: { permissions } } as never;
}

describe("admin text-game queue route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated requests before calling Java", async () => {
    vi.mocked(getAdminSession).mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(getReviewingTextGames).not.toHaveBeenCalled();
  });

  it("requires ip.moderate before calling Java", async () => {
    vi.mocked(getAdminSession).mockResolvedValue(session(["ip.read"]));
    const response = await GET();
    expect(response.status).toBe(403);
    expect(getReviewingTextGames).not.toHaveBeenCalled();
  });

  it("returns the Java queue to an authorized moderator", async () => {
    vi.mocked(getAdminSession).mockResolvedValue(session(["ip.moderate"]));
    vi.mocked(getReviewingTextGames).mockResolvedValue([]);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ code: 200, msg: "成功", data: [] });
  });
});
