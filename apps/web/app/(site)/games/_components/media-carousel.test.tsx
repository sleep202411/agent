import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaCarousel } from "./media-carousel";

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    onError,
  }: {
    src: string;
    alt: string;
    onError?: React.ReactEventHandler<HTMLImageElement>;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element -- Next Image is replaced with a DOM image for this component test.
    <img src={src} alt={alt} onError={onError} />
  ),
}));

describe("published media playback ownership", () => {
  let container: HTMLDivElement, root: Root;
  const pause = vi.fn();
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    pause.mockReset();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
    HTMLElement.prototype.scrollTo = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("mounts only the active trailer and pauses it when navigating or closing", async () => {
    await act(async () =>
      root.render(
        <MediaCarousel
          media={[
            { kind: "video", url: "/first.mp4", posterUrl: null },
            { kind: "video", url: "/second.mp4", posterUrl: null },
            { kind: "image", url: "/still.jpg", alt: "Still" },
          ]}
          title="Film"
          trailerLabel="Trailer"
          imageAltFallback="Film"
          errorLabel="This media could not be loaded."
          retryLabel="Retry"
          counterLabel={(index, total) => `${index} / ${total}`}
        />
      )
    );
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(container.querySelector("video")?.getAttribute("src")).toBe("/first.mp4");
    expect(container.querySelector('img[src=""]')).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="2 / 3"]')?.click()
    );
    expect(pause).toHaveBeenCalledOnce();
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(container.querySelector("video")?.getAttribute("src")).toBe("/second.mp4");
    await act(async () => root.render(null));
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("reports a failed trailer and retries that media without silently switching slides", async () => {
    await act(async () =>
      root.render(
        <MediaCarousel
          media={[{ kind: "video", url: "/unavailable.mp4", posterUrl: null }]}
          title="Film"
          trailerLabel="Trailer"
          imageAltFallback="Film"
          counterLabel={(index, total) => `${index} / ${total}`}
          errorLabel="This media could not be loaded."
          retryLabel="Retry"
        />
      )
    );
    await act(async () => container.querySelector("video")?.dispatchEvent(new Event("error")));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    const retry = container.querySelector<HTMLButtonElement>("[data-media-retry]");
    expect(retry).not.toBeNull();
    await act(async () => retry?.click());
    expect(container.querySelector("video")?.getAttribute("src")).toBe("/unavailable.mp4");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => root.render(null));
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("keeps a valid selected slide when a refreshed release removes media", async () => {
    const media = [
      { kind: "image" as const, url: "/one.jpg", alt: "One" },
      { kind: "image" as const, url: "/two.jpg", alt: "Two" },
      { kind: "image" as const, url: "/removed.jpg", alt: "Removed" },
    ];
    const render = (items: typeof media) => (
      <MediaCarousel
        media={items}
        title="Film"
        trailerLabel="Trailer"
        imageAltFallback="Film"
        counterLabel={(index, total) => `${index} / ${total}`}
        errorLabel="This media could not be loaded."
        retryLabel="Retry"
      />
    );
    await act(async () => root.render(render(media)));
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="3 / 3"]')?.click()
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/removed.jpg");
    await act(async () => root.render(render(media.slice(0, 2))));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/two.jpg");
    expect(container.textContent).not.toContain("3 / 2");
    expect(container.querySelector('button[aria-current="true"]')?.getAttribute("aria-label")).toBe(
      "2 / 2"
    );
    await act(async () => root.render(render([])));
    expect(container.querySelector("section")).toBeNull();
    await act(async () => root.render(render([media[0]!])));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/one.jpg");
  });

  it("keeps a failed screenshot visible until retry instead of auto advancing", async () => {
    vi.useFakeTimers();
    await act(async () =>
      root.render(
        <MediaCarousel
          media={[
            { kind: "image", url: "/unavailable.jpg", alt: "Screenshot" },
            { kind: "image", url: "/next.jpg", alt: "Next" },
          ]}
          title="Film"
          trailerLabel="Trailer"
          imageAltFallback="Film"
          counterLabel={(index, total) => `${index} / ${total}`}
          errorLabel="This media could not be loaded."
          retryLabel="Retry"
        />
      )
    );
    await act(async () =>
      container
        .querySelector<HTMLImageElement>('img[alt="Screenshot"]')
        ?.dispatchEvent(new Event("error"))
    );
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This media could not be loaded."
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-media-retry]")?.click()
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/unavailable.jpg");
    vi.useRealTimers();
  });
});
