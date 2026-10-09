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
