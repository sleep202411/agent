import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  resolvePlayableMediaUrl,
  resolveClipPlaybackUri,
  clipPlaybackEndSeconds,
  clipPlaybackStalled,
} from "./experience-media";
vi.mock("@/config", () => ({ resolveExperienceAssetUrl: (uri: string) => uri }));
const fetchMock = vi.fn();
let index = 0;
const uri = () =>
  `https://fixture.invalid/aurora/story-projects/project/builds/${++index}/assets/clip/content`;
const response = (url: string) => ({
  ok: true,
  status: 206,
  url,
  body: { cancel: () => Promise.resolve() },
});
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
it.each(["resolve", "reject", "throw", "absent"])(
  "releases a failed probe while preserving its HTTP error (cleanup: %s)",
  async (mode) => {
    const cancel = vi.fn(() => {
      if (mode === "throw") throw new Error("cleanup threw");
      return mode === "reject" ? Promise.reject(new Error("cleanup rejected")) : Promise.resolve();
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      body: mode === "absent" ? null : { cancel },
    });
    await expect(resolvePlayableMediaUrl(uri())).rejects.toThrow("Media unavailable (503)");
    expect(cancel).toHaveBeenCalledTimes(mode === "absent" ? 0 : 1);
  }
);

it("can retry resolution after a failed probe without caching the failure", async () => {
  const cancel = vi.fn().mockResolvedValue(undefined);
  fetchMock
    .mockResolvedValueOnce({ ok: false, status: 503, body: { cancel } })
    .mockResolvedValueOnce(response("https://cdn.invalid/recovered.mp4"));
  const address = uri();
  await expect(resolvePlayableMediaUrl(address)).rejects.toThrow("Media unavailable (503)");
  await expect(resolvePlayableMediaUrl(address)).resolves.toBe("https://cdn.invalid/recovered.mp4");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("rejects cancelled callers before using direct or cached URLs", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    resolvePlayableMediaUrl("https://fixture.invalid/direct.mp4", controller.signal)
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("keeps shared transport alive when one caller cancels", async () => {
  let finish!: (value: unknown) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const address = uri();
  const first = new AbortController();
  const second = new AbortController();
  const a = resolvePlayableMediaUrl(address, first.signal);
  const b = resolvePlayableMediaUrl(address, second.signal);
  const cancelled = expect(a).rejects.toMatchObject({ name: "AbortError" });
  first.abort();
  await cancelled;
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
  finish(response("https://cdn.invalid/clip.mp4"));
  await expect(b).resolves.toBe("https://cdn.invalid/clip.mp4");
});
it("aborts the last owner and preserves replacement work from delayed cleanup", async () => {
  const finishes: ((value: unknown) => void)[] = [];
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishes.push(resolve);
      })
  );
  const address = uri();
  const controller = new AbortController();
  const first = resolvePlayableMediaUrl(address, controller.signal);
  const cancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await cancelled;
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  const second = resolvePlayableMediaUrl(address);
  finishes[0](response("https://cdn.invalid/old.mp4"));
  await Promise.resolve();
  await Promise.resolve();
  const joined = resolvePlayableMediaUrl(address);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  finishes[1](response("https://cdn.invalid/new.mp4"));
  await expect(second).resolves.toBe("https://cdn.invalid/new.mp4");
  await expect(joined).resolves.toBe("https://cdn.invalid/new.mp4");
  await expect(resolvePlayableMediaUrl(address)).resolves.toBe("https://cdn.invalid/new.mp4");
});

it("reuses OSS V4 signatures until their relative expiry safety margin", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-09-17T10:00:00Z"));
    const address = uri();
    const signed =
      "https://cdn.invalid/clip.mp4?x-oss-date=20260917T100000Z&x-oss-expires=3600&x-oss-signature-version=OSS4-HMAC-SHA256";
    fetchMock.mockResolvedValue(response(signed));
    await expect(resolvePlayableMediaUrl(address)).resolves.toBe(signed);
    vi.setSystemTime(new Date("2026-09-17T10:58:59Z"));
    await expect(resolvePlayableMediaUrl(address)).resolves.toBe(signed);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-09-17T10:59:00Z"));
    await resolvePlayableMediaUrl(address);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  "x-oss-date=20260917T100000Z&x-oss-expires=30",
  "x-oss-date=20260916T100000Z&x-oss-expires=3600",
  "x-oss-expires=3600",
  "x-oss-date=invalid&x-oss-expires=3600",
  "x-oss-date=20260917T100000Z&x-oss-expires=Infinity",
  "x-oss-date=20260917T100000Z&x-oss-expires=0",
])("does not cache unusable OSS V4 expiration: %s", async (query) => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-09-17T10:00:00Z"));
    const address = uri();
    fetchMock.mockResolvedValue(response(`https://cdn.invalid/clip.mp4?${query}`));
    await resolvePlayableMediaUrl(address);
    await resolvePlayableMediaUrl(address);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  "Expires=1789642800",
  "se=2026-09-17T11%3A00%3A00Z",
  "X-Amz-Date=20260917T100000Z&X-Amz-Expires=3600",
])("retains existing provider expiry formats: %s", async (query) => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-09-17T10:00:00Z"));
    const address = uri();
    fetchMock.mockResolvedValue(response(`https://cdn.invalid/clip.mp4?${query}`));
    await resolvePlayableMediaUrl(address);
    await resolvePlayableMediaUrl(address);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("opens uncached clips without waiting for background download", async () => {
  const warm = vi.fn();
  const sign = vi.fn().mockResolvedValue("https://cdn.invalid/clip.mp4");
  expect(
    await resolveClipPlaybackUri("clip", new AbortController().signal, {
      cached: () => null,
      sign,
      warm,
    })
  ).toBe("https://cdn.invalid/clip.mp4");
  expect(warm).toHaveBeenCalledWith("clip");
});
it("uses cached footage directly and distinguishes near-end stalls from pauses", async () => {
  const sign = vi.fn();
  const warm = vi.fn();
  expect(
    await resolveClipPlaybackUri("clip", new AbortController().signal, {
      cached: () => "file:///clip",
      sign,
      warm,
    })
  ).toBe("file:///clip");
  expect(sign).not.toHaveBeenCalled();
  expect(clipPlaybackEndSeconds(10000, 12)).toBe(10);
  const stall = {
    currentTimeSeconds: 9.8,
    anchoredTimeSeconds: 9.8,
    anchoredForMs: 2000,
    endSeconds: 10,
    moved: true,
    held: false,
  };
  expect(clipPlaybackStalled(stall)).toBe(true);
  expect(clipPlaybackStalled({ ...stall, held: true })).toBe(false);
  expect(clipPlaybackStalled({ ...stall, moved: false })).toBe(false);
});
