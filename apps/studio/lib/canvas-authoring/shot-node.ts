import type { CardReference, CardReferences } from "@/components/canvas/authoring/reference-stack";
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
  { field: SHOT_FRAME_FIELD, kind: "image", maxItems: 1 },
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
  /** Picture slots — standard wire-bound references, keyed by field. */
  references?: CardReferences;
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

// ── row ordering (fractional index) ─────────────────────────────────────────

/**
 * Order keys are base-62 fractions over this ASCII-ascending alphabet, so plain
 * string comparison IS the sort. A key never ends in the smallest digit, which
 * is what guarantees a midpoint always exists between two neighbours — inserting
 * or reordering a row writes ONE key and renumbers nothing.
 */
const ORDER_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ORDER_BASE = ORDER_DIGITS.length;
/** Sorts after every real key, so an order-less shot lands at the end. */
const ORDER_LAST = "\uffff";

function midpoint(lower: string, upper: string | null): string {
  if (upper !== null && lower >= upper) throw new Error(`shot order out of range: ${lower}`);
  if (lower.endsWith(ORDER_DIGITS[0]) || upper?.endsWith(ORDER_DIGITS[0])) {
    throw new Error("shot order has a trailing zero");
  }
  if (upper !== null) {
    // Copy the shared prefix verbatim and recurse on the remainder (`lower` is
    // padded with zeros as we go; `upper` can't run out first, being larger).
    let shared = 0;
    while ((lower[shared] ?? ORDER_DIGITS[0]) === upper[shared]) shared += 1;
    if (shared > 0) {
      return upper.slice(0, shared) + midpoint(lower.slice(shared), upper.slice(shared));
    }
  }
  const lowerDigit = lower ? ORDER_DIGITS.indexOf(lower[0]) : 0;
  const upperDigit = upper !== null ? ORDER_DIGITS.indexOf(upper[0]) : ORDER_BASE;
  if (upperDigit - lowerDigit > 1) {
    return ORDER_DIGITS[Math.round(0.5 * (lowerDigit + upperDigit))];
  }
  // Consecutive first digits: borrow a digit and split the level below.
  if (upper !== null && upper.length > 1) return upper.slice(0, 1);
  return ORDER_DIGITS[lowerDigit] + midpoint(lower.slice(1), null);
}

function isOrderKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.endsWith(ORDER_DIGITS[0]) &&
    [...value].every((char) => ORDER_DIGITS.includes(char))
  );
}

/**
 * A key strictly between two neighbours (null = start / end of the list).
 * Degenerate input (equal or inverted neighbours, a foreign key from an older
 * client) appends after `lower` instead of throwing — a storyboard must never
 * lose a row to a bad sort key.
 */
export function shotOrderBetween(
  lower: string | null | undefined,
  upper: string | null | undefined
): string {
  const before = isOrderKey(lower) ? lower : null;
  const after = isOrderKey(upper) ? upper : null;
  try {
    return midpoint(before ?? "", after);
  } catch {
    return midpoint(before ?? "", null);
  }
}

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
  return shotOrderBetween(shotNodeData(shots.at(-1)).order, null);
}
