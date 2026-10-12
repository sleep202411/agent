import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  adaptivePlaybackEndpoint,
  resolveExperienceVideoSource,
} from "./experience-playback-delivery";
const state = vi.hoisted(() => ({
  region: "cn",
  platform: "ios",
  fetch: vi.fn(),
  progressive: vi.fn(),
}));
vi.mock("./adaptive-playback-support", () => ({
  supportsAdaptivePlayback: () =>
    state.platform !== "web" ||
    (typeof document !== "undefined" &&
      !!document.createElement("video").canPlayType("application/vnd.apple.mpegurl")),
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return state.platform;
    },
  },
}));
vi.mock("@/config", () => ({
  appEnv: {
    get appRegion() {
      return state.region;
    },
  },
}));
vi.mock("./experience-media", () => ({
  absolutizeExperienceMediaUri: (s: string) => new URL(s, "https://api.test").href,
}));
vi.mock("./experience-media-cache", () => ({ resolveImmediatePlaybackUri: state.progressive }));
const source = "/aurora/story-projects/p/builds/b/assets/a/variants/v/content?version=1";
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(() => {
  state.region = "cn";
  state.platform = "ios";
  vi.resetAllMocks();
  vi.stubGlobal("fetch", state.fetch);
  state.progressive.mockResolvedValue("file:///cached.mp4");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("negotiates ready HLS with explicit native content type and preserves query context", async () => {
  state.fetch.mockResolvedValue(
    response({
      code: 200,
      data: { url: "https://cdn.test/master", contentType: "application/vnd.apple.mpegurl" },
    })
  );
  expect(await resolveExperienceVideoSource(source, new AbortController().signal)).toEqual({
    uri: "https://cdn.test/master",
    contentType: "hls",
  });
  expect(state.fetch.mock.calls[0][0]).toBe(
    "https://api.test/aurora/story-projects/p/builds/b/assets/a/variants/v/playback?version=1"
  );
  expect(state.progressive).not.toHaveBeenCalled();
});
it("uses the existing progressive cache only for an explicit null", async () => {
  state.fetch.mockResolvedValue(response({ code: 200, data: null }));
  expect(await resolveExperienceVideoSource(source, new AbortController().signal)).toEqual({
    uri: "file:///cached.mp4",
  });
});
for (const [region, platform] of [
  ["global", "ios"],
  ["cn", "web"],
]) {
  it(`preserves current playback for ${region}/${platform}`, async () => {
    state.region = region!;
    state.platform = platform!;
    await resolveExperienceVideoSource(source, new AbortController().signal);
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.progressive).toHaveBeenCalled();
  });
}
for (const body of [
  { code: 200 },
  { code: 403, data: null },
  { code: 200, data: { url: "javascript:bad", contentType: "application/vnd.apple.mpegurl" } },
]) {
  it(`does not fall back for malformed/refused envelopes ${JSON.stringify(body)}`, async () => {
    state.fetch.mockResolvedValue(response(body));
    await expect(
      resolveExperienceVideoSource(source, new AbortController().signal)
    ).rejects.toThrow();
    expect(state.progressive).not.toHaveBeenCalled();
  });
}
it("surfaces an access rejection without requesting the progressive file", async () => {
  state.fetch.mockResolvedValue(response({ message: "Chapter access denied" }, 403));
  await expect(resolveExperienceVideoSource(source, new AbortController().signal)).rejects.toThrow(
    "Chapter access denied"
  );
  expect(state.progressive).not.toHaveBeenCalled();
});
it("ignores an HLS response after leaving the scene", async () => {
  const abort = new AbortController();
  state.fetch.mockImplementation(async () => {
    abort.abort();
    return response({ code: 200, data: null });
  });
  await expect(resolveExperienceVideoSource(source, abort.signal)).rejects.toThrow();
  expect(state.progressive).not.toHaveBeenCalled();
});
it("does not negotiate unrelated media URLs", () => {
  expect(adaptivePlaybackEndpoint("https://cdn.test/movie.mp4")).toBeNull();
});

it("bounds a stalled negotiation and never substitutes the progressive file", async () => {
  vi.useFakeTimers();
  try {
    state.fetch.mockImplementation(
      (_url, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("Playback request timed out")), {
            once: true,
          });
        })
    );
    const pending = resolveExperienceVideoSource(source, new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(state.progressive).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it("re-negotiates after a failed stream rather than remembering a stale HLS URL", async () => {
  state.fetch
    .mockResolvedValueOnce(
      response({
        code: 200,
        data: { url: "https://cdn.test/old.m3u8", contentType: "application/vnd.apple.mpegurl" },
      })
    )
    .mockResolvedValueOnce(
      response({
        code: 200,
        data: { url: "https://cdn.test/new.m3u8", contentType: "application/vnd.apple.mpegurl" },
      })
    );
  const signal = new AbortController().signal;
  expect((await resolveExperienceVideoSource(source, signal)).uri).toContain("old.m3u8");
  expect((await resolveExperienceVideoSource(source, signal)).uri).toContain("new.m3u8");
});

it("negotiates HLS in a browser whose media element supports it", async () => {
  state.platform = "web";
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
  state.fetch.mockResolvedValue(
    response({
      code: 200,
      data: { url: "https://cdn.test/master.m3u8", contentType: "application/vnd.apple.mpegurl" },
    })
  );
  const result = await resolveExperienceVideoSource(source, new AbortController().signal);
  expect(result.contentType).toBe("hls");
  expect(state.progressive).not.toHaveBeenCalled();
});
it("does not access browser media APIs during server rendering", () => {
  state.platform = "web";
  vi.stubGlobal("document", undefined);
  expect(adaptivePlaybackEndpoint(source)).toBeNull();
});
