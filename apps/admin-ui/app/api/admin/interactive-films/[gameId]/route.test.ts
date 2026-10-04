import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  getAdminInteractiveFilmDetail,
  transitionAdminInteractiveFilm,
} from "@/lib/admin-interactive-films";
import { getAdminSession } from "@/lib/admin-session";
import { GET, POST } from "./route";

vi.mock("@/lib/admin-session", () => ({ getAdminSession: vi.fn() }));
vi.mock("@/lib/admin-interactive-films", () => ({
  getAdminInteractiveFilmDetail: vi.fn(),
  transitionAdminInteractiveFilm: vi.fn(),
}));

const GAME_ID = "film_0123456789abcdef";
const game = { gameId: GAME_ID, title: "迷雾车站", status: "published" } as never;

function session(permissions: string[]) {
  return { user: { permissions } } as never;
}

function context(gameId: string) {
  return { params: Promise.resolve({ gameId }) };
}

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/interactive-films/id", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("admin interactive-film detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdminSession).mockResolvedValue(session(["ip.moderate"]));
  });

  it("requires authentication and ip.moderate", async () => {
    vi.mocked(getAdminSession).mockResolvedValueOnce(null);
    expect((await POST(post({ action: "approve" }), context(GAME_ID))).status).toBe(401);

    vi.mocked(getAdminSession).mockResolvedValueOnce(session(["ip.read"]));
    expect((await POST(post({ action: "approve" }), context(GAME_ID))).status).toBe(403);
    expect(transitionAdminInteractiveFilm).not.toHaveBeenCalled();
  });

  it("rejects invalid ids and undocumented action fields", async () => {
    expect((await POST(post({ action: "approve" }), context("bad id"))).status).toBe(400);
    expect((await POST(post({ action: "reject", reason: "   " }), context(GAME_ID))).status).toBe(
      400
    );
    expect(
      (await POST(post({ action: "offline", expectedVersion: "release_1" }), context(GAME_ID)))
        .status
    ).toBe(400);
    expect(transitionAdminInteractiveFilm).not.toHaveBeenCalled();
  });

  it("forwards documented actions and trims rejection reasons", async () => {
    vi.mocked(transitionAdminInteractiveFilm).mockResolvedValue(game);

    expect((await POST(post({ action: "approve" }), context(GAME_ID))).status).toBe(200);
    expect(transitionAdminInteractiveFilm).toHaveBeenLastCalledWith(GAME_ID, {
      action: "approve",
    });

    expect(
      (await POST(post({ action: "reject", reason: "  封面不合规  " }), context(GAME_ID))).status
    ).toBe(200);
    expect(transitionAdminInteractiveFilm).toHaveBeenLastCalledWith(GAME_ID, {
      action: "reject",
      reason: "封面不合规",
    });
  });

  it("returns the upstream error message unchanged", async () => {
    vi.mocked(transitionAdminInteractiveFilm).mockRejectedValue(new Error("作品状态已变化"));
    const response = await POST(post({ action: "offline" }), context(GAME_ID));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ msg: "作品状态已变化" });
  });

  it("reads fresh moderation state with the same permission for approval preflight", async () => {
    vi.mocked(getAdminSession).mockResolvedValueOnce(session(["ip.read"]));
    expect((await GET(post(null), context(GAME_ID))).status).toBe(403);
    expect(getAdminInteractiveFilmDetail).not.toHaveBeenCalled();
    vi.mocked(getAdminInteractiveFilmDetail).mockResolvedValue(game);
    const response = await GET(post(null), context(GAME_ID));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(getAdminInteractiveFilmDetail).toHaveBeenCalledWith(GAME_ID);
    expect(transitionAdminInteractiveFilm).not.toHaveBeenCalled();
  });
});
