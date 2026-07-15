import type { Viewport } from "@xyflow/react";

export const CANVAS_NODE_DRAG_HANDLE_CLASS = "canvas-node-drag-handle";
export const CANVAS_NODE_DRAG_HANDLE_SELECTOR = `.${CANVAS_NODE_DRAG_HANDLE_CLASS}`;
export const CANVAS_MANAGED_WHEEL_CLASS = "canvas-managed-wheel";
export const CANVAS_SCROLL_OWNER_SELECTOR = "[data-canvas-scroll-owner]";
export const CANVAS_NATIVE_WHEEL_OWNER_SELECTOR = "[data-canvas-native-wheel]";
export const CANVAS_NATIVE_POINTER_OWNER_SELECTOR = "[data-canvas-native-pointer]";
export const CANVAS_FULLSCREEN_OWNER_SELECTOR = "[data-canvas-fullscreen-owner][data-fullscreen]";
export const CANVAS_WHEEL_ZOOM_OWNER_SELECTOR = ".canvas-wheel-zoom";
export const CANVAS_BLOCKED_WHEEL_SELECTOR = ".nowheel";
export const CANVAS_KEYBOARD_OWNER_SELECTOR = [
  CANVAS_NATIVE_POINTER_OWNER_SELECTOR,
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "video",
  "audio",
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="slider"]',
].join(", ");

export type CanvasScrollAxis = "x" | "y" | "both";
export type CanvasWheelRoute = "native" | "zoom" | "scroll" | "blocked" | "pan";

export const CANVAS_MULTI_SELECTION_KEY = "Shift";
export const CANVAS_PAN_ACTIVATION_KEY = "Space";

export type CanvasTool = "select" | "pan";

export type CanvasPointerMode = {
  panOnDrag: number[];
  selectionOnDrag: boolean;
};

const CANVAS_SELECTION_MODE: CanvasPointerMode = {
  panOnDrag: [1],
  selectionOnDrag: true,
};

const CANVAS_PAN_MODE: CanvasPointerMode = {
  panOnDrag: [0, 1],
  selectionOnDrag: false,
};

export type CanvasWheelDeltaInput = {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  shiftKey: boolean;
  viewportWidth: number;
  viewportHeight: number;
};

export function resolveCanvasPointerMode(tool: CanvasTool): CanvasPointerMode {
  return tool === "select" ? CANVAS_SELECTION_MODE : CANVAS_PAN_MODE;
}

export function shouldStartCanvasPointerPan({
  button,
  hasNativePointerOwner,
  primaryPanActive,
  spacePressed,
}: {
  button: number;
  hasNativePointerOwner: boolean;
  primaryPanActive: boolean;
  spacePressed: boolean;
}): boolean {
  if (button === 1) return true;
  if (button !== 0) return false;
  if (spacePressed) return true;
  if (hasNativePointerOwner) return false;
  return primaryPanActive;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeCanvasWheelDelta({
  deltaX,
  deltaY,
  deltaMode,
  shiftKey,
  viewportWidth,
  viewportHeight,
}: CanvasWheelDeltaInput): { x: number; y: number } {
  const lineMultiplier = 20;
  const xMultiplier = deltaMode === 1 ? lineMultiplier : deltaMode === 2 ? viewportWidth : 1;
  const yMultiplier = deltaMode === 1 ? lineMultiplier : deltaMode === 2 ? viewportHeight : 1;
  let x = deltaX * xMultiplier;
  let y = deltaY * yMultiplier;

  if (shiftKey && Math.abs(x) < Math.abs(y)) {
    x = y;
    y = 0;
  }

  return { x, y };
}

export function canvasWheelZoomExponent(
  deltaY: number,
  deltaMode: number,
  appleTrackpadPinch: boolean
): number {
  const modeFactor = deltaMode === 1 ? 0.05 : deltaMode === 2 ? 1 : 0.002;
  return -deltaY * modeFactor * (appleTrackpadPinch ? 10 : 1);
}

export function translateCanvasViewport(
  viewport: Viewport,
  translateX: number,
  translateY: number
): Viewport {
  return {
    x: viewport.x + translateX,
    y: viewport.y + translateY,
    zoom: viewport.zoom,
  };
}

export function zoomCanvasViewportAtPoint(
  viewport: Viewport,
  point: { x: number; y: number },
  zoom: number
): Viewport {
  const flowX = (point.x - viewport.x) / viewport.zoom;
  const flowY = (point.y - viewport.y) / viewport.zoom;
  return {
    x: point.x - flowX * zoom,
    y: point.y - flowY * zoom,
    zoom,
  };
}

export function applyCanvasZoomExponent(
  viewport: Viewport,
  point: { x: number; y: number },
  exponent: number,
  minZoom: number,
  maxZoom: number
): Viewport {
  const zoom = clamp(viewport.zoom * 2 ** exponent, minZoom, maxZoom);
  return zoomCanvasViewportAtPoint(viewport, point, zoom);
}

export function canvasScrollDelta(
  axis: CanvasScrollAxis,
  delta: { x: number; y: number }
): { x: number; y: number } {
  if (axis === "x") {
    return {
      x: Math.abs(delta.x) >= Math.abs(delta.y) ? delta.x : delta.y,
      y: 0,
    };
  }
  if (axis === "y") {
    return { x: 0, y: delta.y };
  }
  return delta;
}

export function canScrollCanvasOwner(
  owner: Pick<
    HTMLElement,
    "clientHeight" | "clientWidth" | "scrollHeight" | "scrollLeft" | "scrollTop" | "scrollWidth"
  >,
  axis: CanvasScrollAxis,
  delta: { x: number; y: number }
): boolean {
  const routed = canvasScrollDelta(axis, delta);
  const canMoveX =
    routed.x < 0
      ? owner.scrollLeft > 0
      : routed.x > 0
        ? owner.scrollLeft + owner.clientWidth < owner.scrollWidth - 1
        : false;
  const canMoveY =
    routed.y < 0
      ? owner.scrollTop > 0
      : routed.y > 0
        ? owner.scrollTop + owner.clientHeight < owner.scrollHeight - 1
        : false;
  return canMoveX || canMoveY;
}

export function hasCanvasScrollOverflow(
  owner: Pick<HTMLElement, "clientHeight" | "clientWidth" | "scrollHeight" | "scrollWidth">,
  axis: CanvasScrollAxis
): boolean {
  const overflowsX = owner.scrollWidth > owner.clientWidth + 1;
  const overflowsY = owner.scrollHeight > owner.clientHeight + 1;
  return axis === "x" ? overflowsX : axis === "y" ? overflowsY : overflowsX || overflowsY;
}

export function resolveCanvasWheelRoute({
  hasNativeOwner,
  hasZoomModifier,
  hasZoomOwner,
  hasScrollableOwner,
  isBlocked,
}: {
  hasNativeOwner: boolean;
  hasZoomModifier: boolean;
  hasZoomOwner: boolean;
  hasScrollableOwner: boolean;
  isBlocked: boolean;
}): CanvasWheelRoute {
  if (hasNativeOwner) return "native";
  if (hasZoomModifier || hasZoomOwner) return "zoom";
  if (hasScrollableOwner) return "scroll";
  if (isBlocked) return "blocked";
  return "pan";
}
