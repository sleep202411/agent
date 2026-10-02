// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { ExperienceSpatialLayer } from "./experience-spatial-layer";
import { ExperienceStoryClock, ExperienceStoryClockContext } from "./experience-story-clock";

type Props = ComponentProps<typeof ExperienceSpatialLayer>;
let container: HTMLDivElement;
let root: Root;
let clock: ExperienceStoryClock;
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
      kind: "press-hold",
      anchorId: "anchor",
      inputActionId: "swipe",
      timelineControl: true,
      durationMs: 1000,
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
  clock = new ExperienceStoryClock({ paused: false });
  onEvents.mockClear();
  render(scene);
});

function render(layerScene: Props["scene"]) {
  act(() =>
    root.render(
      <ExperienceStoryClockContext.Provider value={clock}>
        <ExperienceSpatialLayer
          manifest={
            {
              assets: [],
              inputActions: [],
              localization: { defaultLocale: "en-US" },
            } as unknown as Props["manifest"]
          }
          scene={layerScene}
          runtimeState={{} as Props["runtimeState"]}
          sceneTimeMs={0}
          locale="en-US"
          orientation="landscape"
          onEvents={onEvents}
          onRuntimeError={vi.fn()}
        />
      </ExperienceStoryClockContext.Provider>
    )
  );
  const button = container.querySelector("button")!;
  button.setPointerCapture = vi.fn();
  button.releasePointerCapture = vi.fn();
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pointer(type: string, id: number, x = 0) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x });
  Object.defineProperty(event, "pointerId", { value: id });
  act(() => container.querySelector("button")!.dispatchEvent(event));
}

function key(type: string, value: string) {
  act(() =>
    container
      .querySelector("button")!
      .dispatchEvent(new KeyboardEvent(type, { bubbles: true, key: value }))
  );
}
function pressed() {
  return container.querySelector("button")!.getAttribute("aria-pressed");
}

it.each(["pointerup", "pointercancel", "lostpointercapture"])(
  "ignores unrelated %s during a hold",
  (type) => {
    pointer("pointerdown", 1);
    pointer("pointerdown", 2);
    pointer(type, 2);
    expect(pressed()).toBe("true");
    expect(onEvents).not.toHaveBeenCalled();
    pointer("pointerup", 1);
    expect(pressed()).toBe("false");
    expect(onEvents).toHaveBeenCalledWith([expect.objectContaining({ type: "gesture.cancelled" })]);
  }
);

it("does not let a keyboard release cancel a pointer hold", () => {
  pointer("pointerdown", 1);
  key("keyup", "Enter");
  expect(pressed()).toBe("true");
  expect(onEvents).not.toHaveBeenCalled();
});

it("keeps a keyboard hold until the originating key is released", () => {
  key("keydown", "Enter");
  key("keydown", " ");
  key("keyup", " ");
  expect(pressed()).toBe("true");
  key("keyup", "Enter");
  expect(pressed()).toBe("false");
});

it("ends a hold when focus leaves", () => {
  key("keydown", "Enter");
  act(() =>
    container.querySelector("button")!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
  );
  expect(pressed()).toBe("false");
  expect(onEvents).toHaveBeenCalledWith([expect.objectContaining({ type: "gesture.cancelled" })]);
});

/**
 * A pause is not a release: a hold in progress when the story clock pauses is
 * dropped without a verdict, and what `inert` brings next — a blur, the lost
 * capture, the finger lifting — has nothing left to decide.
 */
it("drops a charge in progress when the story pauses, and takes no verdict from it", () => {
  pointer("pointerdown", 1);
  expect(pressed()).toBe("true");

  act(() => clock.pause());

  expect(pressed()).toBe("false");
  expect(container.querySelector("button")!.releasePointerCapture).toHaveBeenCalledWith(1);
  pointer("lostpointercapture", 1);
  pointer("pointerup", 1);
  act(() =>
    container.querySelector("button")!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
  );
  expect(onEvents).not.toHaveBeenCalled();

  // After the resume the viewer holds again, and that hold is judged.
  act(() => clock.resume());
  pointer("pointerdown", 2);
  expect(pressed()).toBe("true");
  pointer("pointerup", 2);
  expect(onEvents).toHaveBeenCalledWith([expect.objectContaining({ type: "gesture.cancelled" })]);
});

it("drops a plain hold when the story pauses, without the cancel a release would send", () => {
  render({
    ...scene,
    gestures: [
      {
        gestureId: "hold",
        kind: "press-hold",
        anchorId: "anchor",
        inputActionId: "hold",
        durationMs: 1000,
        releaseBehavior: "reset",
        cancelOnPointerExit: false,
      },
    ],
  } as unknown as Props["scene"]);
  key("keydown", "Enter");
  expect(onEvents).toHaveBeenCalledWith([expect.objectContaining({ type: "gesture.started" })]);
  onEvents.mockClear();

  act(() => clock.pause());
  key("keyup", "Enter");

  expect(pressed()).toBe("false");
  expect(onEvents).not.toHaveBeenCalled();
});
