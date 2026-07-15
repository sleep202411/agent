import { CANVAS_MANAGED_WHEEL_CLASS, type CanvasTool } from "./canvas-interaction-policy";

export const CANVAS_MEDIA_PREVIEW_MIN_SCALE = 0.5;

export type CanvasMediaPreviewState = {
  tool: CanvasTool;
  scale: number;
  panReady: boolean;
  panning: boolean;
  nodeDragging: boolean;
};

export type CanvasManualPlaybackState = Pick<
  CanvasMediaPreviewState,
  "panReady" | "panning" | "nodeDragging"
>;

export function allowsCanvasMediaPreview({
  tool,
  scale,
  panReady,
  panning,
  nodeDragging,
}: CanvasMediaPreviewState): boolean {
  return (
    tool === "select" &&
    Number.isFinite(scale) &&
    scale >= CANVAS_MEDIA_PREVIEW_MIN_SCALE &&
    !panReady &&
    !panning &&
    !nodeDragging
  );
}

export function allowsCanvasManualPlayback({
  panReady,
  panning,
  nodeDragging,
}: CanvasManualPlaybackState): boolean {
  return !panReady && !panning && !nodeDragging;
}

/** Reads the product-level CanvasReactFlow contract without subscribing every node to zoom. */
export function canActivateCanvasMediaPreview(element: HTMLElement): boolean {
  const context = readCanvasMediaContext(element);
  if (!context) return false;
  const { surface, node } = context;

  const tool = surface.dataset.canvasTool === "pan" ? "pan" : "select";
  const renderedWidth = node.getBoundingClientRect().width;
  const scale = node.offsetWidth > 0 ? renderedWidth / node.offsetWidth : 0;

  return allowsCanvasMediaPreview({
    tool,
    scale,
    panReady: surface.dataset.canvasPanReady === "true",
    panning: surface.dataset.canvasPanning === "true",
    nodeDragging: node.classList.contains("dragging"),
  });
}

/** Manual playback remains available at every zoom, except during an explicit canvas gesture. */
export function canClaimCanvasManualPlayback(element: HTMLElement): boolean {
  const context = readCanvasMediaContext(element);
  if (!context) return false;
  const { surface, node } = context;
  return allowsCanvasManualPlayback({
    panReady: surface.dataset.canvasPanReady === "true",
    panning: surface.dataset.canvasPanning === "true",
    nodeDragging: node.classList.contains("dragging"),
  });
}

function readCanvasMediaContext(element: HTMLElement): {
  surface: HTMLElement;
  node: HTMLElement;
} | null {
  const surface = element.closest<HTMLElement>(`.${CANVAS_MANAGED_WHEEL_CLASS}`);
  const node = element.closest<HTMLElement>(".react-flow__node");
  return surface && node ? { surface, node } : null;
}
