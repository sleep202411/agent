import type { Node } from "@xyflow/react";

/**
 * Visual geometry contract for every durable canvas node type.
 *
 * Widths intentionally form a small optical scale instead of forcing every
 * card into one rectangle: compact text/identity nodes, standard media/story
 * nodes, and primary generation nodes. Heights remain content-aware;
 * `estimatedHeight` is only the pre-measurement reservation used by layout,
 * grouping and hit-testing.
 */
export interface CanvasNodeGeometry {
  width: number;
  minHeight: number;
  estimatedHeight: number;
}

const COMPACT_WIDTH = 280;
const STANDARD_WIDTH = 320;
const PRIMARY_WIDTH = 360;

const GEOMETRY_BY_TYPE: Readonly<Record<string, CanvasNodeGeometry>> = {
  note: geometry(COMPACT_WIDTH, 168, 188),
  image: geometry(STANDARD_WIDTH, 180, 260),
  videoAsset: geometry(STANDARD_WIDTH, 180, 220),
  audioAsset: geometry(STANDARD_WIDTH, 120, 156),
  shot: geometry(STANDARD_WIDTH, 248, 284),
  panorama: geometry(PRIMARY_WIDTH, 180, 224),
  prompt: geometry(PRIMARY_WIDTH, 320, 408),
  video: geometry(PRIMARY_WIDTH, 232, 280),
  audio: geometry(PRIMARY_WIDTH, 168, 216),
};

const FALLBACK_GEOMETRY = geometry(STANDARD_WIDTH, 160, 240);

function geometry(width: number, minHeight: number, estimatedHeight: number): CanvasNodeGeometry {
  return { width, minHeight, estimatedHeight };
}

/** Resolve a visual spec before the DOM exists. */
export function canvasNodeGeometry(
  node: Pick<Node, "type" | "data"> | { type?: string | null; data?: Record<string, unknown> }
): CanvasNodeGeometry {
  if (node.type === "storyCanvas") return storyNodeGeometry(node.data);
  return GEOMETRY_BY_TYPE[node.type ?? ""] ?? FALLBACK_GEOMETRY;
}

/**
 * Runtime bounds: a real DOM measurement wins, otherwise the durable visual
 * spec does. Measurements are deliberately ephemeral and never persisted.
 */
export function canvasNodeLayoutSize(
  node: Pick<Node, "type" | "data" | "measured" | "width" | "height">
): { width: number; height: number } {
  const spec = canvasNodeGeometry(node);
  return {
    width: positive(node.measured?.width) ?? positive(node.width) ?? spec.width,
    height: positive(node.measured?.height) ?? positive(node.height) ?? spec.estimatedHeight,
  };
}

function storyNodeGeometry(data: Record<string, unknown> | undefined): CanvasNodeGeometry {
  if (data?.kind === "character") return geometry(COMPACT_WIDTH, 120, 140);
  const interactionCount = Array.isArray(data?.interactions) ? data.interactions.length : 0;
  const interactionHeight = interactionCount > 0 ? 52 + interactionCount * 44 : 0;
  if (data?.kind === "clip" && data.exitKind === "choice") {
    const choiceCount = Array.isArray(data.choices) ? data.choices.length : 0;
    return geometry(
      STANDARD_WIDTH,
      364 + interactionHeight,
      364 + interactionHeight + choiceCount * 48
    );
  }
  return geometry(STANDARD_WIDTH, 236 + interactionHeight, 268 + interactionHeight);
}

function positive(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
