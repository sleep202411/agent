import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadAdminInteractiveFilmListing } from "./admin-interactive-film-listing";
import { requestAdminInteractiveFilmListing } from "./interactive-film-listing-client";

const jar = vi.hoisted(() => ({ session: "fixture-admin" as string | undefined }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (jar.session ? { value: jar.session } : undefined) }),
}));
const fetchMock = vi.fn<typeof fetch>();
const GAME = "10000000-0000-4000-8000-000000000001";
const VERSION = "20000000-0000-4000-8000-000000000001";

beforeEach(() => {
  jar.session = "fixture-admin";
  vi.stubEnv("ADMIN_API_BASE_URL", "https://nest.invalid/aurora/admin");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

it("reads only the requested version with an admin session and no shared cache", async () => {
  fetchMock.mockResolvedValue(
    Response.json({ code: 200, data: { contentVersion: VERSION, listing: null } })
  );
  expect(await loadAdminInteractiveFilmListing(GAME, VERSION)).toEqual({
    contentVersion: VERSION,
    data: { contentVersion: VERSION, listing: null },
    error: null,
  });
  const [url, options] = fetchMock.mock.calls[0]!;
  expect(url).toBe(
    `https://nest.invalid/aurora/admin/story-publications/${GAME}/listing?contentVersion=${VERSION}`
  );
  expect(new Headers(options?.headers).get("cookie")).toBe("fd_admin_session=fixture-admin");
  expect(options?.cache).toBe("no-store");
  expect(options?.redirect).toBe("error");
  expect(options?.signal).toBeInstanceOf(AbortSignal);
});
it("does not call an upstream without a candidate or authenticated session", async () => {
  expect(await loadAdminInteractiveFilmListing(GAME, null)).toEqual({
    contentVersion: null,
    data: null,
    error: null,
  });
  jar.session = undefined;
  expect(await loadAdminInteractiveFilmListing(GAME, VERSION)).toMatchObject({
    data: null,
    error: "Your admin session has expired. Sign in again.",
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("preserves a coverless snapshot through the initial load and browser retry", async () => {
  const data = {
    contentVersion: VERSION,
    listing: {
      gameId: GAME,
      title: "A film",
      defaultLocale: "en-US",
      description: "",
      tags: [],
      developer: "",
      coverUrl: null,
      coverStatus: "not_provided",
      trailerUrl: null,
      screenshots: [],
    },
  };
  fetchMock.mockImplementation(async () => Response.json({ code: 200, data }));
  expect(await loadAdminInteractiveFilmListing(GAME, VERSION)).toEqual({
    contentVersion: VERSION,
    data,
    error: null,
  });
  expect(await requestAdminInteractiveFilmListing(GAME, VERSION)).toEqual(data);
});
it("preserves upstream version conflicts and rejects a mismatched success response", async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ code: 409, msg: "Candidate changed." }, { status: 409 })
  );
  expect(await loadAdminInteractiveFilmListing(GAME, VERSION)).toMatchObject({
    data: null,
    error: "Candidate changed.",
  });
  fetchMock.mockResolvedValueOnce(
    Response.json({ code: 200, data: { contentVersion: "different", listing: null } })
  );
  expect((await loadAdminInteractiveFilmListing(GAME, VERSION)).error).toContain(
    "different release version"
  );
});
