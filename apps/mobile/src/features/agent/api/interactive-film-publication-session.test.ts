import { beforeEach, expect, it, vi } from "vitest";
import {
  getInteractiveFilmPublication,
  submitInteractiveFilmRelease,
  offlineInteractiveFilm,
} from "./interactive-film-publication-api";
import type { ExperienceReleaseRequest } from "@repo/shared/experience-runtime";
const h = vi.hoisted(() => ({ generation: 1, post: vi.fn(), get: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post, get: h.get } }));
const release = { gameId: "film" } as ExperienceReleaseRequest;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.post.mockResolvedValue({ gameId: "film", status: "reviewing" });
});
it("submits through project-authorized Server without direct Java writes", async () => {
  await expect(submitInteractiveFilmRelease("film", release)).resolves.toMatchObject({
    status: "reviewing",
  });
  expect(h.post).toHaveBeenCalledOnce();
  expect(h.post).toHaveBeenCalledWith(
    "/story-projects/film/publication/submit",
    expect.objectContaining({ service: "aurora", retry: false, data: release })
  );
  expect(h.get).not.toHaveBeenCalled();
});
it("takes a project offline through the authorized Server path", async () => {
  h.post.mockResolvedValue({ gameId: "film", status: "offline" });
  await offlineInteractiveFilm("film");
  expect(h.post).toHaveBeenCalledWith(
    "/story-projects/film/publication/offline",
    expect.objectContaining({ service: "aurora", retry: false, data: {} })
  );
});
it("only treats an authorized null read as unpublished", async () => {
  h.get.mockResolvedValue(null);
  expect(await getInteractiveFilmPublication("film")).toBeNull();
  expect(h.get).toHaveBeenCalledWith(
    "/story-projects/film/publication",
    expect.objectContaining({ service: "aurora", retry: false })
  );
  const denied = Object.assign(new Error("Project not found"), { status: 404 });
  h.get.mockRejectedValue(denied);
  await expect(getInteractiveFilmPublication("film")).rejects.toBe(denied);
});
it.each(["read", "submit", "offline"])(
  "rejects late %s responses after account changes",
  async (kind) => {
    const respond = async () => {
      h.generation++;
      return { gameId: "film", status: "offline" };
    };
    h.get.mockImplementation(respond);
    h.post.mockImplementation(respond);
    await expect(
      kind === "read"
        ? getInteractiveFilmPublication("film")
        : kind === "submit"
          ? submitInteractiveFilmRelease("film", release)
          : offlineInteractiveFilm("film")
    ).rejects.toThrow("session expired");
  }
);
it("rejects cancelled mutation responses", async () => {
  const c = new AbortController();
  h.post.mockImplementation(async () => {
    c.abort();
    return { gameId: "film", status: "reviewing" };
  });
  await expect(submitInteractiveFilmRelease("film", release, c.signal)).rejects.toThrow();
  expect(h.post).toHaveBeenCalledOnce();
});
it.each(["draft", "offline"])("does not confirm submission from %s receipt", async (status) => {
  h.post.mockResolvedValue({ gameId: "film", status });
  await expect(submitInteractiveFilmRelease("film", release)).rejects.toThrow(
    "could not be verified"
  );
});
it.each(["draft", "reviewing", "published"])(
  "does not confirm offlining from %s receipt",
  async (status) => {
    h.post.mockResolvedValue({ gameId: "film", status });
    await expect(offlineInteractiveFilm("film")).rejects.toThrow("could not be verified");
  }
);
it("accepts immediately published receipt", async () => {
  h.post.mockResolvedValue({ gameId: "film", status: "published" });
  await expect(submitInteractiveFilmRelease("film", release)).resolves.toMatchObject({
    status: "published",
  });
});
it("rejects cross-project receipts", async () => {
  h.post.mockResolvedValue({ gameId: "other", status: "reviewing" });
  await expect(submitInteractiveFilmRelease("film", release)).rejects.toThrow(
    "invalid publication"
  );
});
it("does not replay uncertain writes or replace authorization errors", async () => {
  const error = new Error("Publication permission denied");
  h.post.mockRejectedValue(error);
  await expect(submitInteractiveFilmRelease("film", release)).rejects.toBe(error);
  expect(h.post).toHaveBeenCalledOnce();
});
