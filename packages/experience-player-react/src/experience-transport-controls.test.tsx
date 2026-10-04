// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExperiencePlaybackTransportControls,
  type ExperiencePlaybackTransportControlsProps,
} from "./experience-transport-controls";

let container: HTMLDivElement;
let root: Root;
const onSeek = vi.fn();
const onRate = vi.fn();
const onStageTap = vi.fn();
const copy = {
  controlsLabel: "Playback controls",
  rewind10: "Back 10 seconds",
  forward10: "Forward 10 seconds",
  progressLabel: "Clip progress",
  speedLabel: "Playback speed",
  watchedOnlyHint: "You can only skip to a position you have watched.",
  interactionBlocked: "Playback controls are unavailable during an interaction.",
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onSeek.mockReset();
  onRate.mockReset();
  onStageTap.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  render();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(overrides: Partial<ExperiencePlaybackTransportControlsProps> = {}) {
  act(() => {
    root.render(
      <div onClick={onStageTap}>
        <ExperiencePlaybackTransportControls
          copy={copy}
          positionMs={20_000}
          durationMs={100_000}
          seekLimitMs={40_000}
          rate={1}
          onSeek={onSeek}
          onRate={onRate}
          {...overrides}
        />
      </div>
    );
  });
}

function button(label: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}

function slider() {
  return container.querySelector<HTMLInputElement>('input[type="range"]')!;
}

function setProgress(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      slider(),
      value
    );
    slider().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function speedButton() {
  return container.querySelector<HTMLButtonElement>(`button[aria-label^="${copy.speedLabel}"]`)!;
}

describe("clip transport controls", () => {
  it("labels native controls and exposes watched-only guidance in tooltips and assistive text", () => {
    expect(container.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe(
      copy.controlsLabel
    );
    expect(slider().getAttribute("aria-label")).toBe(copy.progressLabel);
    expect(slider().max).toBe("100000");
    expect(slider().value).toBe("20000");
    expect(slider().getAttribute("aria-valuetext")).toBe("0:20 / 1:40");
    expect(speedButton().getAttribute("aria-label")).toContain(copy.speedLabel);
    expect(speedButton().getAttribute("aria-label")).toContain("1×");
    expect(speedButton().textContent).toBe("1×");
    expect(container.querySelector("select")).toBeNull();
    const hint = document.getElementById(slider().getAttribute("aria-describedby")!);
    expect(hint?.textContent).toBe(copy.watchedOnlyHint);
    expect(hint?.className).toBe("sr-only");
    expect(slider().title).toContain(copy.watchedOnlyHint);
    expect(button(copy.forward10).title).toContain(copy.watchedOnlyHint);
  });

  it("rewinds ten seconds within the clip", () => {
    act(() => button(copy.rewind10).click());
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(10_000);
  });

  it("rewinds to zero near the start", () => {
    render({ positionMs: 2_000 });
    act(() => button(copy.rewind10).click());
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("disables rewind at the clip start", () => {
    render({ positionMs: 0 });
    expect(button(copy.rewind10).disabled).toBe(true);
    act(() => button(copy.rewind10).click());
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("advances ten seconds within the watched range", () => {
    act(() => button(copy.forward10).click());
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(30_000);
  });

  it("stops a forward step at the watched limit", () => {
    render({ seekLimitMs: 25_000 });
    act(() => button(copy.forward10).click());
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(25_000);
  });

  it("disables fast forward at the watched limit", () => {
    render({ positionMs: 40_000 });
    expect(button(copy.forward10).disabled).toBe(true);
    act(() => button(copy.forward10).click());
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("clamps a drag into unwatched footage and restores the controlled value", () => {
    setProgress("90000");
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(40_000);
    expect(slider().value).toBe("20000");
  });

  it("allows a drag back through watched footage", () => {
    setProgress("5000");
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(5_000);
  });

  it("does not seek outside the current clip even if its limit is malformed", () => {
    render({ positionMs: 95_000, seekLimitMs: 500_000 });
    act(() => button(copy.forward10).click());
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(100_000);
  });

  it("keeps pause or interaction controls disabled with an accessible reason", () => {
    render({ disabled: true, disabledReason: "Resume the film to seek." });
    expect(slider().disabled).toBe(true);
    expect(speedButton().disabled).toBe(true);
    expect(button(copy.rewind10).disabled).toBe(true);
    expect(button(copy.forward10).disabled).toBe(true);
    expect(
      document.getElementById(slider().getAttribute("aria-describedby")!)?.textContent
    ).toContain("Resume the film to seek.");
    expect(slider().title).toContain("Resume the film to seek.");
    expect(speedButton().title).toContain(copy.speedLabel);
    expect(
      document.getElementById(speedButton().getAttribute("aria-describedby")!)?.textContent
    ).toContain("Resume the film to seek.");
    setProgress("5000");
    act(() => speedButton().click());
    expect(onSeek).not.toHaveBeenCalled();
    expect(onRate).not.toHaveBeenCalled();
  });

  it("uses the interaction explanation when no custom reason is supplied", () => {
    render({ disabled: true });
    expect(container.textContent).toContain(copy.interactionBlocked);
  });

  it.each([
    [1, 1.25],
    [1.25, 1.5],
    [1.5, 2],
    [2, 1],
  ])("cycles speed from %s to %s with one click", (rate, nextRate) => {
    render({ rate });
    expect(speedButton().textContent).toBe(`${rate}×`);
    expect(speedButton().getAttribute("aria-label")).toContain(`${rate}×`);
    act(() => speedButton().click());
    expect(onRate).toHaveBeenCalledExactlyOnceWith(nextRate);
  });

  it("falls back to normal speed when the supplied rate is unsupported", () => {
    render({ rate: 3 });
    expect(speedButton().textContent).toBe("1×");
    act(() => speedButton().click());
    expect(onRate).toHaveBeenCalledExactlyOnceWith(1.25);
  });

  it.each([NaN, Infinity, 0, -1])("disables seeking when duration is %s", (durationMs) => {
    render({ durationMs });
    expect(slider().disabled).toBe(true);
    expect(slider().value).toBe("0");
    expect(slider().getAttribute("aria-valuetext")).toBe("0:00 / 0:00");
    expect(slider().style.backgroundImage).not.toContain("NaN");
  });

  it("handles an invalid seek limit without granting access to unwatched footage", () => {
    render({ seekLimitMs: NaN });
    expect(slider().disabled).toBe(true);
    expect(button(copy.forward10).disabled).toBe(true);
  });

  it("formats long clips without losing the hour", () => {
    render({ positionMs: 3_661_000, durationMs: 7_262_000, seekLimitMs: 7_262_000 });
    expect(slider().getAttribute("aria-valuetext")).toBe("1:01:01 / 2:01:02");
    expect(container.textContent).not.toContain(copy.watchedOnlyHint);
  });

  it("does not pass control or strip clicks to the film's tap-to-pause handler", () => {
    act(() => {
      button(copy.rewind10).click();
      slider().click();
      speedButton().click();
      container.querySelector<HTMLElement>("[data-experience-transport-controls]")!.click();
    });
    expect(onStageTap).not.toHaveBeenCalled();
  });
});
