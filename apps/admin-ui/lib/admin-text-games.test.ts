import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAdminTextGameDetail,
  getReviewingTextGames,
  transitionAdminTextGame,
} from "./admin-text-games";

vi.mock("server-only", () => ({}));

const JAVA_URL = "https://java.example.test";
const GAME_ID = "tg_0123456789abcdef";

function envelope(data: unknown, code = 200, msg = "成功", status = 200): Response {
  return Response.json({ code, msg, data }, { status });
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("accepts only reviewing works in the moderation queue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        envelope([
          {
            gameId: GAME_ID,
            name: "World",
            posterUrl: null,
            synopsis: null,
            status: "reviewing",
            updatedAt: "2026-08-09T12:00:00Z",
          },
        ])
      )
    );
    await expect(getReviewingTextGames()).resolves.toHaveLength(1);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        envelope([
          {
            gameId: GAME_ID,
            name: "World",
            posterUrl: null,
            synopsis: null,
            status: "published",
            updatedAt: "2026-08-09T12:00:00Z",
          },
        ])
      )
    );
    await expect(getReviewingTextGames()).rejects.toThrow("非审核中");
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
      `${JAVA_URL}/api/boss/text-game/${GAME_ID}/status`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "approve" }),
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

  it("surfaces Java business errors verbatim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope(null, 409, "作品状态已变化"))
    );
    await expect(getAdminTextGameDetail(GAME_ID)).rejects.toThrow("作品状态已变化");
  });
});
