import type { CardReference, CardReferences } from "@/components/canvas/authoring/reference-stack";
import { ORDER_LAST, orderBetween } from "@repo/shared";
import type { FizzAiReferenceKind } from "./generation-api";

/**
 * The `shot` node contract — a storyboard shot as a first-class canvas node.
 *
 * A shot is the NARRATIVE unit (framing, movement, dialogue); the production
 * units (prompt / model / job) stay on the generation cards wired into it. The
 * storyboard table is a second rendering of the same canvas document: every
 * `shot` node is one row, ordered by its fractional `order` key.
 *
 * Pure module — no React, no Yjs. `type: "shot"` is persisted in the CRDT
 * forever, so this string may be added to but never renamed.
 */

export const SHOT_NODE_TYPE = "shot";

/** Card geometry — kept with the contract so layout code needn't import the
 *  component (and its React/i18n dependencies) just to reserve space. */
export const SHOT_NODE_WIDTH = 280;
/** Frame + header + chips + dialogue: what tidy reserves before measuring. */
export const SHOT_NODE_ESTIMATED_HEIGHT = 272;

/** Picture slot fed by an image source (still frame / storyboard panel). */
export const SHOT_FRAME_FIELD = "frame";
/** Picture slot fed by a video source (the animated shot). */
export const SHOT_CLIP_FIELD = "clip";

/**
 * A shot's picture slots, expressed as the same reference-field constraints a
 * generation card declares — so the shared wiring (connect, completion
 * back-fill, delete-unbind) routes into a shot with no special cases.
 */
export const SHOT_REFERENCE_FIELDS: readonly {
  field: string;
  kind: FizzAiReferenceKind;
  maxItems: number;
}[] = [
  // A shot's frame slot holds multiple candidate stills (upload several, pick the
  // 定稿/preferred one). Clip stays single — one animation per shot.
  { field: SHOT_FRAME_FIELD, kind: "image", maxItems: 24 },
  { field: SHOT_CLIP_FIELD, kind: "video", maxItems: 1 },
];

/**
 * Every field is a FLAT top-level key: the CRDT merges node data per field, so
 * two people editing different columns of the same row never overwrite each
 * other. (Long text is still coarse last-write-wins WITHIN one field — v1
 * accepts that; a Y.Text upgrade is the v2 fix.)
 */
export interface ShotNodeData {
  /** Fractional index — the single source of truth for row order. */
  order?: string;
  /** Optional custom shot name; the row number is derived, never stored. */
  label?: string;
  shotSize?: string;
  perspective?: string;
  movement?: string;
  durationSeconds?: number;
  dialogue?: string;
  notes?: string;
  /** 画面描述：构图/光影/氛围。支持 @引用。 */
  description?: string;
  /** 图片提示词：给 AI 生图的 prompt。支持 @引用。 */
  imagePrompt?: string;
  /** 视频提示词：给 AI 生视频的 prompt。支持 @引用。 */
  videoPrompt?: string;
  /** Picture slots — standard wire-bound references, keyed by field. */
  references?: CardReferences;
  /**
   * The edge id of the frame reference marked as the 定稿 (finalized still) when
   * a shot holds several candidates. Absent → the first frame reference is the
   * cover (preferredFrameReference falls back). Stored as a flat key so two
   * collaborators don't clobber each other's unrelated edits.
   */
  preferredFrameEdgeId?: string;
}

/** Stable option keys (never localized labels — the CRDT stays locale-free). */
export const SHOT_SIZE_OPTIONS = [
  "extremeWide",
  "wide",
  "full",
  "medium",
  "closeUp",
  "extremeCloseUp",
] as const;

export const SHOT_PERSPECTIVE_OPTIONS = [
  "eyeLevel",
  "high",
  "low",
  "birdsEye",
  "overShoulder",
  "pov",
  "dutch",
] as const;

export const SHOT_MOVEMENT_OPTIONS = [
  "static",
  "pan",
  "tilt",
  "dolly",
  "tracking",
  "zoom",
  "handheld",
  "crane",
] as const;

export function shotNodeData(node: { data?: unknown } | null | undefined): ShotNodeData {
  return (node?.data ?? {}) as ShotNodeData;
}

// ── picture slots ───────────────────────────────────────────────────────────

/**
 * Which picture slot an incoming `kind` binds to, or undefined when the shot
 * can't take it. `excludeEdgeId` is the wire being (re)bound — its own current
 * reference doesn't count against the slot, so a source that regenerates
 * re-binds its new output instead of being turned away by a full slot.
 */
export function routeShotReferenceField(
  references: CardReferences | undefined,
  kind: string,
  excludeEdgeId?: string
): { field: string } | undefined {
  const field = SHOT_REFERENCE_FIELDS.find((candidate) => candidate.kind === kind);
  if (!field) return undefined;
  const bound = (references?.[field.field] ?? []).filter(
    (reference) => !excludeEdgeId || reference.edgeId !== excludeEdgeId
  );
  return bound.length < field.maxItems ? { field: field.field } : undefined;
}

/** A shot's bound pictures, frame before clip (the order the table renders). */
export function shotReferences(data: ShotNodeData): CardReference[] {
  return SHOT_REFERENCE_FIELDS.flatMap((field) => data.references?.[field.field] ?? []);
}

/**
 * The frame reference to show as the shot's cover: the one marked 定稿
 * (`preferredFrameEdgeId`) if it still exists, otherwise the first frame ref.
 * Callers (cell, drawer preview, canvas node) all go through here so the three
 * surfaces stay consistent.
 */
export function preferredFrameReference(data: ShotNodeData): CardReference | undefined {
  const frames = data.references?.[SHOT_FRAME_FIELD] ?? [];
  const preferredId = data.preferredFrameEdgeId;
  if (preferredId) {
    const hit = frames.find((ref) => ref.edgeId === preferredId);
    if (hit) return hit;
  }
  return frames[0];
}

// ── row ordering (fractional index) ─────────────────────────────────────────

/**
 * A key strictly between two neighbours (null = start / end of the list).
 *
 * The algorithm lives in `@repo/shared` because the server mints keys too, when
 * an agent authors a shot. One implementation is the whole point: a key either
 * side mints must be a key the other side accepts — two implementations once
 * drifted, and rows landed in positions nobody asked for.
 */
export { orderBetween as shotOrderBetween };

// ── row projection ──────────────────────────────────────────────────────────

export type ShotNodeLike = {
  id: string;
  type?: string | null;
  data?: unknown;
  position?: { x: number; y: number };
};

/**
 * The shot nodes of a canvas, in storyboard order. The row number every shot
 * displays is this array's 1-based index — a projection, never stored, so
 * inserting or reordering rows writes no renumbering operations at all.
 */
export function sortedShots<T extends ShotNodeLike>(nodes: readonly T[]): T[] {
  return nodes
    .filter((node) => node.type === SHOT_NODE_TYPE)
    .sort((left, right) => {
      const leftKey = shotNodeData(left).order || ORDER_LAST;
      const rightKey = shotNodeData(right).order || ORDER_LAST;
      if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
}

/** The order key for a shot appended after the current last one. */
export function nextShotOrder(nodes: readonly ShotNodeLike[]): string {
  const shots = sortedShots(nodes);
  return orderBetween(shotNodeData(shots.at(-1)).order, null);
}
