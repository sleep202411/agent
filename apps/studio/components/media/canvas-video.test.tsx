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
async function render(count = 1) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        {Array.from({ length: count }, (_, index) => (
          <CanvasVideo key={index} src={`https://cdn.test/${index}.mp4`} />
        ))}
      </QueryClientProvider>
    )
  );
}
async function settle() {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(1);
    else await new Promise((resolve) => setTimeout(resolve, 1));
  });
}
async function visibility(index: number, visible: boolean) {
  await act(async () =>
    observers[index](
      [{ isIntersecting: visible } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  );
  await settle();
}
describe("canvas video resource lifetime", () => {
  it("retains the decoded frame when switching players even if the poster failed", async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    await render(2);
    await visibility(0, true);
    await visibility(1, true);
    await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    const first = container.querySelector("video")!;
    Object.defineProperties(first, {
      readyState: { value: 2 },
      videoWidth: { value: 1920 },
      videoHeight: { value: 1080 },
    });
    first.currentTime = 4.5;
    await act(async () => {
      first.dispatchEvent(new Event("loadeddata"));
      first.dispatchEvent(new Event("play"));
    });
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    const second = container.querySelectorAll("video")[1];
    await act(async () => second.dispatchEvent(new Event("play")));
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(first.hasAttribute("src")).toBe(false);
    const frame = container.querySelector("canvas")!;
    expect(frame.hidden).toBe(false);
    expect([frame.width, frame.height]).toEqual([480, 270]);
    expect(drawImage).toHaveBeenCalledWith(first, 0, 0, 480, 270);
    await visibility(0, false);
    await visibility(0, true);
    expect(container.querySelector("canvas")).toBe(frame);
    expect(frame.hidden).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    const resumed = container.querySelector("video")!;
    Object.defineProperty(resumed, "duration", { value: 8 });
    await act(async () => resumed.dispatchEvent(new Event("loadedmetadata")));
    expect(resumed.currentTime).toBe(4.5);
  });

  it("discards the retained frame when a node's video source changes, including switching back", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const renderSource = async (src: string) => {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <CanvasVideo src={src} />
          </QueryClientProvider>
        )
      );
    };
    await renderSource("https://cdn.test/first.mp4");
    await visibility(0, true);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    const first = container.querySelector("video")!;
    Object.defineProperties(first, {
      readyState: { value: 2 },
      videoWidth: { value: 1280 },
      videoHeight: { value: 720 },
    });
    await act(async () => first.dispatchEvent(new Event("loadeddata")));
    expect(container.querySelector("canvas")!.hidden).toBe(false);
    for (const src of ["https://cdn.test/second.mp4", "https://cdn.test/first.mp4"]) {
      await renderSource(src);
      const frame = container.querySelector("canvas")!;
      expect(frame.hidden).toBe(true);
      expect([frame.width, frame.height]).toEqual([1, 1]);
    }
  });

  it("keeps playback available when a poster image fails and retries it on play", async () => {
    await render();
    await visibility(0, true);
    await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("button")).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    await settle();
    expect(container.querySelector("video")).not.toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
  });
  it("finishes the poster even when playback starts first and retains it after leaving", async () => {
    let resolvePoster!: (poster: { url: string; width: number; height: number }) => void;
    vi.mocked(acquireVideoPoster).mockReturnValue({
      promise: new Promise((resolve) => {
        resolvePoster = resolve;
      }),
      release,
    });
    await render();
    await visibility(0, true);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(release).not.toHaveBeenCalled();
    await act(async () =>
      resolvePoster({ url: "data:image/jpeg;base64,late", width: 1280, height: 720 })
    );
    await settle();
    await act(async () =>
      container.firstElementChild!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))
    );
    expect(container.querySelector("video")).not.toBeNull();
    await visibility(0, false);
    expect(container.querySelector("img")?.getAttribute("src")).toContain("late");
    await visibility(0, true);
    expect(container.querySelector("img")?.getAttribute("src")).toContain("late");
    expect(container.querySelector("video")).toBeNull();
  });
  it("keeps playback controls separate from node selection and Composer", async () => {
    const select = vi.fn();
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <div onPointerDown={select} onMouseDown={select} onClick={select}>
            <CanvasVideo src="https://cdn.test/0.mp4" />
          </div>
        </QueryClientProvider>
      )
    );
    await visibility(0, true);
    const button = container.querySelector("button")!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      button.click();
    });
    const media = container.querySelector("video")!;
    await act(async () => {
      media.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      media.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      media.click();
    });
    expect(select).not.toHaveBeenCalled();
    await visibility(0, false);
    await visibility(0, true);
    await act(async () => (container.firstElementChild!.firstElementChild as HTMLElement).click());
    expect(select).toHaveBeenCalledTimes(1);
  });
  it("restores progress after releasing a player outside the viewport", async () => {
    await render();
    await visibility(0, true);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    const first = container.querySelector("video")!;
    Object.defineProperty(first, "readyState", { value: 2 });
    first.currentTime = 4.5;
    await visibility(0, false);
    await visibility(0, true);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    const second = container.querySelector("video")!;
    Object.defineProperty(second, "duration", { value: 8 });
    await act(async () => second.dispatchEvent(new Event("loadedmetadata")));
    expect(second.currentTime).toBe(4.5);
  });
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
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
  it("does not start playback when the pointer hovers over a tile", async () => {
    vi.useFakeTimers();
    await render(1);
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
    expect(container.querySelector("img")).not.toBeNull();
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
