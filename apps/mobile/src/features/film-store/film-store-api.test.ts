import { beforeEach, expect, it, vi } from "vitest";
import { fetchFilmStoreListing, restartPublishedFilm } from "./film-store-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  load: vi.fn(),
  latest: vi.fn(),
  clear: vi.fn(),
  generation: 1,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/data/interactive-film-api", () => ({ loadPublishedInteractiveFilm: h.load }));
vi.mock("@/features/experience-player/lib/story-save-channel", () => ({
  fetchLatestSave: h.latest,
}));
vi.mock("@/features/experience-player/lib/story-save-resolution", () => ({
  clearStorySaveSlots: h.clear,
}));
const listing = {
  gameId: "film/a",
  title: "Film",
  defaultLocale: "en-US",
  description: "Published intro",
  tags: ["Adventure"],
  developer: "Studio",
  trailerUrl: null,
  coverUrl: null,
  screenshots: [{ url: "https://example.com/image.png" }],
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.load.mockResolvedValue({ activeChapterId: "first" });
  h.latest.mockResolvedValue({ chapterId: "second" });
  h.clear.mockResolvedValue(undefined);
});
it("reads a public snapshot preserving withheld cover and null introduction", async () => {
  h.get.mockResolvedValue(listing);
  expect(await fetchFilmStoreListing("film/a", signal())).toEqual(listing);
  expect(h.get).toHaveBeenCalledWith(
    "/story-store/film%2Fa",
    expect.objectContaining({ credentials: "omit", retry: false, cache: "no-store" })
  );
  h.get.mockResolvedValue(null);
  expect(await fetchFilmStoreListing("film/a", signal())).toBeNull();
});
it.each([
  { ...listing, gameId: "other" },
  { ...listing, trailerUrl: "file:///private/video" },
  { ...listing, screenshots: [{ url: "javascript:alert(1)" }] },
])("rejects mismatched or invalid public snapshots", async (value) => {
  h.get.mockResolvedValue(value);
  await expect(fetchFilmStoreListing("film/a", signal())).rejects.toThrow("invalid format");
});
it("keeps transport failures visible and ignores aborted responses", async () => {
  h.get.mockRejectedValueOnce(Error("Unavailable"));
  await expect(fetchFilmStoreListing("film/a", signal())).rejects.toThrow("Unavailable");
  const c = new AbortController();
  h.get.mockImplementationOnce(() => {
    c.abort();
    return listing;
  });
  await expect(fetchFilmStoreListing("film/a", c.signal)).rejects.toThrow();
});
it("clears first and latest chapter slots before returning the restart destination", async () => {
  expect(await restartPublishedFilm("user", 1, "film/a", signal())).toBe("first");
  expect(h.clear).toHaveBeenCalledWith(
    expect.objectContaining({
      accountId: "user",
      gameId: "film/a",
      chapterIds: ["first", "second"],
    })
  );
});
it("never turns failed or retired restart reads into a fresh game", async () => {
  h.latest.mockRejectedValueOnce(Error("Offline"));
  await expect(restartPublishedFilm("user", 1, "film/a", signal())).rejects.toThrow("Offline");
  expect(h.clear).not.toHaveBeenCalled();
  h.load.mockImplementationOnce(() => {
    h.generation = 2;
    return { activeChapterId: null };
  });
  await expect(restartPublishedFilm("user", 1, "film/a", signal())).rejects.toThrow(
    "session changed"
  );
  expect(h.clear).not.toHaveBeenCalled();
});
it("surfaces conditional clear conflicts", async () => {
  h.clear.mockRejectedValueOnce(Error("Save changed"));
  await expect(restartPublishedFilm("user", 1, "film/a", signal())).rejects.toThrow("Save changed");
});
