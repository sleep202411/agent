import { beforeEach, expect, it, vi } from "vitest";
import { listPublicTextGames, getPublicTextGame } from "./api";
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
const gameId = "tg_0123456789abcdef",
  signal = new AbortController().signal;
const summary = { gameId, name: "World", posterUrl: null, synopsis: null, status: "published" };
const detail = {
  ...summary,
  projectId: null,
  rejectReason: null,
  draftVersionId: "1",
  publishedAt: null,
  offlineAt: null,
  content: {
    versionId: "1",
    versionNo: 1,
    name: "World",
    posterUrl: null,
    synopsis: null,
    worldviewDocxUrl: null,
    bgmUrl: null,
  },
};
beforeEach(() => vi.resetAllMocks());
it("uses the public catalogue endpoint for guests", async () => {
  h.get.mockResolvedValue([summary]);
  expect(await listPublicTextGames(signal)).toHaveLength(1);
  expect(h.get).toHaveBeenCalledWith("/api/player/text-game", {
    service: "studio",
    signal,
    retry: false,
  });
});
it.each(["draft", "reviewing", "offline"])("rejects %s rows", async (status) => {
  h.get.mockResolvedValue([{ ...summary, status }]);
  await expect(listPublicTextGames(signal)).rejects.toThrow("unpublished");
});
it("rejects duplicated identities", async () => {
  h.get.mockResolvedValue([summary, summary]);
  await expect(listPublicTextGames(signal)).rejects.toThrow("duplicate");
});
it("validates published detail", async () => {
  h.get.mockResolvedValue(detail);
  expect((await getPublicTextGame(gameId, signal)).content.worldviewDocxUrl).toBeNull();
});
it.each([
  { ...detail, gameId: "tg_abcdefghijklmnop" },
  { ...detail, status: "offline" },
  {
    ...detail,
    content: { ...detail.content, worldviewDocxUrl: "https://example.com/private.docx" },
  },
])("rejects unsafe detail responses", async (value) => {
  h.get.mockResolvedValue(value);
  await expect(getPublicTextGame(gameId, signal)).rejects.toThrow();
});
it("rejects malformed IDs without fetching", async () => {
  await expect(getPublicTextGame("../secret", signal)).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
});
it("preserves upstream errors", async () => {
  h.get.mockRejectedValue(new Error("Service unavailable"));
  await expect(listPublicTextGames(signal)).rejects.toThrow("Service unavailable");
});
it("discards late data after cancellation", async () => {
  const c = new AbortController();
  h.get.mockImplementation(async () => {
    c.abort();
    return [summary];
  });
  await expect(listPublicTextGames(c.signal)).rejects.toThrow();
});
