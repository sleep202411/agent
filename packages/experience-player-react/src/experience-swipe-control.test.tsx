// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { ExperienceFrameRotationContext } from "./experience-landscape-presentation";
import { ExperienceSpatialLayer } from "./experience-spatial-layer";

type Props = ComponentProps<typeof ExperienceSpatialLayer>;
let container: HTMLDivElement;
let root: Root;
const onEvents = vi.fn();
const scene = {
  sceneId: "scene",
  renderers: [],
  eventBindings: [],
  anchors: [
    {
      anchorId: "anchor",
      space: { kind: "viewport" },
      motion: { kind: "fixed" },
      geometry: { default: { kind: "rect", rect: { x: 0, y: 0, width: 1, height: 1 } } },
    },
  ],
  gestures: [
    {
      gestureId: "swipe",
      kind: "swipe",
      anchorId: "anchor",
      inputActionId: "swipe",
      directions: ["right"],
      minimumDistance: 0.1,
      maximumDurationMs: 10000,
      activeWindow: { startMs: 0, endMs: 1000 },
    },
  ],
} as unknown as Props["scene"];

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
  document.body.append(container);
  root = createRoot(container);
  onEvents.mockClear();
  render();
  container.querySelector("button")!.setPointerCapture = vi.fn();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(sceneTimeMs = 0, rotated = false) {
  act(() =>
    root.render(
      <ExperienceFrameRotationContext.Provider value={rotated}>
        <ExperienceSpatialLayer
          manifest={
            {
              assets: [],
              inputActions: [],
              localization: { defaultLocale: "en-US" },
            } as unknown as Props["manifest"]
          }
          scene={scene}
          runtimeState={{} as Props["runtimeState"]}
          sceneTimeMs={sceneTimeMs}
          locale="en-US"
          orientation="landscape"
          onEvents={onEvents}
          onRuntimeError={vi.fn()}
        />
      </ExperienceFrameRotationContext.Provider>
    )
  );
}

function pointer(type: string, id: number, x = 0, y = 0) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: id });
  act(() => container.querySelector("button")!.dispatchEvent(event));
}

it("reads a swipe in the picture's axes when the frame is drawn sideways", () => {
  render(0, true);
  // On a frame turned clockwise, the picture's right runs down the screen.
  pointer("pointerdown", 1, 0, 0);
  pointer("pointerup", 1, 0, 50);
  expect(onEvents).toHaveBeenCalledWith([
    expect.objectContaining({
      type: "gesture.completed",
      payload: expect.objectContaining({ direction: "right" }),
    }),
  ]);
});

it("reads the same screen movement as down on an upright frame", () => {
  pointer("pointerdown", 1, 0, 0);
  pointer("pointerup", 1, 0, 50);
  expect(onEvents).toHaveBeenCalledWith([
    expect.objectContaining({
      type: "gesture.cancelled",
      payload: expect.objectContaining({ direction: "down" }),
    }),
  ]);
});

it("shows a swipe cue with the action label", () => {
  expect(container.querySelector("svg")).not.toBeNull();
  expect(container.textContent).toContain("swipe");
});

it("keeps the first pointer when another finger touches the swipe", () => {
  pointer("pointerdown", 1);
  pointer("pointerdown", 2);
  pointer("pointerup", 1, 50);
  expect(onEvents).toHaveBeenCalledWith([expect.objectContaining({ type: "gesture.completed" })]);
});

it.each(["pointercancel", "lostpointercapture"])("ignores unrelated %s events", (type) => {
  pointer("pointerdown", 1);
  pointer(type, 2);
  expect(onEvents).not.toHaveBeenCalled();
  pointer("pointerup", 1, 50);
  expect(onEvents).toHaveBeenCalledWith([expect.objectContaining({ type: "gesture.completed" })]);
});

it("cancels the owning pointer and allows a fresh swipe", () => {
  pointer("pointerdown", 1);
  pointer("pointercancel", 1);
  expect(onEvents).toHaveBeenCalledWith([expect.objectContaining({ type: "gesture.cancelled" })]);
  onEvents.mockClear();
  pointer("pointerdown", 2);
  pointer("pointerup", 2, 50);
  expect(onEvents).toHaveBeenCalledWith([expect.objectContaining({ type: "gesture.completed" })]);
});

it("does not complete a captured swipe after its active window closes", () => {
  pointer("pointerdown", 1);
  render(1001);
  pointer("pointerup", 1, 50);
  expect(onEvents.mock.calls.flatMap((call) => call[0])).not.toContainEqual(
    expect.objectContaining({ type: "gesture.completed" })
  );
});

it("abandons a swipe when focus leaves", () => {
  pointer("pointerdown", 1);
  act(() =>
    container.querySelector("button")!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
  );
  onEvents.mockClear();
  pointer("pointerup", 1, 50);
  expect(onEvents).not.toHaveBeenCalled();
  pointer("pointerdown", 2);
  pointer("pointerup", 2, 50);
  expect(onEvents).toHaveBeenCalledWith([expect.objectContaining({ type: "gesture.completed" })]);
});
