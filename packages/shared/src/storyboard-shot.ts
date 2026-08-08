/**
 * The storyboard shot contract, shared by everything that authors one.
 *
 * A shot is a canvas node; the storyboard table is a second rendering of the
 * same document. Three writers exist — the browser (a human editing a row), the
 * Nest domain (an agent tool), and the worker's local test domain — and they
 * must agree on the node type, the strip geometry, and the option keys, or the
 * same board renders differently depending on who last touched it.
 *
 * Option keys are STABLE and locale-free: the CRDT stores the key, the UI
 * localises it at render time. An agent that writes "中景" or "medium shot"
 * instead of "medium" produces a row whose dropdown renders nothing.
 */

export const SHOT_NODE_TYPE = "shot";

/** Node width and the gap between shots, used to lay out the horizontal strip. */
export const SHOT_NODE_WIDTH = 280;
export const SHOT_STRIP_GAP = 64;
/** Vertical clearance when a board's first shot has to dodge existing nodes. */
export const SHOT_STRIP_OFFSET_Y = 240;
/** Fallback height when a node has never been measured by the client. */
export const SHOT_NODE_ASSUMED_HEIGHT = 200;

/** Node-id namespace for agent-authored shots — provenance, not permission. */
export const AGENT_SHOT_ID_PREFIX = "agent-os:shot:";

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

export type ShotSize = (typeof SHOT_SIZE_OPTIONS)[number];
export type ShotPerspective = (typeof SHOT_PERSPECTIVE_OPTIONS)[number];
export type ShotMovement = (typeof SHOT_MOVEMENT_OPTIONS)[number];

/**
 * Where the next shot goes: continuing the strip to the right of the rightmost
 * shot, or — on a board with no shots yet — clear of whatever else is there.
 *
 * Both the browser and the server place shots, so this lives here: a server
 * that starts at the origin while the browser dodges existing nodes drops the
 * agent's first shot on top of the user's generation cards.
 */
export function nextShotPosition(
  nodes: ReadonlyArray<{
    type?: string | null;
    position?: { x: number; y: number } | null;
    height?: number | null;
  }>
): { x: number; y: number } {
  let rightmost: { x: number; y: number } | null = null;
  for (const node of nodes) {
    if (node.type !== SHOT_NODE_TYPE || !node.position) continue;
    if (!rightmost || node.position.x > rightmost.x) {
      rightmost = { x: node.position.x, y: node.position.y };
    }
  }
  if (rightmost) {
    return { x: rightmost.x + SHOT_NODE_WIDTH + SHOT_STRIP_GAP, y: rightmost.y };
  }

  const placed = nodes.filter((node) => node.position);
  if (placed.length === 0) return { x: 0, y: 0 };

  // First shot on a board that already holds other work: start a fresh strip
  // below it rather than landing on top of it.
  let left = Infinity;
  let bottom = -Infinity;
  for (const node of placed) {
    const position = node.position as { x: number; y: number };
    left = Math.min(left, position.x);
    bottom = Math.max(bottom, position.y + (node.height ?? SHOT_NODE_ASSUMED_HEIGHT));
  }
  return { x: left, y: bottom + SHOT_STRIP_OFFSET_Y };
}

// ── the write contract ──────────────────────────────────────────────────────

/**
 * Validation PRIMITIVES rather than a zod schema, deliberately.
 *
 * This monorepo carries a dozen physical zod installs on two different 4.x
 * minors, and a schema built by one is not type-assignable to another. Sharing
 * the primitives kills the drift that actually bites — a limit or an option key
 * that differs between tiers — while each tier builds its own schema object.
 * `ShotWrite` below is the structural guard: a tier whose schema stops matching
 * it fails to compile.
 */

/** Agent ids and raw UUIDs both — a leading digit MUST be accepted. */
export const SHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export const SHOT_LIMITS = {
  idMax: 120,
  titleMax: 200,
  promptMax: 8_000,
  descriptionMax: 8_000,
  videoPromptMax: 8_000,
  notesMax: 4_000,
  dialogueMax: 4_000,
  durationSecondsMax: 3_600,
  /** Rows per write — the approval card has to stay readable. */
  batchMax: 200,
} as const;

/**
 * One shot in a write. Every field but the id is optional: a write PATCHES the
 * fields it names and leaves the rest alone, which is what lets an agent edit
 * and a human edit to the same row survive each other.
 */
export interface ShotWrite {
  id: string;
  intent: "create" | "replace";
  /**
   * Row placement: put this shot immediately after the named one, `null` for
   * the top of the board. Absent means append (create) or stay put (replace).
   */
  after?: string | null;
  title?: string;
  /** 图片提示词 — fed to image generation, not the human-facing description. */
  prompt?: string;
  /** 画面描述 — framing / light / mood, written for a person to read. */
  description?: string;
  notes?: string;
  dialogue?: string;
  /** 视频提示词 — fed to video generation. */
  videoPrompt?: string;
  shotSize?: ShotSize;
  perspective?: ShotPerspective;
  movement?: ShotMovement;
  durationSeconds?: number;
}

/**
 * `baseRevision` is ADVISORY everywhere it appears. Shots live in a CRDT whose
 * updates commute, so a hard compare-and-swap would reject an agent write for
 * an unrelated human keystroke. Staleness is reported back, never fatal.
 */
export interface ShotsUpsertInput {
  baseRevision?: number;
  shots: ShotWrite[];
}

export interface ShotsDeleteInput {
  baseRevision?: number;
  shotIds: string[];
}
