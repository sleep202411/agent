// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaTimelineRange, MediaTimelineTrack } from "./media-timeline-track";

describe("MediaTimelineRange pointer interactions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let boundsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    boundsSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 1_000,
      bottom: 36,
      left: 0,
      width: 1_000,
      height: 36,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperties(HTMLElement.prototype, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    boundsSpy.mockRestore();
    container.remove();
  });

  it("routes a right-handle drag to end-time resizing", async () => {
    const onChange = vi.fn();
    const onScrub = vi.fn();
    await act(async () => {
      root.render(
        <MediaTimelineTrack durationSeconds={10}>
          <MediaTimelineRange
            ariaLabel="Hotspot"
            selected
            value={{ startSeconds: 2, endSeconds: 5 }}
            onChange={onChange}
            onScrub={onScrub}
          >
            Hotspot
          </MediaTimelineRange>
        </MediaTimelineTrack>
      );
    });

    const range = requiredElement(
      container.querySelector<HTMLElement>("[aria-label=Hotspot]")?.parentElement ?? null
    );
    const rightHandle = requiredElement(
      container.querySelector<HTMLElement>('[data-media-timeline-range-handle="right"]')
    );

    await act(async () => {
      rightHandle.dispatchEvent(pointerEvent("pointerdown", 500));
      range.dispatchEvent(pointerEvent("pointermove", 700));
    });

    expect(onChange).toHaveBeenLastCalledWith({ startSeconds: 2, endSeconds: 7 });
    expect(onScrub).toHaveBeenLastCalledWith(7, "resize-end");
  });

  it("previews the new start frame while moving the complete range", async () => {
    const onScrub = vi.fn();
    await act(async () => {
      root.render(
        <MediaTimelineTrack durationSeconds={10}>
          <MediaTimelineRange
            ariaLabel="Hotspot"
            selected
            value={{ startSeconds: 2, endSeconds: 5 }}
            onChange={vi.fn()}
            onScrub={onScrub}
          >
            Hotspot
          </MediaTimelineRange>
        </MediaTimelineTrack>
      );
    });

    const range = requiredElement(
      container.querySelector<HTMLElement>("[aria-label=Hotspot]")?.parentElement ?? null
    );
    await act(async () => {
      range.dispatchEvent(pointerEvent("pointerdown", 200));
      range.dispatchEvent(pointerEvent("pointermove", 400));
    });

    expect(onScrub).toHaveBeenLastCalledWith(4, "move");
  });

  it("scrubs against the time axis while clamping trailing canvas space", async () => {
    const onSeek = vi.fn();
    await act(async () => {
      root.render(
        <MediaTimelineTrack
          durationSeconds={10}
          timeAxisWidth={800}
          seekOnPointerDrag
          onSeek={onSeek}
        >
          Track
        </MediaTimelineTrack>
      );
    });

    const track = requiredElement(
      container.querySelector<HTMLElement>('[data-slot="media-timeline-track"]')
    );
    await act(async () => {
      track.dispatchEvent(pointerEvent("pointerdown", 400));
      track.dispatchEvent(pointerEvent("pointermove", 900));
      track.dispatchEvent(pointerEvent("pointerup", 900));
    });

    expect(onSeek).toHaveBeenNthCalledWith(1, 5);
    expect(onSeek).toHaveBeenLastCalledWith(10);
  });
  it("keeps the first pointer in control of a range drag", async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        <MediaTimelineTrack durationSeconds={10}>
          <MediaTimelineRange
            ariaLabel="Hotspot"
            value={{ startSeconds: 2, endSeconds: 5 }}
            onChange={onChange}
          >
            Hotspot
          </MediaTimelineRange>
        </MediaTimelineTrack>
      )
    );
    const range = requiredElement(
      container.querySelector<HTMLElement>("[aria-label=Hotspot]")?.parentElement ?? null
    );
    await act(async () => {
      range.dispatchEvent(pointerEvent("pointerdown", 200));
      range.dispatchEvent(pointerEvent("pointerdown", 700, 2));
      range.dispatchEvent(pointerEvent("pointermove", 400));
      range.dispatchEvent(pointerEvent("pointerup", 700, 2));
      range.dispatchEvent(pointerEvent("pointermove", 500));
    });
    expect(onChange).toHaveBeenNthCalledWith(1, { startSeconds: 4, endSeconds: 7 });
    expect(onChange).toHaveBeenLastCalledWith({ startSeconds: 5, endSeconds: 8 });
  });

  it("does not let another pointer steal timeline scrubbing", async () => {
    const onSeek = vi.fn();
    await act(async () =>
      root.render(
        <MediaTimelineTrack durationSeconds={10} seekOnPointerDrag onSeek={onSeek}>
          Track
        </MediaTimelineTrack>
      )
    );
    const track = requiredElement(
      container.querySelector<HTMLElement>('[data-slot="media-timeline-track"]')
    );
    await act(async () => {
      track.dispatchEvent(pointerEvent("pointerdown", 200));
      track.dispatchEvent(pointerEvent("pointerdown", 900, 2));
      track.dispatchEvent(pointerEvent("pointermove", 400));
    });
    expect(onSeek.mock.calls.map(([seconds]) => seconds)).toEqual([2, 4]);
    await act(async () => {
      track.dispatchEvent(pointerEvent("pointercancel", 400));
      track.dispatchEvent(pointerEvent("pointerdown", 800, 2));
    });
    expect(onSeek).toHaveBeenLastCalledWith(8);
  });
});

function pointerEvent(type: string, clientX: number, pointerId = 1): Event {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

function requiredElement<T extends Element>(element: T | null): T {
  if (!element) throw new Error("Missing required element.");
  return element;
}
