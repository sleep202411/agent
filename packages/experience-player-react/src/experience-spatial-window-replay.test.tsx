// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExperienceSpatialLayer } from "./experience-spatial-layer";

type Props = ComponentProps<typeof ExperienceSpatialLayer>;

// The rendered layer keeps its own settled state while playback moves forward
// and backward. No event adapter or gesture availability logic is mocked.
function fixture({ timeout = false, holdFrame = false } = {}): Props["scene"] {
  return {
    kind: "scene",
    sceneId: "scene.window",
    clock: { kind: "none" },
    renderers: [],
    anchors: [
      {
        anchorId: "anchor.tap",
        space: { kind: "viewport" },
        motion: { kind: "fixed" },
        geometry: { default: { kind: "rect", rect: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 } } },
      },
    ],
    gestures: [
      {
        gestureId: "gesture.tap",
        kind: "tap",
        anchorId: "anchor.tap",
        inputActionId: "action.tap",
        maxDurationMs: 500,
        activeWindow: { startMs: 100, endMs: 1000 },
        ...(holdFrame ? { holdFrame: true } : {}),
      },
    ],
    timeline: { cues: [] },
    eventBindings: timeout
      ? [
          {
            bindingId: "tap.timeout",
            on: { type: "gesture.timed-out", sourceId: "gesture.tap" },
            routes: [],
          },
        ]
      : [],
  };
}

const manifest = {
  assets: [],
  inputActions: [{ actionId: "action.tap", label: { "en-US": "Optional tap" }, required: false }],
  localization: { defaultLocale: "en-US" },
} as unknown as Props["manifest"];
const state = {} as Props["runtimeState"];

describe("spatial windows during watched playback replay", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onEvents = vi.fn<Props["onEvents"]>();
  const onSettled = vi.fn<NonNullable<Props["onSettledGestureIdsChange"]>>();
  const onGate = vi.fn<NonNullable<Props["onTimelineHoldGateChange"]>>();
  const onError = vi.fn();
  const button = () => container.querySelector<HTMLButtonElement>("button")!;
  const render = (
    scene: Props["scene"],
    sceneTimeMs: number,
    initialSettledGestureIds?: readonly string[]
  ) => {
    act(() =>
      root.render(
        <ExperienceSpatialLayer
          manifest={manifest}
          scene={scene}
          runtimeState={state}
          sceneTimeMs={sceneTimeMs}
          locale="en-US"
          orientation="landscape"
          onEvents={onEvents}
          onRuntimeError={onError}
          onSettledGestureIdsChange={onSettled}
          onTimelineHoldGateChange={onGate}
          initialSettledGestureIds={initialSettledGestureIds}
        />
      )
    );
  };
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      top: 0,
      left: 0,
      right: 100,
      bottom: 100,
      toJSON() {},
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onEvents.mockClear();
    onSettled.mockClear();
    onGate.mockClear();
    onError.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps an optional expired window closed on rewind even without a timeout binding", () => {
    const scene = fixture();
    render(scene, 1000);
    expect(button().getAttribute("aria-disabled")).toBe("false");
    expect(onSettled).not.toHaveBeenCalled();
    render(scene, 1001);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(["gesture.tap"]);
    expect(onEvents).not.toHaveBeenCalled();
    render(scene, 500);
    expect(button().getAttribute("aria-disabled")).toBe("true");
    expect(container.querySelector("[data-experience-gesture-available]")).toBeNull();
    act(() => button().click());
    expect(onEvents).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("dispatches a bound timeout once and never repeats it while replay crosses the same window", () => {
    const scene = fixture({ timeout: true });
    render(scene, 500);
    render(scene, 1001);
    expect(onEvents).toHaveBeenCalledExactlyOnceWith([
      {
        type: "gesture.timed-out",
        sourceId: "gesture.tap",
        payload: { sceneTimeMs: 1001, activeWindowEndMs: 1000 },
      },
    ]);
    render(scene, 1100);
    render(scene, 500);
    render(scene, 1200);
    act(() => button().click());
    expect(onEvents).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(["gesture.tap"]);
  });

  it("retains restored settled windows when their saved playback position is inside the old window", () => {
    render(fixture({ timeout: true }), 500, ["gesture.tap"]);
    expect(button().getAttribute("aria-disabled")).toBe("true");
    act(() => button().click());
    expect(onEvents).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("keeps a hold-frame hotspot live after its window until it is actually resolved", () => {
    const scene = fixture({ timeout: true, holdFrame: true });
    render(scene, 1500);
    expect(button().getAttribute("aria-disabled")).toBe("false");
    expect(onGate).toHaveBeenLastCalledWith(true);
    expect(onEvents).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
    act(() => button().click());
    expect(onEvents).toHaveBeenCalledExactlyOnceWith([
      { type: "gesture.completed", sourceId: "gesture.tap", payload: {} },
    ]);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith(["gesture.tap"]);
    expect(onGate).toHaveBeenLastCalledWith(false);
    render(scene, 500);
    expect(button().getAttribute("aria-disabled")).toBe("true");
    expect(onEvents).toHaveBeenCalledTimes(1);
  });
});
