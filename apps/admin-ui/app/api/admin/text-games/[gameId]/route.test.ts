import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getAdminSession } from "@/lib/admin-session";
import { getAdminTextGameDetail, transitionAdminTextGame } from "@/lib/admin-text-games";
import { GET, POST } from "./route";

vi.mock("@/lib/admin-session", () => ({ getAdminSession: vi.fn() }));
vi.mock("@/lib/admin-text-games", () => ({
  getAdminTextGameDetail: vi.fn(),
  transitionAdminTextGame: vi.fn(),
}));

const GAME_ID = "tg_0123456789abcdef";
const detail = { gameId: GAME_ID, status: "published" } as never;

function session(permissions: string[]) {
  return { user: { permissions } } as never;
}

function context(gameId: string) {
  return { params: Promise.resolve({ gameId }) };
}

describe("admin text-game detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdminSession).mockResolvedValue(session(["ip.moderate"]));
  });

  it("rejects invalid work ids without calling Java", async () => {
    const response = await GET(new NextRequest("http://localhost/api"), context("invalid"));
    expect(response.status).toBe(400);
    expect(getAdminTextGameDetail).not.toHaveBeenCalled();
  });

  it("rejects malformed moderation actions without calling Java", async () => {
    const request = new NextRequest("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "reject", reason: "  " }),
      headers: { "content-type": "application/json" },
    });
    const response = await POST(request, context(GAME_ID));
    expect(response.status).toBe(400);
    expect(transitionAdminTextGame).not.toHaveBeenCalled();
  });

  it("forwards a validated moderation action for an authorized moderator", async () => {
    vi.mocked(transitionAdminTextGame).mockResolvedValue(detail);
    const request = new NextRequest("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ action: "approve" }),
      headers: { "content-type": "application/json" },
    });
    const response = await POST(request, context(GAME_ID));
    expect(response.status).toBe(200);
    expect(transitionAdminTextGame).toHaveBeenCalledWith(GAME_ID, { action: "approve" });
  });
});
