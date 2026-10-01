import { beforeEach, expect, it, vi } from "vitest";
import { getPublishedTextGame, listPublishedTextGames } from "./text-game-api";
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
const gameId = "tg_0123456789abcdef";
const detail = {
  gameId,
  status: "published",
  draftVersionId: "1",
  publishedVersionId: "1",
  content: {
    versionId: "1",
    versionNo: 1,
    name: "World",
    worldviewDocxUrl: null,
    characters: [],
    stillUrls: [],
  },
};
const signal = () => new AbortController().signal;
beforeEach(() => vi.resetAllMocks());
it("loads the public catalogue without a creator-account requirement", async () => {
  h.get.mockResolvedValue([{ gameId, status: "published", name: "World" }]);
  expect((await listPublishedTextGames(signal()))[0]?.gameId).toBe(gameId);
  expect(h.get).toHaveBeenCalledWith("/api/player/text-game", {
    service: "studio",
    signal: expect.any(AbortSignal),
    retry: false,
  });
});
it("rejects unpublished or duplicated public catalogue entries", async () => {
  h.get.mockResolvedValue([{ gameId, status: "draft" }]);
  await expect(listPublishedTextGames(signal())).rejects.toThrow("unpublished");
  h.get.mockResolvedValue([
    { gameId, status: "published" },
    { gameId, status: "published" },
  ]);
  await expect(listPublishedTextGames(signal())).rejects.toThrow("duplicate");
});
it("accepts a published public detail and rejects a private document", async () => {
  h.get.mockResolvedValue(detail);
  expect((await getPublishedTextGame(gameId, signal())).content.worldviewDocxUrl).toBeNull();
  h.get.mockResolvedValue({
    ...detail,
    content: { ...detail.content, worldviewDocxUrl: "https://private.example/source.docx" },
  });
  await expect(getPublishedTextGame(gameId, signal())).rejects.toThrow("private source document");
});
it("rejects wrong identities and withdrawn works", async () => {
  h.get.mockResolvedValue({ ...detail, gameId: "tg_fedcba9876543210" });
  await expect(getPublishedTextGame(gameId, signal())).rejects.toThrow("unexpected");
  h.get.mockResolvedValue({ ...detail, status: "offline" });
  await expect(getPublishedTextGame(gameId, signal())).rejects.toThrow("unexpected");
});
it("rejects invalid identifiers before calling the service", async () => {
  await expect(getPublishedTextGame("../other", signal())).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
});
it("discards a late result after cancellation", async () => {
  const c = new AbortController();
  h.get.mockImplementation(async () => {
    c.abort();
    return detail;
  });
  await expect(getPublishedTextGame(gameId, c.signal)).rejects.toThrow();
});
