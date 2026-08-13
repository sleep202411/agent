/**
 * Product-neutral canvas document shapes.
 *
 * These types describe the portable media-authoring graph contract only.
 * Creative Studio may persist them through Yjs while Story Studio persists
 * them as a project-owned document; neither persistence model owns the shapes.
 */
export interface CanvasNodeShape {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface CanvasEdgeShape {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export const CANVAS_GROUP_COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "green",
  "cyan",
  "blue",
  "indigo",
  "pink",
] as const;

export type CanvasGroupColor = (typeof CANVAS_GROUP_COLORS)[number];

export const DEFAULT_CANVAS_GROUP_COLOR = "slate" satisfies CanvasGroupColor;

/**
 * Product-neutral visual grouping metadata.
 *
 * Bounds are always derived from member nodes so grouping never owns or
 * duplicates node geometry. Product adapters decide how this metadata is
 * persisted.
 */
export interface CanvasGroup {
  id: string;
  nodeIds: string[];
  color: CanvasGroupColor;
}

/**
 * Semantic category for a canvas asset — drives Character / Scene filters in
 * the asset library and `@`-mention picker. Absent on old data → treat as
 * `general`.
 */
export type AssetCategory = "general" | "character" | "scene";

/**
 * A durable media inventory entry owned by a canvas document.
 *
 * `mediaAssetId` is the cross-product media identity. Canvas-local `id`
 * remains free to represent imports, legacy entries, or generated outputs
 * before a durable media record exists.
 */
export interface CanvasAsset {
  id: string;
  mediaAssetId?: string;
  kind: "image" | "video" | "audio";
  source: "generated" | "uploaded";
  url: string;
  width?: number;
  height?: number;
  name?: string;
  prompt?: string;
  panorama?: boolean;
  createdAt: number;
  /** Semantic category. Absent on old data — readers treat undefined as "general". */
  category?: AssetCategory;
}
