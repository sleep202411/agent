// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasVideo } from "./canvas-video";
import { acquireVideoPoster } from "./video-poster";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./video-poster", () => ({ acquireVideoPoster: vi.fn() }));
const observers: IntersectionObserverCallback[] = [];
let root: Root, container: HTMLDivElement, client: QueryClient;
let release: () => void;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  observers.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  release = vi.fn();
  vi.mocked(acquireVideoPoster).mockReturnValue({
    promise: Promise.resolve({ url: "data:image/jpeg;base64,test", width: 1280, height: 720 }),
    release,
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function render(count = 1, hoverPlay = false) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        {Array.from({ length: count }, (_, index) => (
          <CanvasVideo key={index} src={`https://cdn.test/${index}.mp4`} hoverPlay={hoverPlay} />
        ))}
      </QueryClientProvider>
    )
  );
}
async function visibility(index: number, visible: boolean) {
  await act(async () =>
    observers[index](
      [{ isIntersecting: visible } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  );
}
describe("canvas video resource lifetime", () => {
  it("keeps thumbnail failures passive inside asset selection buttons", async () => {
    vi.mocked(acquireVideoPoster).mockImplementation(() => ({
      promise: Promise.reject(new Error("Preview unavailable")),
      release,
    }));
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <button type="button">
            <CanvasVideo src="https://cdn.test/failed.mp4" thumbnail />
          </button>
        </QueryClientProvider>
      )
    );
    await visibility(0, true);
    expect(container.textContent).toContain("previewUnsupported");
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });
  it("releases the previous player even when it was already paused", async () => {
    await render(2);
    await visibility(0, true);
    await visibility(1, true);
    await act(async () => container.querySelectorAll<HTMLButtonElement>("button")[0].click());
    const previous = container.querySelector("video")!;
    await act(async () => previous.dispatchEvent(new Event("play")));
    await act(async () => previous.dispatchEvent(new Event("pause")));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    const current = container.querySelectorAll("video")[1];
    await act(async () => current.dispatchEvent(new Event("play")));
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(container.querySelector("video")).toBe(current);
    expect(previous.hasAttribute("src")).toBe(false);
  });
  it("cancels a pending hover preview when the tile leaves the viewport", async () => {
    vi.useFakeTimers();
    await render(1, true);
    await visibility(0, true);
    await act(async () =>
      container.firstElementChild!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    );
    await visibility(0, false);
    await act(async () => vi.advanceTimersByTimeAsync(300));
    await visibility(0, true);
    expect(container.querySelectorAll("video")).toHaveLength(0);
  });
  it("retries a network failure at most twice", async () => {
    vi.useFakeTimers();
    await render();
    await visibility(0, true);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "error", { value: { code: 2 } });
    const load = vi.mocked(video.load);
    load.mockClear();
    for (let attempt = 0; attempt < 4; attempt++) {
      await act(async () => video.dispatchEvent(new Event("error")));
      await act(async () => vi.advanceTimersByTimeAsync(2_000));
    }
    expect(load).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("retry");
  });
  it("does not create 100 players or request offscreen thumbnails", async () => {
    vi.mocked(acquireVideoPoster).mockClear();
    await render(100);
    expect(container.querySelectorAll("video")).toHaveLength(0);
    expect(acquireVideoPoster).not.toHaveBeenCalled();
    await visibility(0, true);
    expect(acquireVideoPoster).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelectorAll("video")).toHaveLength(0);
  });
  it("releases a player's source when it leaves the viewport", async () => {
    await render();
    await visibility(0, true);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    const video = container.querySelector("video")!;
    expect(video.getAttribute("src")).toContain("0.mp4");
    await visibility(0, false);
    expect(container.querySelector("video")).toBeNull();
    expect(video.getAttribute("src")).toBeNull();
    expect(release).toHaveBeenCalled();
  });
  it("clears a transient error after playback becomes available without refreshing the page", async () => {
    await render();
    await visibility(0, true);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    const video = container.querySelector("video")!;
    Object.defineProperty(video, "error", {
      configurable: true,
      value: { code: 2, message: "Network disconnected" },
    });
    await act(async () => video.dispatchEvent(new Event("error")));
    expect(container.textContent).toContain("previewUnsupported");
    expect(container.textContent).toContain("retry");
    Object.defineProperty(video, "error", { value: null });
    await act(async () => video.dispatchEvent(new Event("canplay")));
    expect(container.textContent).not.toContain("previewUnsupported");
  });
});
