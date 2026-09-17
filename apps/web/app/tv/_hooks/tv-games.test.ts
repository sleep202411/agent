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

it("retains catalog artwork and rejects unsafe image URLs", () => {
  expect(
    parseTvGames("interactive-film", [{ ...film, coverUrl: "https://example.com/cover.jpg" }])[0]
      ?.coverUrl
  ).toBe("https://example.com/cover.jpg");
  const row = {
    gameId: "tg_1234567890123456",
    name: "Story",
    posterUrl: "https://example.com/poster.jpg",
    synopsis: null,
    status: "published",
  };
  expect(parseTvGames("text-game", [row])[0]?.coverUrl).toBe(row.posterUrl);
  expect(
    parseTvGames("text-game", [{ ...row, posterUrl: "javascript:alert(1)" }])[0]?.coverUrl
  ).toBeUndefined();
});

it("retains published films with historical offline timestamps or absent artwork", () => {
  const rows = parseTvGames("interactive-film", [
    {
      ...film,
      gameId: "jinling",
      title: "Jinling",
      status: "published",
      offlineAt: "2026-08-25T18:12:24+08:00",
      coverUrl: null,
    },
    { ...film, gameId: "offline", status: "offline" },
  ]);
  expect(rows.map((row) => row.id)).toEqual(["interactive-film:jinling"]);
});

it("keeps the publishing user identity without guessing it from a title or image", () => {
  expect(parseTvGames("interactive-film", [{ ...film, creatorId: 13425 }])[0]?.creatorId).toBe(
    "13425"
  );
  for (const creatorId of [null, "", -1, 1.5, {}, "../users", Number.MAX_SAFE_INTEGER + 1]) {
    expect(
      parseTvGames("interactive-film", [{ ...film, creatorId }])[0]?.creatorId
    ).toBeUndefined();
  }
});
