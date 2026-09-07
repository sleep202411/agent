// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { mediaAccessPath, useMediaPlaybackSource } from "./use-media-playback-source";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));

describe("media playback addresses", () => {
  it("uses public CDN and local upload URLs directly", () => {
    expect(mediaAccessPath("https://r2.fizzdragon.com/video.mp4", "asset")).toBeNull();
    expect(mediaAccessPath("blob:https://studio.fizzdragon.com/local", "asset")).toBeNull();
  });
  it("renews signed media by durable asset ID without persisting its credentials", () => {
    expect(
      mediaAccessPath(
        "https://storage.test/file?X-Amz-Signature=old&X-Amz-Expires=300",
        "asset",
        "canvas"
      )
    ).toBe("/aurora/media/assets/asset/access?documentId=canvas");
  });
  it("preserves the existing document/variant access context", () => {
    expect(
      mediaAccessPath("/aurora/media/assets/asset/content?variantKey=original&documentId=canvas")
    ).toBe("/aurora/media/assets/asset/access?variantKey=original&documentId=canvas");
  });
});

describe("playback URL lifetime", () => {
  let root: Root, container: HTMLDivElement, client: QueryClient;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T10:00:00Z"));
    vi.mocked(api.get).mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    vi.useRealTimers();
  });
  function Player({ src, enabled }: { src: string; enabled: boolean }) {
    const playback = useMediaPlaybackSource(src, enabled, "asset");
    return createElement("span", null, playback.src);
  }
  async function render(src: string, enabled = true) {
    await act(async () =>
      root.render(
        createElement(QueryClientProvider, { client }, createElement(Player, { src, enabled }))
      )
    );
    await act(async () => vi.advanceTimersByTimeAsync(1));
  }
  it("renews a five-minute signed link 30 seconds before expiry and stops offscreen", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        url: "https://storage.test/video?sig=first",
        expiresAt: "2026-09-07T10:05:00Z",
      })
      .mockResolvedValueOnce({
        url: "https://storage.test/video?sig=second",
        expiresAt: "2026-09-07T10:09:30Z",
      });
    const src = "/aurora/media/assets/asset/content";
    await render(src);
    expect(container.textContent).toContain("sig=first");
    await act(async () => vi.advanceTimersByTimeAsync(268_999));
    expect(api.get).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1_001));
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("sig=second");
    await render(src, false);
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(api.get).toHaveBeenCalledTimes(2);
  });
  it("does not make access requests for public CDN media", async () => {
    await render("https://r2.fizzdragon.com/video.mp4");
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(container.textContent).toBe("https://r2.fizzdragon.com/video.mp4");
    expect(api.get).not.toHaveBeenCalled();
  });
});
