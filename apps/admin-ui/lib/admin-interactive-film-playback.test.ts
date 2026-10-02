import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadInteractiveFilmPlayback } from "./admin-interactive-film-playback";
import {
  PLAYBACK_GAME_ID,
  playbackGame,
  playbackOverview,
} from "./interactive-film-playback-fixtures";

const jar = vi.hoisted(() => ({ session: "current" as string | undefined }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "fd_admin_session" && jar.session ? { value: jar.session } : undefined,
  }),
}));

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  jar.session = "current";
  vi.stubEnv("ADMIN_API_BASE_URL", "https://nest.invalid/admin");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

it("reads the overview with the admin session, no cache and a 15 s deadline", async () => {
  const overview = playbackOverview([playbackGame()]);
  fetchMock.mockResolvedValue(Response.json({ code: 200, data: overview }));
  const timeout = vi.spyOn(AbortSignal, "timeout");

  await expect(
    loadInteractiveFilmPlayback([PLAYBACK_GAME_ID], { includeClips: true })
  ).resolves.toEqual({ data: overview, error: null });

  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe(
    `https://nest.invalid/admin/interactive-film-playback?gameIds=${PLAYBACK_GAME_ID}&include=clips`
  );
  expect(new Headers(init?.headers).get("cookie")).toBe("fd_admin_session=current");
  expect(init?.cache).toBe("no-store");
  expect(timeout).toHaveBeenCalledWith(15_000);
  expect(init?.signal).toBe(timeout.mock.results[0]?.value);
});

it("encodes each stable id and omits clips for summary reads", async () => {
  fetchMock.mockResolvedValue(Response.json({ code: 200, data: playbackOverview([]) }));
  await loadInteractiveFilmPlayback(["film/a:1", PLAYBACK_GAME_ID], { includeClips: false });
  expect(fetchMock.mock.calls[0]![0]).toBe(
    `https://nest.invalid/admin/interactive-film-playback?gameIds=film%2Fa%3A1,${PLAYBACK_GAME_ID}`
  );
});

it.each([
  [
    Response.json(
      { code: "STORY_PLAYBACK_HLS_DISABLED", msg: "播放分发（HLS）仅在中国站启用。" },
      { status: 404 }
    ),
    "播放分发（HLS）仅在中国站启用。",
  ],
  [
    Response.json(
      {
        code: "JAVA_CATALOGUE_FAILED",
        msg: "Java playable-story catalogue failed (HTTP 503, code 503): upstream busy",
      },
      { status: 502 }
    ),
    "Java playable-story catalogue failed (HTTP 503, code 503): upstream busy",
  ],
  [
    Response.json(
      {
        message: "Validation failed",
        issues: [{ path: "include", message: "include=clips requires exactly one gameId" }],
      },
      { status: 400 }
    ),
    "Validation failed（include: include=clips requires exactly one gameId）",
  ],
])("passes Nest failures through verbatim (%#)", async (response, error) => {
  fetchMock.mockResolvedValue(response);
  await expect(
    loadInteractiveFilmPlayback([PLAYBACK_GAME_ID], { includeClips: true })
  ).resolves.toEqual({ data: null, error });
});

it("reports transport failures and timeouts verbatim", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
  await expect(
    loadInteractiveFilmPlayback([PLAYBACK_GAME_ID], { includeClips: true })
  ).resolves.toEqual({ data: null, error: "fetch failed" });

  fetchMock.mockRejectedValueOnce(
    new DOMException("The operation was aborted due to timeout", "TimeoutError")
  );
  await expect(
    loadInteractiveFilmPlayback([PLAYBACK_GAME_ID], { includeClips: true })
  ).resolves.toEqual({ data: null, error: "The operation was aborted due to timeout" });
});

it("does not call Nest without an admin session", async () => {
  jar.session = undefined;
  await expect(
    loadInteractiveFilmPlayback([PLAYBACK_GAME_ID], { includeClips: true })
  ).resolves.toEqual({ data: null, error: "后台登录已失效，请重新登录。" });
  expect(fetchMock).not.toHaveBeenCalled();
});
