import { describe, expect, it } from "vitest";
import { parseTvGames } from "./tv-games";
const film = {
  gameId: "game-one",
  title: "Game one",
  currentVersion: "v1",
  updatedAt: "2026-07-16T16:17:58+08:00",
};
describe("published TV games", () => {
  it("accepts the public film contract and keeps game identity separate", () => {
    expect(parseTvGames("interactive-film", [film, film])).toEqual([
      {
        id: "interactive-film:game-one",
        title: "Game one",
        href: "/play/interactive-film/game-one",
      },
    ]);
  });
  it("does not turn explicit withdrawn or malformed films into channels", () => {
    expect(
      parseTvGames("interactive-film", [
        { ...film, status: "offline" },
        { ...film, offlineAt: "2026-01-01" },
        { ...film, currentVersion: null },
        null,
      ])
    ).toEqual([]);
    expect(() => parseTvGames("interactive-film", {})).toThrow();
  });
  it("requires published text games", () => {
    const row = {
      gameId: "tg_1234567890123456",
      name: "Adventure",
      posterUrl: null,
      synopsis: null,
      status: "published",
    };
    expect(parseTvGames("text-game", [row, { ...row, status: "draft" }])).toHaveLength(1);
    expect(() => parseTvGames("text-game", [{ ...row, gameId: "../ip" }])).toThrow();
  });
});
