// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImageResultTile, VideoResultTile } from "./feed-tiles";
import type { FeedJob } from "./use-generation-feed";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
const open = vi.fn();
const job = { prompt: "Scene", input: {}, createdAtMs: Date.now() } as FeedJob;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
async function render(video = true) {
  await act(async () =>
    root.render(
      video ? (
        <VideoResultTile
          job={job}
          output={{ type: "video", url: "/video.mp4" } as never}
          onOpen={open}
        />
      ) : (
        <ImageResultTile
          job={job}
          output={{ type: "image", url: "/image.png" } as never}
          onOpen={open}
          index={0}
          total={1}
        />
      )
    )
  );
}
it.each([true, false])(
  "provides separate native open and download buttons (video=%s)",
  async (video) => {
    await render(video);
    const opener = host.querySelector(
      'button[aria-label="fullscreen: Scene"]'
    ) as HTMLButtonElement;
    expect(opener).not.toBeNull();
    expect(host.querySelector('button[aria-label="download"]')).not.toBeNull();
    expect(host.querySelector("button button")).toBeNull();
    await act(async () => opener.click());
    expect(open).toHaveBeenCalledTimes(1);
  }
);
it("opens the result viewer when native fullscreen is unavailable", async () => {
  await render();
  await act(async () =>
    (host.querySelector('button[aria-label="fullscreen"]') as HTMLButtonElement).click()
  );
  expect(open).toHaveBeenCalledTimes(1);
});
it("restores preview flags and opens the viewer after fullscreen rejection", async () => {
  await render();
  const video = host.querySelector("video")!;
  video.requestFullscreen = vi.fn().mockRejectedValue(new Error("Denied"));
  await act(async () =>
    (host.querySelector('button[aria-label="fullscreen"]') as HTMLButtonElement).click()
  );
  expect(video.controls).toBe(false);
  expect(video.muted).toBe(true);
  expect(open).toHaveBeenCalledTimes(1);
});
it("restores preview flags on fullscreen exit without opening another viewer", async () => {
  await render();
  const video = host.querySelector("video")!;
  video.requestFullscreen = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    (host.querySelector('button[aria-label="fullscreen"]') as HTMLButtonElement).click()
  );
  expect(video.controls).toBe(true);
  expect(video.muted).toBe(false);
  await act(async () => document.dispatchEvent(new Event("fullscreenchange")));
  expect(video.controls).toBe(false);
  expect(video.muted).toBe(true);
  expect(open).not.toHaveBeenCalled();
});
