// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryHotspotStage } from "./story-hotspot-stage";

const capture = vi.hoisted(() => ({ props: {} as Record<string, (event: unknown) => void> }));
vi.mock("react-konva", () => ({
  Stage: (props: typeof capture.props) => {
    capture.props = props;
    return null;
  },
  Group: () => null,
  Layer: () => null,
  Rect: () => null,
  Text: () => null,
  Transformer: () => null,
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function setup() {
  const onCreate = vi.fn(() => "hotspot-1");
  const onRectChange = vi.fn();
  const onDrawComplete = vi.fn();
  const props: ComponentProps<typeof StoryHotspotStage> = {
    width: 800,
    height: 450,
    drafts: [],
    selectedId: null,
    currentTime: 0,
    mode: "edit",
    tool: "rectangle",
    minimumSize: 0.035,
    onCreate,
    onRectChange,
    onDrawComplete,
    onSelect: vi.fn(),
    onPreview: vi.fn(),
  };
  act(() => root.render(<StoryHotspotStage {...props} />));
  let position = { x: 0, y: 0 };
  const surface = {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  };
  const stage = {
    getStage: () => stage,
    getPointerPosition: () => position,
    container: () => surface,
  };
  const pointer = (handler: string, x: number, y: number, pointerId = 1) => {
    position = { x, y };
    act(() =>
      capture.props[handler]!({
        target: stage,
        evt: { button: 0, pointerId, preventDefault: vi.fn() },
      })
    );
  };
  return { pointer, onCreate, onRectChange, onDrawComplete, surface };
}

it("creates a minimum-sized rectangle inside the bottom-right video edge on click", () => {
  const s = setup();
  s.pointer("onPointerDown", 800, 450);
  s.pointer("onPointerUp", 800, 450);
  expect(s.onCreate).toHaveBeenCalledWith({ x: 0.965, y: 0.965, width: 0.035, height: 0.035 });
  expect(s.onDrawComplete).toHaveBeenCalledTimes(1);
  expect(s.surface.releasePointerCapture).toHaveBeenCalledWith(1);
});

it("keeps a tiny edge drag above the minimum size instead of shrinking it to zero", () => {
  const s = setup();
  s.pointer("onPointerDown", 800, 450);
  s.pointer("onPointerMove", 799, 449);
  expect(s.onRectChange).toHaveBeenLastCalledWith("hotspot-1", {
    x: 0.965,
    y: 0.965,
    width: 0.035,
    height: 0.035,
  });
});

it("supports reverse-direction drags and ignores other pointers", () => {
  const s = setup();
  s.pointer("onPointerDown", 600, 360);
  s.pointer("onPointerMove", 100, 100, 2);
  expect(s.onRectChange).not.toHaveBeenCalled();
  s.pointer("onPointerMove", 200, 90);
  expect(s.onRectChange).toHaveBeenLastCalledWith("hotspot-1", {
    x: 0.25,
    y: 0.2,
    width: 0.5,
    height: expect.closeTo(0.6),
  });
});

it("does not replace an active draw when a second pointer presses the stage", () => {
  const s = setup();
  s.pointer("onPointerDown", 200, 90);
  s.pointer("onPointerDown", 700, 400, 2);
  s.pointer("onPointerMove", 600, 360);
  expect(s.onCreate).toHaveBeenCalledTimes(1);
  expect(s.onRectChange).toHaveBeenLastCalledWith("hotspot-1", {
    x: 0.25,
    y: 0.2,
    width: 0.5,
    height: expect.closeTo(0.6),
  });
  s.pointer("onPointerUp", 700, 400, 2);
  expect(s.onDrawComplete).not.toHaveBeenCalled();
  s.pointer("onPointerUp", 600, 360);
  expect(s.onDrawComplete).toHaveBeenCalledTimes(1);
});

it("releases a cancelled draw so the next pointer can start a new hotspot", () => {
  const s = setup();
  s.pointer("onPointerDown", 200, 90);
  s.pointer("onPointerCancel", 200, 90);
  s.pointer("onPointerMove", 600, 360);
  expect(s.onRectChange).not.toHaveBeenCalled();
  expect(s.surface.releasePointerCapture).toHaveBeenCalledWith(1);
  s.pointer("onPointerDown", 400, 225, 2);
  expect(s.onCreate).toHaveBeenCalledTimes(2);
});
