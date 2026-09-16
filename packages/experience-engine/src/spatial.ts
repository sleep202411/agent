import type {
  ExperienceOrientation,
  ExperienceSpatialAnchor,
  ExperienceSpatialGeometry,
} from "@repo/shared/experience-runtime";

export interface ExperienceSize {
  width: number;
  height: number;
}

export interface ExperienceViewportPoint {
  x: number;
  y: number;
}

export interface ExperienceViewportRect extends ExperienceViewportPoint {
  width: number;
  height: number;
}

export type ExperienceProjectedGeometry =
  | { kind: "rect"; rect: ExperienceViewportRect }
  | { kind: "ellipse"; bounds: ExperienceViewportRect }
  | { kind: "polygon"; points: ExperienceViewportPoint[] };

export interface ExperienceMediaContentTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  renderedWidth: number;
  renderedHeight: number;
  containerWidth: number;
  containerHeight: number;
}

export interface ExperienceAnchorHitTestInput {
  orientation: ExperienceOrientation;
  atMs: number;
  viewportPoint: ExperienceViewportPoint;
  viewportSize: ExperienceSize;
  rendererContentTransforms: ReadonlyMap<string, ExperienceMediaContentTransform>;
  trackingResolver?: ExperienceTrackingResolver;
}

export type ExperienceTrackingResolver = (input: {
  trackingAssetId: string;
  trackId: string;
  orientation: ExperienceOrientation;
  atMs: number;
}) => ExperienceSpatialGeometry;

export function createMediaContentTransform(
  container: ExperienceSize,
  source: ExperienceSize,
  fit: "contain" | "cover",
  alignment: { x: number; y: number } = { x: 0.5, y: 0.5 }
): ExperienceMediaContentTransform {
  assertPositiveSize(container, "container");
  assertPositiveSize(source, "source");
  if (alignment.x < 0 || alignment.x > 1 || alignment.y < 0 || alignment.y > 1) {
    throw new RangeError("Media alignment must remain between zero and one");
  }
  const widthScale = container.width / source.width;
  const heightScale = container.height / source.height;
  const scale =
    fit === "contain" ? Math.min(widthScale, heightScale) : Math.max(widthScale, heightScale);
  const renderedWidth = source.width * scale;
  const renderedHeight = source.height * scale;
  return {
    scale,
    renderedWidth,
    renderedHeight,
    offsetX: (container.width - renderedWidth) * alignment.x,
    offsetY: (container.height - renderedHeight) * alignment.y,
    containerWidth: container.width,
    containerHeight: container.height,
  };
}

export function normalizedContentPointToViewport(
  point: ExperienceViewportPoint,
  transform: ExperienceMediaContentTransform
): ExperienceViewportPoint {
  return {
    x: transform.offsetX + point.x * transform.renderedWidth,
    y: transform.offsetY + point.y * transform.renderedHeight,
  };
}

export function viewportPointToNormalizedContent(
  point: ExperienceViewportPoint,
  transform: ExperienceMediaContentTransform
): ExperienceViewportPoint {
  return {
    x: (point.x - transform.offsetX) / transform.renderedWidth,
    y: (point.y - transform.offsetY) / transform.renderedHeight,
  };
}

/**
 * Projects authored source-content geometry into the host viewport. Renderers
 * and hit testing consume the same transform, so visible affordances cannot
 * drift away from their interactive target under contain/cover cropping.
 */
export function projectExperienceGeometryToViewport(
  geometry: ExperienceSpatialGeometry,
  transform: ExperienceMediaContentTransform
): ExperienceProjectedGeometry {
  if (geometry.kind === "rect") {
    return { kind: "rect", rect: projectRect(geometry.rect, transform) };
  }
  if (geometry.kind === "ellipse") {
    return { kind: "ellipse", bounds: projectRect(geometry.bounds, transform) };
  }
  return {
    kind: "polygon",
    points: geometry.points.map((point) => normalizedContentPointToViewport(point, transform)),
  };
}

export function boundsOfExperienceProjectedGeometry(
  geometry: ExperienceProjectedGeometry
): ExperienceViewportRect {
  if (geometry.kind === "rect") return geometry.rect;
  if (geometry.kind === "ellipse") return geometry.bounds;
  const xs = geometry.points.map((point) => point.x);
  const ys = geometry.points.map((point) => point.y);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  return {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
  };
}

export function resolveExperienceAnchorGeometry(
  anchor: ExperienceSpatialAnchor,
  orientation: ExperienceOrientation,
  atMs: number,
  trackingResolver?: ExperienceTrackingResolver
): ExperienceSpatialGeometry {
  if (!Number.isFinite(atMs) || atMs < 0) {
    throw new RangeError("Anchor time must be a finite non-negative number");
  }
  if (anchor.motion.kind === "fixed") {
    return geometryForOrientation(anchor.geometry, orientation);
  }
  if (anchor.motion.kind === "tracked") {
    if (!trackingResolver) {
      throw new Error(`Tracked anchor ${anchor.anchorId} requires a tracking resolver`);
    }
    return trackingResolver({
      trackingAssetId: anchor.motion.trackingAssetId,
      trackId: anchor.motion.trackId,
      orientation,
      atMs,
    });
  }

  const keyframes = anchor.motion.keyframes;
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (!first || !last) throw new Error(`Anchor ${anchor.anchorId} has no keyframes`);
  if (atMs <= first.atMs) return geometryForOrientation(first.geometry, orientation);
  if (atMs >= last.atMs) return geometryForOrientation(last.geometry, orientation);
  const rightIndex = keyframes.findIndex((keyframe) => keyframe.atMs >= atMs);
  const right = keyframes[rightIndex];
  const left = keyframes[rightIndex - 1];
  if (!left || !right) throw new Error(`Anchor ${anchor.anchorId} cannot resolve keyframes`);
  const rawProgress = (atMs - left.atMs) / (right.atMs - left.atMs);
  const progress = applyEasing(rawProgress, right.easing);
  return interpolateGeometry(
    geometryForOrientation(left.geometry, orientation),
    geometryForOrientation(right.geometry, orientation),
    progress
  );
}

export function hitTestExperienceGeometry(
  geometry: ExperienceSpatialGeometry,
  viewportPoint: ExperienceViewportPoint,
  transform: ExperienceMediaContentTransform
): boolean {
  const point = viewportPointToNormalizedContent(viewportPoint, transform);
  if (geometry.kind === "rect") {
    return pointInRect(point, geometry.rect);
  }
  if (geometry.kind === "ellipse") {
    const centerX = geometry.bounds.x + geometry.bounds.width / 2;
    const centerY = geometry.bounds.y + geometry.bounds.height / 2;
    const normalizedX = (point.x - centerX) / (geometry.bounds.width / 2);
    const normalizedY = (point.y - centerY) / (geometry.bounds.height / 2);
    return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
  }

  const epsilon = 1e-9;
  let inside = false;
  for (
    let currentIndex = 0, previousIndex = geometry.points.length - 1;
    currentIndex < geometry.points.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = geometry.points[currentIndex];
    const previous = geometry.points[previousIndex];
    if (!current || !previous) continue;
    if (pointOnSegment(point, previous, current, epsilon)) return true;
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function hitTestExperienceAnchor(
  anchor: ExperienceSpatialAnchor,
  input: ExperienceAnchorHitTestInput
): boolean {
  const geometry = resolveExperienceAnchorGeometry(
    anchor,
    input.orientation,
    input.atMs,
    input.trackingResolver
  );
  const transform =
    anchor.space.kind === "viewport"
      ? createMediaContentTransform(input.viewportSize, input.viewportSize, "contain")
      : input.rendererContentTransforms.get(anchor.space.rendererInstanceId);
  if (!transform) {
    throw new Error(
      `Anchor ${anchor.anchorId} requires renderer transform ${
        anchor.space.kind === "renderer-content" ? anchor.space.rendererInstanceId : "viewport"
      }`
    );
  }
  return hitTestExperienceGeometry(geometry, input.viewportPoint, transform);
}

function geometryForOrientation(
  geometry: ExperienceSpatialAnchor["geometry"],
  orientation: ExperienceOrientation
): ExperienceSpatialGeometry {
  const oriented =
    orientation === "landscape"
      ? geometry.landscape
      : orientation === "portrait"
        ? geometry.portrait
        : geometry.square;
  const resolved = oriented ?? geometry.default;
  if (!resolved) {
    throw new Error(`No spatial geometry is authored for ${orientation}`);
  }
  return resolved;
}

function pointOnSegment(
  point: ExperienceViewportPoint,
  start: ExperienceViewportPoint,
  end: ExperienceViewportPoint,
  epsilon: number
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const progress =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
        );
  return (
    Math.hypot(point.x - (start.x + progress * dx), point.y - (start.y + progress * dy)) <= epsilon
  );
}

function interpolateGeometry(
  left: ExperienceSpatialGeometry,
  right: ExperienceSpatialGeometry,
  progress: number
): ExperienceSpatialGeometry {
  if (left.kind !== right.kind) {
    throw new Error("Spatial keyframes must preserve geometry kind");
  }
  if (left.kind === "rect" && right.kind === "rect") {
    return { kind: "rect", rect: interpolateRect(left.rect, right.rect, progress) };
  }
  if (left.kind === "ellipse" && right.kind === "ellipse") {
    return { kind: "ellipse", bounds: interpolateRect(left.bounds, right.bounds, progress) };
  }
  if (left.kind === "polygon" && right.kind === "polygon") {
    if (left.points.length !== right.points.length) {
      throw new Error("Polygon keyframes must preserve point count");
    }
    return {
      kind: "polygon",
      points: left.points.map((point, index) => {
        const target = right.points[index];
        if (!target) throw new Error("Polygon keyframe point is missing");
        return {
          x: interpolate(point.x, target.x, progress),
          y: interpolate(point.y, target.y, progress),
        };
      }),
    };
  }
  throw new Error("Spatial keyframes cannot be interpolated");
}

function interpolateRect(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
  progress: number
) {
  return {
    x: interpolate(left.x, right.x, progress),
    y: interpolate(left.y, right.y, progress),
    width: interpolate(left.width, right.width, progress),
    height: interpolate(left.height, right.height, progress),
  };
}

function projectRect(
  rect: { x: number; y: number; width: number; height: number },
  transform: ExperienceMediaContentTransform
): ExperienceViewportRect {
  const origin = normalizedContentPointToViewport(rect, transform);
  return {
    ...origin,
    width: rect.width * transform.renderedWidth,
    height: rect.height * transform.renderedHeight,
  };
}

function applyEasing(
  progress: number,
  easing: "linear" | "ease-in" | "ease-out" | "ease-in-out" | "step"
): number {
  if (easing === "step") return progress < 1 ? 0 : 1;
  if (easing === "ease-in") return progress * progress;
  if (easing === "ease-out") return 1 - (1 - progress) * (1 - progress);
  if (easing === "ease-in-out") {
    return progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
  }
  return progress;
}

function interpolate(left: number, right: number, progress: number): number {
  return left + (right - left) * progress;
}

function pointInRect(
  point: ExperienceViewportPoint,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function assertPositiveSize(size: ExperienceSize, label: string): void {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new RangeError(`${label} size must be finite and positive`);
  }
}
