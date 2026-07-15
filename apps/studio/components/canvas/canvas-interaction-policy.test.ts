import { describe, expect, it } from "vitest";
import {
  CANVAS_FULLSCREEN_OWNER_SELECTOR,
  CANVAS_KEYBOARD_OWNER_SELECTOR,
  CANVAS_NATIVE_POINTER_OWNER_SELECTOR,
  applyCanvasZoomExponent,
  canScrollCanvasOwner,
  canvasScrollDelta,
  canvasWheelZoomExponent,
  hasCanvasScrollOverflow,
  normalizeCanvasWheelDelta,
  resolveCanvasPointerMode,
  resolveCanvasWheelRoute,
  shouldStartCanvasPointerPan,
  translateCanvasViewport,
} from "./canvas-interaction-policy";

describe("canvas interaction geometry", () => {
  it("gives native media islands and their custom controls keyboard ownership", () => {
    expect(CANVAS_KEYBOARD_OWNER_SELECTOR).toContain(CANVAS_NATIVE_POINTER_OWNER_SELECTOR);
    expect(CANVAS_KEYBOARD_OWNER_SELECTOR).toContain("button");
    expect(CANVAS_KEYBOARD_OWNER_SELECTOR).toContain('[role="slider"]');
  });

  it("recognizes a player as sovereign only while Vidstack reports fullscreen", () => {
    expect(CANVAS_FULLSCREEN_OWNER_SELECTOR).toBe(
      "[data-canvas-fullscreen-owner][data-fullscreen]"
    );
  });

  it("switches one shared pointer contract between select and hand tools", () => {
    expect(resolveCanvasPointerMode("select")).toEqual({
      panOnDrag: [1],
      selectionOnDrag: true,
    });
    expect(resolveCanvasPointerMode("pan")).toEqual({
      panOnDrag: [0, 1],
      selectionOnDrag: false,
    });
  });

  it("keeps middle drag universal while primary drag follows Hand or Space", () => {
    expect(
      shouldStartCanvasPointerPan({
        button: 1,
        hasNativePointerOwner: true,
        primaryPanActive: false,
        spacePressed: false,
      })
    ).toBe(true);
    expect(
      shouldStartCanvasPointerPan({
        button: 0,
        hasNativePointerOwner: false,
        primaryPanActive: true,
        spacePressed: false,
      })
    ).toBe(true);
    expect(
      shouldStartCanvasPointerPan({
        button: 0,
        hasNativePointerOwner: true,
        primaryPanActive: false,
        spacePressed: true,
      })
    ).toBe(true);
    expect(
      shouldStartCanvasPointerPan({
        button: 0,
        hasNativePointerOwner: true,
        primaryPanActive: true,
        spacePressed: false,
      })
    ).toBe(false);
    expect(
      shouldStartCanvasPointerPan({
        button: 0,
        hasNativePointerOwner: false,
        primaryPanActive: false,
        spacePressed: false,
      })
    ).toBe(false);
    expect(
      shouldStartCanvasPointerPan({
        button: 2,
        hasNativePointerOwner: false,
        primaryPanActive: true,
        spacePressed: true,
      })
    ).toBe(false);
  });

  it("translates the viewport in screen space", () => {
    expect(translateCanvasViewport({ x: 30, y: -12, zoom: 0.75 }, 18, -7)).toEqual({
      x: 48,
      y: -19,
      zoom: 0.75,
    });
  });

  it("keeps the flow coordinate beneath the pointer fixed while zooming", () => {
    const viewport = { x: 40, y: -20, zoom: 0.5 };
    const point = { x: 260, y: 180 };
    const before = {
      x: (point.x - viewport.x) / viewport.zoom,
      y: (point.y - viewport.y) / viewport.zoom,
    };
    const next = applyCanvasZoomExponent(viewport, point, Math.log2(1.25 / 0.5), 0.16, 1.4);

    expect((point.x - next.x) / next.zoom).toBeCloseTo(before.x);
    expect((point.y - next.y) / next.zoom).toBeCloseTo(before.y);
    expect(next.zoom).toBeCloseTo(1.25);
  });

  it("clamps cursor-anchored zoom at the product limits", () => {
    expect(
      applyCanvasZoomExponent({ x: 0, y: 0, zoom: 1 }, { x: 100, y: 80 }, 8, 0.2, 1.4).zoom
    ).toBe(1.4);
    expect(
      applyCanvasZoomExponent({ x: 0, y: 0, zoom: 1 }, { x: 100, y: 80 }, -8, 0.2, 1.4).zoom
    ).toBe(0.2);
  });

  it("normalizes line, page, and shift-horizontal wheel input", () => {
    expect(
      normalizeCanvasWheelDelta({
        deltaX: 0,
        deltaY: 3,
        deltaMode: 1,
        shiftKey: false,
        viewportWidth: 1200,
        viewportHeight: 900,
      })
    ).toEqual({ x: 0, y: 60 });

    expect(
      normalizeCanvasWheelDelta({
        deltaX: 0,
        deltaY: 1,
        deltaMode: 2,
        shiftKey: true,
        viewportWidth: 1200,
        viewportHeight: 900,
      })
    ).toEqual({ x: 900, y: 0 });
  });

  it("uses trackpad-scale pinch sensitivity only for Apple ctrl-wheel", () => {
    expect(canvasWheelZoomExponent(-2, 0, true)).toBeCloseTo(0.04);
    expect(canvasWheelZoomExponent(-100, 0, false)).toBeCloseTo(0.2);
  });

  it("routes one-axis scroll owners without leaking the other axis", () => {
    expect(canvasScrollDelta("x", { x: 0, y: 24 })).toEqual({ x: 24, y: 0 });
    expect(canvasScrollDelta("x", { x: 0.1, y: 24 })).toEqual({ x: 24, y: 0 });
    expect(canvasScrollDelta("y", { x: 18, y: 24 })).toEqual({ x: 0, y: 24 });
    expect(canvasScrollDelta("both", { x: 18, y: 24 })).toEqual({ x: 18, y: 24 });
  });

  it("only gives a scroll owner the gesture when it can move in that direction", () => {
    const owner = {
      clientHeight: 100,
      clientWidth: 100,
      scrollHeight: 300,
      scrollLeft: 0,
      scrollTop: 0,
      scrollWidth: 100,
    };

    expect(canScrollCanvasOwner(owner, "y", { x: 0, y: 24 })).toBe(true);
    expect(canScrollCanvasOwner(owner, "y", { x: 0, y: -24 })).toBe(false);
    expect(canScrollCanvasOwner({ ...owner, scrollHeight: 100 }, "y", { x: 0, y: 24 })).toBe(false);
    expect(hasCanvasScrollOverflow(owner, "y")).toBe(true);
    expect(hasCanvasScrollOverflow({ ...owner, scrollHeight: 100 }, "y")).toBe(false);
  });

  it("keeps zoom global above scroll controls while native surfaces stay sovereign", () => {
    expect(
      resolveCanvasWheelRoute({
        hasNativeOwner: true,
        hasZoomModifier: true,
        hasZoomOwner: true,
        hasScrollableOwner: true,
        isBlocked: true,
      })
    ).toBe("native");
    expect(
      resolveCanvasWheelRoute({
        hasNativeOwner: false,
        hasZoomModifier: true,
        hasZoomOwner: false,
        hasScrollableOwner: true,
        isBlocked: true,
      })
    ).toBe("zoom");
    expect(
      resolveCanvasWheelRoute({
        hasNativeOwner: false,
        hasZoomModifier: false,
        hasZoomOwner: true,
        hasScrollableOwner: false,
        isBlocked: false,
      })
    ).toBe("zoom");
  });

  it("routes ordinary wheel input to exactly one scroll, block, or canvas owner", () => {
    expect(
      resolveCanvasWheelRoute({
        hasNativeOwner: false,
        hasZoomModifier: false,
        hasZoomOwner: false,
        hasScrollableOwner: true,
        isBlocked: true,
      })
    ).toBe("scroll");
    expect(
      resolveCanvasWheelRoute({
        hasNativeOwner: false,
        hasZoomModifier: false,
        hasZoomOwner: false,
        hasScrollableOwner: false,
        isBlocked: true,
      })
    ).toBe("blocked");
    expect(
      resolveCanvasWheelRoute({
        hasNativeOwner: false,
        hasZoomModifier: false,
        hasZoomOwner: false,
        hasScrollableOwner: false,
        isBlocked: false,
      })
    ).toBe("pan");
  });
});
