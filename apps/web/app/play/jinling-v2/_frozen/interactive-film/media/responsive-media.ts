import type {
  RuntimeImageAsset,
  RuntimeVideoAsset,
  RuntimeVisualVariant,
} from "../domain/release-manifest";

export type VisualOrientation = "landscape" | "portrait";

export type NormalizedSafeArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ViewportRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ResponsiveVisualAsset = RuntimeImageAsset | RuntimeVideoAsset;

export function visualOrientationForViewport(width: number, height: number): VisualOrientation {
  return height > width ? "portrait" : "landscape";
}

/**
 * Media fallback is authored, never accidental. A paired asset must contain
 * the requested orientation; only an explicit single-master asset may reuse
 * its sole authored variant across orientations.
 */
export function selectResponsiveVisualVariant(
  asset: ResponsiveVisualAsset,
  orientation: VisualOrientation
): RuntimeVisualVariant {
  const requested = asset.variants[orientation];
  if (requested) return requested;

  if (asset.orientationPolicy !== "single-master") {
    throw new Error(`Media ${asset.assetId} has no ${orientation} variant`);
  }

  const soleVariant = asset.variants.landscape ?? asset.variants.portrait;
  if (!soleVariant) throw new Error(`Media ${asset.assetId} has no authored visual variant`);
  return soleVariant;
}

export function sameVisualSource(
  left: RuntimeVisualVariant | null,
  right: RuntimeVisualVariant | null
): boolean {
  return left?.src === right?.src;
}

/**
 * Projects an authored, normalized frame area through the same cover/contain
 * transform used by the visual stage. This keeps interactive and dynamic
 * overlays attached to the underlying shot even when the viewport crops it.
 */
export function projectNormalizedSafeAreaToViewport(
  area: NormalizedSafeArea,
  source: { width: number; height: number },
  viewport: { width: number; height: number },
  fit: "cover" | "contain"
): ViewportRect {
  if (source.width <= 0 || source.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    throw new Error("Source and viewport dimensions must be positive");
  }

  const horizontalScale = viewport.width / source.width;
  const verticalScale = viewport.height / source.height;
  const scale =
    fit === "cover"
      ? Math.max(horizontalScale, verticalScale)
      : Math.min(horizontalScale, verticalScale);
  const renderedWidth = source.width * scale;
  const renderedHeight = source.height * scale;
  const offsetX = (viewport.width - renderedWidth) / 2;
  const offsetY = (viewport.height - renderedHeight) / 2;

  return {
    left: offsetX + area.x * renderedWidth,
    top: offsetY + area.y * renderedHeight,
    width: area.width * renderedWidth,
    height: area.height * renderedHeight,
  };
}
