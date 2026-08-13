import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAdminTextGameDetail,
  getAdminTextGames,
  transitionAdminTextGame,
} from "./admin-text-games";

vi.mock("server-only", () => ({}));

const JAVA_URL = "https://java.example.test";
const API_TOKEN = "text-game-admin-token";
const GAME_ID = "tg_0123456789abcdef";

function envelope(data: unknown, code = 200, msg = "成功", status = 200): Response {
  return Response.json({ code, msg, data }, { status });
}

function summary(status: "draft" | "reviewing" | "published" | "offline" = "reviewing") {
  return {
    gameId: GAME_ID,
    name: "World",
    posterUrl: null,
    synopsis: null,
    status,
    updatedAt: "2026-08-09T12:00:00Z",
  };
}

function detail(status: "draft" | "reviewing" | "published" | "offline" = "reviewing") {
  return {
    gameId: GAME_ID,
    projectId: null,
    status,
    rejectReason: null,
    draftVersionId: "1",
    publishedVersionId: status === "published" ? "1" : null,
    publishedAt: status === "published" ? "2026-08-09T12:00:00Z" : null,
    offlineAt: status === "offline" ? "2026-08-09T12:00:00Z" : null,
    createdAt: "2026-08-09T12:00:00Z",
    updatedAt: "2026-08-09T12:00:00Z",
    content: {
      versionId: "1",
      versionNo: 1,
      name: "World",
      posterUrl: "https://cdn.example.com/poster.jpg",
      synopsis: "Synopsis",
      worldviewDocxUrl: "https://cdn.example.com/world.docx",
      bgmUrl: null,
      characters: [],
      stillUrls: [],
    },
  };
}

describe("admin text-game Java boundary", () => {
  beforeEach(() => {
    vi.stubEnv("TEXT_GAME_API_BASE_URL", JAVA_URL);
    vi.stubEnv("JAVA_ADMIN_API_TOKEN", API_TOKEN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("forwards server-side filters and parses the paginated all-status catalogue", async () => {
    const fetchMock = vi.fn(async () =>
      envelope({
        list: [summary("published")],
        stats: { total: 10, draft: 2, reviewing: 3, published: 4, offline: 1 },
        total: 1,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getAdminTextGames({ status: "published", q: " World ", page: 2, pageSize: 10 })
    ).resolves.toMatchObject({ total: 1, stats: { total: 10 }, list: [{ status: "published" }] });

    expect(fetchMock).toHaveBeenCalledWith(
      `${JAVA_URL}/api/admin/text-game/reviewing?status=published&page=2&pageSize=10&q=World`,
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Admin-Api-Token": API_TOKEN }),
      })
    );
  });

  it("identity-checks moderation detail responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope({ ...detail(), gameId: "tg_fedcba9876543210" }))
    );
    await expect(getAdminTextGameDetail(GAME_ID)).rejects.toThrow("但请求的是");
  });

  it("validates the status returned by every moderation transition", async () => {
    const fetchMock = vi.fn(async () => envelope(detail("published")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(transitionAdminTextGame(GAME_ID, { action: "approve" })).resolves.toMatchObject({
      status: "published",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${JAVA_URL}/api/admin/text-game/${GAME_ID}/status`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "approve" }),
        headers: expect.objectContaining({ "X-Admin-Api-Token": API_TOKEN }),
      })
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope(detail("reviewing")))
    );
    await expect(
      transitionAdminTextGame(GAME_ID, { action: "reject", reason: "需要修改封面" })
    ).rejects.toThrow("预期为 draft");
  });

  it("fails before network access when the Java admin token is missing", async () => {
    vi.stubEnv("JAVA_ADMIN_API_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAdminTextGameDetail(GAME_ID)).rejects.toThrow("JAVA_ADMIN_API_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces Java business errors verbatim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope(null, 400, "作品状态已变化"))
    );
    await expect(getAdminTextGameDetail(GAME_ID)).rejects.toThrow("作品状态已变化");
  });
});
