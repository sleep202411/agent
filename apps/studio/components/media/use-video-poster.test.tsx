// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { acquireVideoPoster } from "./video-poster";
import { useVideoPoster, videoPosterPath } from "./use-video-poster";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));
vi.mock("./video-poster", () => ({ acquireVideoPoster: vi.fn() }));

describe("video poster identity", () => {
  it("uses the stored asset and document without forwarding source credentials or video variants", () => {
    expect(
      videoPosterPath("/aurora/media/assets/video/content?documentId=canvas&variantKey=hls&sig=old")
    ).toBe("/aurora/media/assets/video/poster?documentId=canvas");
    expect(videoPosterPath("https://cdn.test/video.mp4?sig=old", "video", "canvas")).toBe(
      "/aurora/media/assets/video/poster?documentId=canvas"
    );
    expect(videoPosterPath("blob:https://studio.test/upload", "video")).toBeNull();
    expect(videoPosterPath("http://%")).toBeNull();
  });
});

describe("stored video poster lifetime", () => {
  let root: Root, container: HTMLDivElement, client: QueryClient;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T10:00:00Z"));
    vi.mocked(api.get).mockReset();
    vi.mocked(acquireVideoPoster).mockReset();
    client = new QueryClient();
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    vi.useRealTimers();
  });
  function Poster({ visible }: { visible: boolean }) {
    const poster = useVideoPoster("https://cdn.test/video.mp4", "video", "canvas", visible);
    return <span>{JSON.stringify(poster.data)}</span>;
  }
  async function render(visible = true) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Poster visible={visible} />
        </QueryClientProvider>
      )
    );
    await act(async () => vi.advanceTimersByTimeAsync(1));
  }
  it("polls a pending job, then displays its stored image without decoding the video in the browser", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValue({ status: "ready", url: "poster.jpg", expiresAt: null });
    await render();
    expect(container.textContent).toContain("pending");
    await act(async () => vi.advanceTimersByTimeAsync(3_001));
    expect(container.textContent).toContain("poster.jpg");
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(acquireVideoPoster).not.toHaveBeenCalled();
  });
  it("renews a signed poster before expiry and keeps its result without polling offscreen", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        status: "ready",
        url: "poster.jpg?sig=1",
        expiresAt: "2026-09-08T10:05:00Z",
      })
      .mockResolvedValue({
        status: "ready",
        url: "poster.jpg?sig=2",
        expiresAt: "2026-09-08T10:09:30Z",
      });
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(270_001));
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("sig=2");
    await render(false);
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("sig=2");
  });
  it("stops polling terminal failures instead of starting an endless retry loop", async () => {
    vi.mocked(api.get).mockResolvedValue({
      status: "failed",
      message: "Video contains no preview frame.",
    });
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Video contains no preview frame.");
  });
});
