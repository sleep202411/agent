import { beforeEach, expect, it, vi } from "vitest";
import { loadGameCatalogue } from "./game-catalogue";
const h = vi.hoisted(() => ({ films: vi.fn(), texts: vi.fn() }));
vi.mock("./interactive-film-api", () => ({ listPublishedInteractiveFilms: h.films }));
vi.mock("./text-game-api", () => ({ listPublishedTextGames: h.texts }));
beforeEach(() => {
  vi.resetAllMocks();
  h.films.mockResolvedValue([{ gameId: "film", title: "Film" }]);
  h.texts.mockResolvedValue([
    { gameId: "tg_0123456789abcdef", name: "World", synopsis: "Explore", posterUrl: null },
  ]);
});
it("keeps both kinds with distinct navigation targets", async () => {
  const result = await loadGameCatalogue(new AbortController().signal);
  expect(result.games.map((row) => row.kind)).toEqual(["film", "text"]);
  expect(result.games[0]).toMatchObject({ film: { gameId: "film" } });
  expect(result.games[1]).toMatchObject({ gameId: "tg_0123456789abcdef", title: "World" });
  expect(result.warnings).toEqual([]);
});
it("preserves film browsing if the text service fails", async () => {
  h.texts.mockRejectedValue(new Error("Text service unavailable"));
  const result = await loadGameCatalogue(new AbortController().signal);
  expect(result.games.map((row) => row.gameId)).toEqual(["film"]);
  expect(result.warnings).toEqual(["Text service unavailable"]);
});
it("preserves text browsing if the film service fails", async () => {
  h.films.mockRejectedValue(new Error("Film service unavailable"));
  const result = await loadGameCatalogue(new AbortController().signal);
  expect(result.games[0]?.kind).toBe("text");
  expect(result.warnings).toEqual(["Film service unavailable"]);
});
it("reports both failures and ignores aborted partial results", async () => {
  h.films.mockRejectedValue(new Error("film failed"));
  h.texts.mockRejectedValue(new Error("text failed"));
  await expect(loadGameCatalogue(new AbortController().signal)).rejects.toThrow(
    "film failed\ntext failed"
  );
  const c = new AbortController();
  h.films.mockImplementation(async () => {
    c.abort();
    return [];
  });
  h.texts.mockResolvedValue([]);
  await expect(loadGameCatalogue(c.signal)).rejects.toThrow();
});
