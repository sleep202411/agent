import { beforeEach, expect, it, vi } from "vitest";
import { listPublishedInteractiveFilms } from "./interactive-film-api";
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get },
  ApiRequestError: class extends Error {},
}));
beforeEach(() => h.get.mockReset());
it("forwards cancellation without sending it as a catalog query parameter", async () => {
  const controller = new AbortController();
  h.get.mockResolvedValue([]);
  await expect(
    listPublishedInteractiveFilms({ page: 2, pageSize: 50, signal: controller.signal })
  ).resolves.toEqual([]);
  expect(h.get).toHaveBeenCalledWith("/api/player/interactive-film/games", {
    service: "studio",
    signal: controller.signal,
    params: { page: 2, pageSize: 50 },
  });
});
it("retains malformed-response rejection", async () => {
  h.get.mockResolvedValue({ games: [] });
  await expect(listPublishedInteractiveFilms()).rejects.toMatchObject({
    code: "JAVA_RESPONSE_INVALID",
  });
});

it("rejects obsolete chapter links to a standalone release instead of opening other content", async () => {
  const { loadPublishedInteractiveFilm } = await import("./interactive-film-api");
  h.get.mockResolvedValue({
    gameId: "film",
    title: "Film",
    coverUrl: null,
    currentVersion: "v1",
    manifestUrl: "https://example.com/manifest.json",
  });
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(JSON.stringify({ manifestType: "fizzdragon.experience" }), { status: 200 })
    );
  try {
    await expect(
      loadPublishedInteractiveFilm("film", { chapterId: "removed" })
    ).rejects.toMatchObject({ code: "CHAPTER_NOT_FOUND" });
  } finally {
    fetcher.mockRestore();
  }
});
it("does not download a release after its request is aborted", async () => {
  const { loadPublishedInteractiveFilm } = await import("./interactive-film-api");
  const c = new AbortController();
  h.get.mockImplementation(() => {
    c.abort();
    return {
      gameId: "film",
      title: "Film",
      coverUrl: null,
      currentVersion: "v1",
      manifestUrl: "https://example.com/manifest.json",
    };
  });
  const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    await expect(loadPublishedInteractiveFilm("film", { signal: c.signal })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
  }
});
