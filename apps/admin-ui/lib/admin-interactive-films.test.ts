import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAdminInteractiveFilmDetail,
  getAdminInteractiveFilms,
  transitionAdminInteractiveFilm,
} from "./admin-interactive-films";

vi.mock("server-only", () => ({}));

const JAVA_URL = "https://java.example.test/studio";
const API_TOKEN = "interactive-film-admin-token";
const GAME_ID = "film_0123456789abcdef";
const DRAFT_VERSION = "release_2";

function envelope(data: unknown, code = 200, msg = "成功", status = 200): Response {
  return Response.json({ code, msg, data }, { status });
}

function summary(status: "draft" | "reviewing" | "published" | "offline" = "reviewing") {
  return {
    gameId: GAME_ID,
    title: "迷雾车站",
    subtitle: "一场会改写记忆的旅程",
    coverUrl: "https://cdn.example.test/cover.jpg",
    status,
    draftVersion: DRAFT_VERSION,
    currentVersion: status === "published" ? DRAFT_VERSION : undefined,
    updatedAt: "2026-08-29T12:00:00Z",
  };
}

function detail(status: "draft" | "reviewing" | "published" | "offline" = "reviewing") {
  return {
    ...summary(status),
    creatorId: 42,
    rejectReason: status === "draft" ? "请更换封面" : undefined,
    draftManifestUrl: `https://cdn.example.test/${DRAFT_VERSION}/manifest.json`,
    manifestUrl:
      status === "published"
        ? `https://cdn.example.test/${DRAFT_VERSION}/manifest.json`
        : undefined,
    createdAt: "2026-08-20T09:00:00Z",
    publishedAt: status === "published" ? "2026-08-29T12:00:00Z" : undefined,
    offlineAt: status === "offline" ? "2026-08-29T13:00:00Z" : undefined,
  };
}

describe("admin interactive-film Java boundary", () => {
  beforeEach(() => {
    vi.stubEnv("TEXT_GAME_API_BASE_URL", JAVA_URL);
    vi.stubEnv("JAVA_ADMIN_API_TOKEN", API_TOKEN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("queries Java directly with server-only authentication", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        envelope({
          list: [summary("published")],
          stats: { total: "10", draft: "2", reviewing: "3", published: "4", offline: "1" },
          total: "1",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getAdminInteractiveFilms({ status: "published", q: " 迷雾 ", page: 2, pageSize: 10 })
    ).resolves.toMatchObject({
      total: 1,
      stats: { total: 10, draft: 2, reviewing: 3, published: 4, offline: 1 },
      list: [{ status: "published" }],
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `${JAVA_URL}/api/admin/interactive-film/reviewing?status=published&page=2&pageSize=10&q=${encodeURIComponent("迷雾")}`
    );
    expect(new Headers(init?.headers).get("X-Admin-Api-Token")).toBe(API_TOKEN);
  });

  it("normalises optional detail fields and checks the returned project id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope(detail()))
    );
    await expect(getAdminInteractiveFilmDetail(GAME_ID)).resolves.toMatchObject({
      gameId: GAME_ID,
      creatorId: "42",
      rejectReason: null,
      publishedAt: null,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope({ ...detail(), gameId: "film_different" }))
    );
    await expect(getAdminInteractiveFilmDetail(GAME_ID)).rejects.toThrow("但请求的是");
  });

  it("rejects unsafe manifest URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        envelope({ ...detail(), draftManifestUrl: "javascript:alert(document.cookie)" })
      )
    );
    await expect(getAdminInteractiveFilmDetail(GAME_ID)).rejects.toThrow("draftManifestUrl");
  });

  it.each([
    { action: { action: "approve" } as const, next: "published" as const },
    {
      action: { action: "reject", reason: "封面不合规" } as const,
      next: "draft" as const,
    },
    { action: { action: "offline" } as const, next: "offline" as const },
  ])(
    "posts the documented $action.action action and re-reads Java state",
    async ({ action, next }) => {
      const fetchMock = vi
        .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
        .mockResolvedValueOnce(envelope({}))
        .mockResolvedValueOnce(envelope(detail(next)));
      vi.stubGlobal("fetch", fetchMock);

      await expect(transitionAdminInteractiveFilm(GAME_ID, action)).resolves.toMatchObject({
        status: next,
      });
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        `${JAVA_URL}/api/admin/interactive-film/${GAME_ID}/status`
      );
      expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(action));
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        `${JAVA_URL}/api/admin/interactive-film/${GAME_ID}`
      );
    }
  );

  it("rejects invalid list bounds before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getAdminInteractiveFilms({ pageSize: 101 })).rejects.toThrow("分页参数无效");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the existing Java Studio URL and admin token configuration", async () => {
    vi.stubEnv("TEXT_GAME_API_BASE_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getAdminInteractiveFilmDetail(GAME_ID)).rejects.toThrow("TEXT_GAME_API_BASE_URL");

    vi.stubEnv("TEXT_GAME_API_BASE_URL", JAVA_URL);
    vi.stubEnv("JAVA_ADMIN_API_TOKEN", "");
    await expect(getAdminInteractiveFilmDetail(GAME_ID)).rejects.toThrow("JAVA_ADMIN_API_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces Java business errors verbatim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope(null, 409, "作品状态已变化"))
    );
    await expect(getAdminInteractiveFilmDetail(GAME_ID)).rejects.toThrow("作品状态已变化");
  });
});
