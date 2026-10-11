import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { useExperiencePreload } from "./use-experience-preload";

const cache = vi.hoisted(() => ({
  adaptive: vi.fn((): string | null => null),
  ensureMediaCached: vi.fn(),
  cachedMediaBytes: vi.fn(() => 0),
  clearExperienceMediaPins: vi.fn(),
  pinExperienceMediaSources: vi.fn(),
  maintainExperienceMediaCache: vi.fn(() => Promise.resolve()),
}));
vi.mock("../lib/experience-playback-delivery", () => ({
  adaptivePlaybackEndpoint: cache.adaptive,
}));
vi.mock("../lib/experience-media-cache", () => ({ ...cache, EXPERIENCE_MEDIA_BUDGET_BYTES: 1000 }));
vi.mock("../lib/experience-media", () => ({
  EXPERIENCE_PLAY_ORIENTATION: "landscape",
  orderVideoUrisFromScene: (_manifest: unknown, entry: string) => [entry],
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let latest: ReturnType<typeof useExperiencePreload>;
function Harness({ manifest }: { manifest: ExperienceRuntimeManifest }) {
  const value = useExperiencePreload(manifest);
  useLayoutEffect(() => {
    latest = value;
  });
  return null;
}
async function render(entry: string) {
  const manifest = { graph: { entrySceneId: entry } } as ExperienceRuntimeManifest;
  await act(async () => {
    root.render(<Harness manifest={manifest} />);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  cache.adaptive.mockReturnValue(null);
  cache.ensureMediaCached.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

it("releases retry delays when the viewer leaves the chapter", async () => {
  cache.ensureMediaCached.mockRejectedValue(new Error("offline"));
  await render("old");
  expect(vi.getTimerCount()).toBe(1);
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
});

it("never retries an abandoned chapter after a replacement opens", async () => {
  cache.ensureMediaCached.mockImplementation((uri: string) =>
    uri === "old" ? Promise.reject(new Error("offline")) : Promise.resolve("cached")
  );
  await render("old");
  await render("replacement");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(cache.ensureMediaCached.mock.calls.map(([uri]) => uri)).toEqual(["old", "replacement"]);
  expect(latest.done).toBe(true);
});

it("does not read cached sizes after an abandoned download finishes", async () => {
  let finish!: () => void;
  cache.ensureMediaCached.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render("old");
  cache.cachedMediaBytes.mockClear();
  act(() => root.unmount());
  await act(async () => {
    finish();
  });
  expect(cache.cachedMediaBytes).not.toHaveBeenCalled();
});

it("retries active transient failures and opens the gate after success", async () => {
  cache.ensureMediaCached
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce("cached");
  await render("active");
  expect(latest.done).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(cache.ensureMediaCached).toHaveBeenCalledTimes(2);
  expect(latest.done).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the two-attempt limit and streaming fallback for persistent failures", async () => {
  cache.ensureMediaCached.mockRejectedValue(new Error("offline"));
  await render("active");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(cache.ensureMediaCached).toHaveBeenCalledTimes(2);
  expect(latest.done).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("opens the adaptive chapter without downloading progressive clips", async () => {
  cache.adaptive.mockReturnValue("https://api.test/playback");
  await render("adaptive");
  expect(latest.done).toBe(true);
  expect(cache.ensureMediaCached).not.toHaveBeenCalled();
});
