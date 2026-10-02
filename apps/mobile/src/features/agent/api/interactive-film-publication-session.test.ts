import { beforeEach, expect, it, vi } from "vitest";
import {
  submitInteractiveFilmRelease,
  offlineInteractiveFilm,
} from "./interactive-film-publication-api";
import type { ExperienceReleaseRequest } from "@repo/shared/experience-runtime";
const h = vi.hoisted(() => ({ generation: 1, post: vi.fn(), get: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({
  api: { post: h.post, get: h.get },
  ApiRequestError: class extends Error {},
}));
const release = {} as ExperienceReleaseRequest;
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.post.mockResolvedValue({});
  h.get.mockResolvedValue({ gameId: "film", status: "reviewing" });
});
it("stops before status submission if the account changes after uploading a release", async () => {
  h.post.mockImplementationOnce(async () => {
    h.generation = 2;
    return {};
  });
  await expect(submitInteractiveFilmRelease("film", release)).rejects.toThrow("session expired");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.get).not.toHaveBeenCalled();
});
it("stops before reading publication if the account changes after status submission", async () => {
  h.post.mockResolvedValueOnce({}).mockImplementationOnce(async () => {
    h.generation = 2;
    return {};
  });
  await expect(submitInteractiveFilmRelease("film", release)).rejects.toThrow("session expired");
  expect(h.get).not.toHaveBeenCalled();
});
it("ignores a publication receipt from a previous session", async () => {
  h.get.mockImplementationOnce(async () => {
    h.generation = 2;
    return { gameId: "film", status: "reviewing" };
  });
  await expect(submitInteractiveFilmRelease("film", release)).rejects.toThrow("session expired");
});
it("stops cancelled submissions between requests", async () => {
  const c = new AbortController();
  h.post.mockImplementationOnce(async () => {
    c.abort();
    return {};
  });
  await expect(submitInteractiveFilmRelease("film", release, c.signal)).rejects.toThrow();
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.get).not.toHaveBeenCalled();
});
it("keeps normal same-session release submission intact", async () => {
  await expect(submitInteractiveFilmRelease("film", release)).resolves.toMatchObject({
    status: "reviewing",
  });
  expect(h.post).toHaveBeenCalledTimes(2);
  expect(h.get).toHaveBeenCalledOnce();
});
it("does not read offline receipts under another account", async () => {
  h.post.mockImplementationOnce(async () => {
    h.generation = 2;
    return {};
  });
  await expect(offlineInteractiveFilm("film")).rejects.toThrow("session expired");
  expect(h.get).not.toHaveBeenCalled();
});
