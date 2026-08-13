import { describe, expect, it, vi } from "vitest";
import { getPublishedTextGame, listPublishedTextGames, TextGameLoadError } from "./text-game-api";

vi.mock("server-only", () => ({}));

const JAVA_URL = "https://java.example.test";
const GAME_ID = "tg_0123456789abcdef";

function envelope(data: unknown, code = 200, msg = "ok", status = 200): Response {
  return Response.json({ code, msg, data }, { status });
}

function detail(status: "draft" | "reviewing" | "published" | "offline" = "published") {
  return {
    gameId: GAME_ID,
    projectId: null,
    status,
    rejectReason: null,
    draftVersionId: "1",
    publishedVersionId: "1",
    publishedAt: "2026-08-09T12:00:00Z",
    offlineAt: null,
    createdAt: "2026-08-09T12:00:00Z",
    updatedAt: "2026-08-09T12:00:00Z",
    content: {
      versionId: "1",
      versionNo: 1,
      name: "World",
      posterUrl: "https://cdn.example.com/poster.jpg",
      synopsis: "Synopsis",
      worldviewDocxUrl: null,
      bgmUrl: null,
      characters: [],
      stillUrls: [],
    },
  };
}

describe("published text-game API", () => {
  it("loads a published catalogue from Java", async () => {
    const fetcher = vi.fn(async () =>
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
    );

    await expect(
      listPublishedTextGames({ fetcher, javaStudioUrl: JAVA_URL })
    ).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(`${JAVA_URL}/api/player/text-game`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  });

  it("rejects non-published data at the player boundary", async () => {
    const listFetcher = vi.fn(async () =>
      envelope([
        {
          gameId: GAME_ID,
          name: "World",
          posterUrl: null,
          synopsis: null,
          status: "draft",
          updatedAt: "2026-08-09T12:00:00Z",
        },
      ])
    );
    await expect(
      listPublishedTextGames({ fetcher: listFetcher, javaStudioUrl: JAVA_URL })
    ).rejects.toThrow("non-published");

    const detailFetcher = vi.fn(async () => envelope(detail("offline")));
    await expect(
      getPublishedTextGame(GAME_ID, { fetcher: detailFetcher, javaStudioUrl: JAVA_URL })
    ).rejects.toThrow("non-published");
  });

  it("identity-checks player detail responses", async () => {
    const fetcher = vi.fn(async () => envelope({ ...detail(), gameId: "tg_fedcba9876543210" }));
    await expect(
      getPublishedTextGame(GAME_ID, { fetcher, javaStudioUrl: JAVA_URL })
    ).rejects.toThrow("while");
  });

  it("rejects a player response that exposes the creator's private document", async () => {
    const fetcher = vi.fn(async () =>
      envelope({
        ...detail(),
        content: {
          ...detail().content,
          worldviewDocxUrl: "https://cdn.example.com/private-world.docx",
        },
      })
    );
    await expect(
      getPublishedTextGame(GAME_ID, { fetcher, javaStudioUrl: JAVA_URL })
    ).rejects.toThrow("private worldview document");
  });

  it("preserves Java's business error message and code", async () => {
    const fetcher = vi.fn(async () => envelope(null, 409, "作品已下架"));
    await expect(
      getPublishedTextGame(GAME_ID, { fetcher, javaStudioUrl: JAVA_URL })
    ).rejects.toMatchObject({
      name: TextGameLoadError.name,
      message: "作品已下架",
      status: 409,
    });
  });
});
