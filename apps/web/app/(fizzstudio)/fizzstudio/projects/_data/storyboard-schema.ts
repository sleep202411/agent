/**
 * Storyboard content model — what lives inside PlatformDocument.contentSnapshot
 * for a `storyboard`-type document.
 *
 * Design (per product decisions):
 *  - Columns are PRESET for now but stored AS DATA (not hardcoded in the
 *    renderer), so future custom columns are a data change, not an architecture
 *    change. `DEFAULT_COLUMNS` seeds a fresh storyboard.
 *  - Shots are an ordered array; each cell is keyed by column id (sparse).
 *  - The server stores this JSON verbatim — it does not validate the shape.
 *    We own migration via `schema`.
 */

export const STORYBOARD_SCHEMA = "fizzstudio.storyboard.v1" as const;

// ─── Column model ─────────────────────────────────────────────────────────────

/**
 * How a column renders + edits. `shotNo` is the implicit index column (not
 * user-editable). Media/ref kinds get richer editors built in later increments.
 */
export type ColumnKind =
  | "shotNo"
  | "image"
  | "video"
  | "text"
  | "richtext"
  | "number"
  | "select"
  | "character"
  | "scene";

export interface StoryboardColumn {
  /** Stable id — preset columns use `col_<preset>`, custom use a uuid. */
  id: string;
  kind: ColumnKind;
  /** Preset key (maps to the legacy presetColumnKey family). Absent for custom. */
  preset?: string;
  /** i18n key under `fizzStudio` for preset labels. */
  labelKey?: string;
  /** Literal label for custom columns (takes precedence over labelKey). */
  label?: string;
  order: number;
  hidden?: boolean;
  /** Pixel width for the table view. */
  width?: number;
  /** Options for `select` kind (stored as plain strings or i18n keys). */
  options?: string[];
}

// ─── Cell + shot model ────────────────────────────────────────────────────────

export interface MediaItem {
  id: string;
  url?: string;
  /** OSS storage path (for preferred tracking / regeneration). */
  path?: string;
  preferred?: boolean;
  status?: "cancelled" | "done" | "failed" | "generating" | "pending";
  /** Backend generation job that owns this media slot. */
  jobId?: string;
  stage?: string;
  progress?: number | null;
  error?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  mimeType?: string;
}

export interface ShotCell {
  /** Plain text (text / select kinds). */
  text?: string;
  /** Rich HTML (richtext kind, with future @mentions). */
  richText?: string;
  /** Numeric value (number kind, e.g. duration seconds). */
  number?: number;
  /** Image / video items (image / video kinds). */
  media?: MediaItem[];
  /** Referenced asset ids (character / scene kinds). */
  refs?: string[];
}

export interface Shot {
  id: string;
  order: number;
  /** columnId → cell. Sparse — missing key = empty cell. */
  cells: Record<string, ShotCell>;
}

// ─── Canvas view state (per-view layout, stored alongside shared shots) ───────

export interface CanvasEdge {
  id: string;
  /** Source canvas node id. Can be a shot id or a generated asset node id. */
  source: string;
  /** Target canvas node id. Can be a shot id or a generated asset node id. */
  target: string;
  /** Relationship type. Sequence is the default production flow. */
  kind?: "sequence" | "reference" | "variant";
  label?: string;
}

export interface CanvasNodePos {
  x: number;
  y: number;
}

export type CanvasAssetNodeKind = "panorama";

export type CanvasGenerationStatus =
  | "cancelled"
  | "done"
  | "failed"
  | "generating"
  | "idle"
  | "queued";

export interface CanvasGenerationState {
  jobId?: string;
  status?: CanvasGenerationStatus;
  stage?: string;
  progress?: number | null;
  error?: string;
  submittedAt?: string;
  completedAt?: string;
}

export interface CanvasAssetNode {
  id: string;
  kind: CanvasAssetNodeKind;
  title?: string;
  prompt?: string;
  sourceShotId?: string;
  media?: MediaItem[];
  status?: CanvasGenerationStatus;
  generation?: CanvasGenerationState;
  settings?: {
    modelId?: string;
    schemaVersion?: string;
    input?: Record<string, string | number | boolean>;
    referenceField?: string;
    aspectRatio?: "2:1";
    model?: string;
    outputCount?: number;
    quality?: "standard" | "high";
    resolution?: "2K" | "4K";
  };
}

export interface CanvasState {
  /** Non-shot generation / media nodes that live only on the creative canvas. */
  nodes?: CanvasAssetNode[];
  /** canvas node id → free position on the infinite board. */
  positions: Record<string, CanvasNodePos>;
  /** Connections between canvas nodes (sequence flow / generation relationships). */
  edges: CanvasEdge[];
  /** Last viewport so the board reopens where the user left it. */
  viewport?: { x: number; y: number; zoom: number };
}

export interface StoryboardContent {
  schema: typeof STORYBOARD_SCHEMA;
  columns: StoryboardColumn[];
  shots: Shot[];
  /** Canvas-view layout. Optional — created on first canvas interaction. */
  canvas?: CanvasState;
}

// ─── Default preset columns ───────────────────────────────────────────────────

/**
 * The fixed preset column set a fresh storyboard starts with. Mirrors the
 * legacy core columns. Stored into contentSnapshot on first edit so it can be
 * customized later without code changes.
 */
export const DEFAULT_COLUMNS: StoryboardColumn[] = [
  {
    id: "col_shot_no",
    kind: "shotNo",
    preset: "shot_no",
    labelKey: "sbColShotNo",
    order: 0,
    width: 56,
  },
  {
    id: "col_image",
    kind: "image",
    preset: "image_path",
    labelKey: "sbColImage",
    order: 1,
    width: 200,
  },
  {
    id: "col_description",
    kind: "richtext",
    preset: "description",
    labelKey: "sbColDescription",
    order: 2,
    width: 240,
  },
  {
    id: "col_dialogue",
    kind: "richtext",
    preset: "dialogue",
    labelKey: "sbColDialogue",
    order: 3,
    width: 220,
  },
  {
    id: "col_duration",
    kind: "number",
    preset: "duration",
    labelKey: "sbColDuration",
    order: 4,
    width: 96,
  },
  {
    id: "col_shot_size",
    kind: "select",
    preset: "shot_size",
    labelKey: "sbColShotSize",
    order: 5,
    width: 120,
    options: [
      "sbShotSizeWide",
      "sbShotSizeFull",
      "sbShotSizeMedium",
      "sbShotSizeCloseup",
      "sbShotSizeExtremeCloseup",
    ],
  },
  {
    id: "col_angle",
    kind: "select",
    preset: "perspective",
    labelKey: "sbColAngle",
    order: 6,
    width: 120,
    options: ["sbAngleEye", "sbAngleHigh", "sbAngleLow", "sbAngleBird", "sbAngleDutch"],
  },
  {
    id: "col_movement",
    kind: "select",
    preset: "movement",
    labelKey: "sbColMovement",
    order: 7,
    width: 120,
    options: [
      "sbMoveStatic",
      "sbMovePan",
      "sbMoveTilt",
      "sbMoveDolly",
      "sbMoveZoom",
      "sbMoveTracking",
    ],
  },
  {
    id: "col_video",
    kind: "video",
    preset: "video_path",
    labelKey: "sbColVideo",
    order: 8,
    width: 200,
  },
];

// ─── Pure helpers (no side effects) ───────────────────────────────────────────

let _idCounter = 0;
/**
 * Local id generator for shots/media created client-side before persistence.
 * Not crypto — just unique within a session. (Date.now()/random avoided to keep
 * deterministic-ish; uniqueness comes from the counter + a per-call salt.)
 */
export function localId(prefix: string): string {
  _idCounter += 1;
  const time =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  return `${prefix}_${_idCounter.toString(36)}_${time.toString(36).replace(".", "")}`;
}

/** A fresh, empty storyboard content blob. */
export function emptyStoryboard(): StoryboardContent {
  return { schema: STORYBOARD_SCHEMA, columns: DEFAULT_COLUMNS, shots: [] };
}

/**
 * Normalize whatever came back from the server into a valid StoryboardContent.
 * Handles the empty-{} case (fresh doc) and missing fields defensively.
 */
export function normalizeStoryboard(raw: unknown): StoryboardContent {
  if (!raw || typeof raw !== "object") return emptyStoryboard();
  const obj = raw as Partial<StoryboardContent>;
  const columns =
    Array.isArray(obj.columns) && obj.columns.length > 0 ? obj.columns : DEFAULT_COLUMNS;
  const shots = Array.isArray(obj.shots) ? obj.shots : [];
  const normalizedShots = [...shots].sort((a, b) => a.order - b.order);
  return {
    schema: STORYBOARD_SCHEMA,
    columns: [...columns].sort((a, b) => a.order - b.order),
    shots: normalizedShots,
    canvas: normalizeCanvas(obj.canvas, normalizedShots),
  };
}

/** Visible columns in display order. */
export function visibleColumns(content: StoryboardContent): StoryboardColumn[] {
  return content.columns.filter((c) => !c.hidden).sort((a, b) => a.order - b.order);
}

/** Append a new empty shot at the end (or after `afterShotId`). */
export function addShot(content: StoryboardContent, afterShotId?: string): StoryboardContent {
  const shots = [...content.shots].sort((a, b) => a.order - b.order);
  const newShot: Shot = { id: localId("shot"), order: 0, cells: {} };
  let insertIndex = shots.length;
  if (afterShotId) {
    const idx = shots.findIndex((s) => s.id === afterShotId);
    if (idx >= 0) insertIndex = idx + 1;
  }
  shots.splice(insertIndex, 0, newShot);
  return { ...content, shots: reindex(shots) };
}

/** Remove a shot. */
export function removeShot(content: StoryboardContent, shotId: string): StoryboardContent {
  const shots = content.shots.filter((s) => s.id !== shotId);
  const canvas = getCanvas(content);
  const positions = { ...canvas.positions };
  delete positions[shotId];
  return {
    ...content,
    shots: reindex(shots),
    canvas: {
      ...canvas,
      nodes: (canvas.nodes ?? []).map((node) =>
        node.sourceShotId === shotId ? { ...node, sourceShotId: undefined } : node
      ),
      positions,
      edges: canvas.edges.filter((e) => e.source !== shotId && e.target !== shotId),
    },
  };
}

/** Move a shot from one index to another (drag-reorder). */
export function reorderShots(
  content: StoryboardContent,
  fromId: string,
  toIndex: number
): StoryboardContent {
  const shots = [...content.shots].sort((a, b) => a.order - b.order);
  const fromIndex = shots.findIndex((s) => s.id === fromId);
  if (fromIndex < 0) return content;
  const [moved] = shots.splice(fromIndex, 1);
  shots.splice(Math.max(0, Math.min(toIndex, shots.length)), 0, moved!);
  return { ...content, shots: reindex(shots) };
}

/** Set a single cell value (immutable update). */
export function setCell(
  content: StoryboardContent,
  shotId: string,
  columnId: string,
  cell: ShotCell
): StoryboardContent {
  return {
    ...content,
    shots: content.shots.map((s) =>
      s.id === shotId ? { ...s, cells: { ...s.cells, [columnId]: cell } } : s
    ),
  };
}

export function updateShotCell(
  content: StoryboardContent,
  shotId: string,
  columnId: string,
  updater: (cell: ShotCell) => ShotCell
): StoryboardContent {
  return {
    ...content,
    shots: content.shots.map((s) =>
      s.id === shotId
        ? {
            ...s,
            cells: {
              ...s.cells,
              [columnId]: updater(s.cells[columnId] ?? {}),
            },
          }
        : s
    ),
  };
}

/** Set multiple cells in one immutable edit, used by the inspector panel. */
export function setCells(
  content: StoryboardContent,
  shotId: string,
  cells: Record<string, ShotCell>
): StoryboardContent {
  return {
    ...content,
    shots: content.shots.map((s) =>
      s.id === shotId ? { ...s, cells: { ...s.cells, ...cells } } : s
    ),
  };
}

function reindex(shots: Shot[]): Shot[] {
  return shots.map((s, i) => ({ ...s, order: i }));
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────

const EMPTY_CANVAS: CanvasState = { nodes: [], positions: {}, edges: [] };

/** Canvas state with safe defaults. */
export function getCanvas(content: StoryboardContent): CanvasState {
  return content.canvas ?? EMPTY_CANVAS;
}

function normalizeCanvas(raw: unknown, shots: Shot[]): CanvasState {
  const shotIds = new Set(shots.map((s) => s.id));
  if (!raw || typeof raw !== "object") return { nodes: [], positions: {}, edges: [] };
  const obj = raw as Partial<CanvasState>;
  const nodes = Array.isArray(obj.nodes)
    ? obj.nodes.flatMap((node) => {
        if (!node || typeof node !== "object") return [];
        const n = node as Partial<CanvasAssetNode>;
        if (!n.id || n.kind !== "panorama") return [];
        const media = Array.isArray(n.media)
          ? n.media.filter((item): item is MediaItem =>
              Boolean(item && typeof item === "object" && item.id)
            )
          : undefined;
        return [
          {
            id: n.id,
            kind: n.kind,
            title: typeof n.title === "string" ? n.title : undefined,
            prompt: typeof n.prompt === "string" ? n.prompt : undefined,
            sourceShotId:
              typeof n.sourceShotId === "string" && shotIds.has(n.sourceShotId)
                ? n.sourceShotId
                : undefined,
            media,
            status: n.status ?? "idle",
            generation: n.generation,
            settings: n.settings,
          },
        ];
      })
    : [];
  const nodeIds = new Set([...shotIds, ...nodes.map((node) => node.id)]);
  const positions: Record<string, CanvasNodePos> = {};
  const rawPositions = obj.positions;
  if (rawPositions && typeof rawPositions === "object") {
    for (const [nodeId, pos] of Object.entries(rawPositions)) {
      if (!nodeIds.has(nodeId) || !pos || typeof pos !== "object") continue;
      const p = pos as Partial<CanvasNodePos>;
      if (typeof p.x === "number" && typeof p.y === "number") {
        positions[nodeId] = { x: p.x, y: p.y };
      }
    }
  }

  const seenEdges = new Set<string>();
  const edges = Array.isArray(obj.edges)
    ? obj.edges.flatMap((edge) => {
        if (!edge || typeof edge !== "object") return [];
        const e = edge as Partial<CanvasEdge>;
        if (!e.id || !e.source || !e.target) return [];
        if (!nodeIds.has(e.source) || !nodeIds.has(e.target) || e.source === e.target) return [];
        const signature = `${e.source}->${e.target}:${e.kind ?? "sequence"}`;
        if (seenEdges.has(signature)) return [];
        seenEdges.add(signature);
        return [
          {
            id: e.id,
            source: e.source,
            target: e.target,
            kind: e.kind ?? "sequence",
            label: e.label,
          },
        ];
      })
    : [];

  const viewport =
    obj.viewport &&
    typeof obj.viewport.x === "number" &&
    typeof obj.viewport.y === "number" &&
    typeof obj.viewport.zoom === "number"
      ? obj.viewport
      : undefined;

  return { nodes, positions, edges, viewport };
}

/** Add a shot AND place it on the canvas at `pos` (used when adding from the board). */
export function addShotAtCanvas(
  content: StoryboardContent,
  pos: CanvasNodePos
): { content: StoryboardContent; shotId: string } {
  const shots = [...content.shots].sort((a, b) => a.order - b.order);
  const shotId = localId("shot");
  shots.push({ id: shotId, order: shots.length, cells: {} });
  const canvas = getCanvas(content);
  return {
    content: {
      ...content,
      shots: reindex(shots),
      canvas: { ...canvas, positions: { ...canvas.positions, [shotId]: pos } },
    },
    shotId,
  };
}

/** Persist a node's position after a drag. */
export function setNodePosition(
  content: StoryboardContent,
  nodeId: string,
  pos: CanvasNodePos
): StoryboardContent {
  const canvas = getCanvas(content);
  return {
    ...content,
    canvas: { ...canvas, positions: { ...canvas.positions, [nodeId]: pos } },
  };
}

/** Persist several node positions in one patch, used by auto-layout. */
export function setCanvasPositions(
  content: StoryboardContent,
  positions: Record<string, CanvasNodePos>
): StoryboardContent {
  const canvas = getCanvas(content);
  return {
    ...content,
    canvas: { ...canvas, positions: { ...canvas.positions, ...positions } },
  };
}

/** Connect two canvas nodes. No-op if the edge already exists or is a self-loop. */
export function addCanvasEdge(
  content: StoryboardContent,
  source: string,
  target: string
): { content: StoryboardContent; edgeId: string | null } {
  if (source === target) return { content, edgeId: null };
  const canvas = getCanvas(content);
  const existing = canvas.edges.find((e) => e.source === source && e.target === target);
  if (existing) return { content, edgeId: existing.id };
  const edgeId = localId("edge");
  return {
    content: {
      ...content,
      canvas: {
        ...canvas,
        edges: [...canvas.edges, { id: edgeId, source, target, kind: "sequence" }],
      },
    },
    edgeId,
  };
}

/** Remove a canvas edge. */
export function removeCanvasEdge(content: StoryboardContent, edgeId: string): StoryboardContent {
  const canvas = getCanvas(content);
  return { ...content, canvas: { ...canvas, edges: canvas.edges.filter((e) => e.id !== edgeId) } };
}

export function addCanvasAssetNode(
  content: StoryboardContent,
  node: Omit<CanvasAssetNode, "id">,
  pos: CanvasNodePos
): { content: StoryboardContent; nodeId: string } {
  const canvas = getCanvas(content);
  const nodeId = localId(node.kind);
  return {
    content: {
      ...content,
      canvas: {
        ...canvas,
        nodes: [...(canvas.nodes ?? []), { ...node, id: nodeId }],
        positions: { ...canvas.positions, [nodeId]: pos },
      },
    },
    nodeId,
  };
}

export function updateCanvasAssetNode(
  content: StoryboardContent,
  nodeId: string,
  patch: Partial<Omit<CanvasAssetNode, "id" | "kind">>
): StoryboardContent {
  const canvas = getCanvas(content);
  return {
    ...content,
    canvas: {
      ...canvas,
      nodes: (canvas.nodes ?? []).map((node) =>
        node.id === nodeId ? { ...node, ...patch } : node
      ),
    },
  };
}

export function removeCanvasAssetNode(
  content: StoryboardContent,
  nodeId: string
): StoryboardContent {
  const canvas = getCanvas(content);
  const positions = { ...canvas.positions };
  delete positions[nodeId];
  return {
    ...content,
    canvas: {
      ...canvas,
      nodes: (canvas.nodes ?? []).filter((node) => node.id !== nodeId),
      positions,
      edges: canvas.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
    },
  };
}

/** Removing a shot also drops its canvas position + any edges touching it. */
export function removeShotFromCanvas(
  content: StoryboardContent,
  shotId: string
): StoryboardContent {
  return removeShot(content, shotId);
}

/** Persist the viewport (pan/zoom) so the board reopens where left off. */
export function setViewport(
  content: StoryboardContent,
  viewport: { x: number; y: number; zoom: number }
): StoryboardContent {
  return { ...content, canvas: { ...getCanvas(content), viewport } };
}
