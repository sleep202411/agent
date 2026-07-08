"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type IsValidConnection,
  type Node,
  type OnConnectStart,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTranslations } from "next-intl";
import {
  IconApps,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCloudUpload,
  IconHistory,
  IconSparkles,
  IconUsers,
  IconLayoutGrid,
  IconLoader2,
  IconMagnet,
  IconMap,
  IconMaximize,
  IconMinus,
  IconNote,
  IconPhoto,
  IconPlus,
  IconVideo,
  type Icon,
} from "@tabler/icons-react";
import type { CanvasAsset } from "@/lib/collab/canvas-doc";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/lib/media-upload";
import type { AuthUser } from "@/lib/auth";
import { useAuth } from "@/app/_components/auth-provider";
import { useCanvasDocument } from "@/lib/collab/use-canvas-document";
import { useCanvasDoc, type CanvasUser } from "@/lib/collab/use-canvas-doc";
import { useCanvasGraph } from "@/lib/collab/use-canvas-graph";
import { CanvasGraphProvider } from "@/lib/collab/canvas-graph-context";
import type { CanvasEdgeShape, CanvasNodeShape } from "@/lib/collab/canvas-doc";
import { CollabAvatars, CollabCursors } from "./collab-presence";
import { CommentsLayer, CommentsProvider } from "./canvas-comments";
import {
  UploadStateContext,
  createUploadStateStore,
  type UploadStateStore,
} from "./upload-state-context";
import { CanvasHistory } from "./canvas-history";
import { ConnectionSignal } from "./connection-signal";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CopilotPanel } from "./copilot/copilot-panel";
import { CreditsBadge } from "@/app/_components/credits-badge";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";
import { ASSET_LIBRARY_WIDTH, AssetLibrary, ASSET_DRAG_MIME } from "./asset-library";
import { AddNodeMenu, type AddNodeAction } from "./add-node-menu";
import { CanvasEmptyState } from "./canvas-empty-state";
import { useApplyPreset } from "@/app/[locale]/canvas/_lib/use-apply-preset";
import { createWorkflowPresets } from "@/app/[locale]/canvas/_lib/workflow-presets";
import { ToolbarButton, FLOATING_PANEL } from "./node-toolbar";
import { CanvasConnectionLine } from "./connection-line";
import { GradientEdge } from "./gradient-edge";
import { handleColor } from "./port-colors";
import { ImageNode, type ImageNodeType } from "./image-node";
import { PanoramaNode, type PanoramaNodeType } from "./panorama-node";
import { NoteNode, type NoteNodeType } from "./note-node";
import {
  AudioAssetNode,
  VideoAssetNode,
  type AudioAssetNodeType,
  type VideoAssetNodeType,
} from "./media-node";
import {
  PromptNode,
  VideoNode,
  type GenerationNodeData,
  type GenerationNodeType,
} from "./generation-card";
import { useAiCatalog } from "@/app/[locale]/canvas/_lib/use-ai-catalog";
import { CanvasGenerationProvider } from "@/app/[locale]/canvas/_lib/use-canvas-generation";
import {
  canvasDefaultMode,
  canvasDefaultModel,
  defaultSettingsForModel,
} from "@/app/[locale]/canvas/_lib/generation-api";
import {
  modelAcceptsKind,
  routeReferenceField as routeReferenceFieldFor,
} from "@/app/[locale]/canvas/_lib/reference-routing";
import type { CardReferences } from "./reference-stack";
import {
  bindEdgeReference as wiringBindEdgeReference,
  sourceMediaUrl as wiringSourceMediaUrl,
  sourceOutputKind as wiringSourceOutputKind,
  stripEdgeRef,
} from "@/app/[locale]/canvas/_lib/canvas-wiring";

export type CanvasNode =
  | ImageNodeType
  | PanoramaNodeType
  | NoteNodeType
  | VideoAssetNodeType
  | AudioAssetNodeType
  | GenerationNodeType;

const nodeTypes = {
  image: ImageNode,
  panorama: PanoramaNode,
  note: NoteNode,
  videoAsset: VideoAssetNode,
  audioAsset: AudioAssetNode,
  prompt: PromptNode,
  video: VideoNode,
};
const edgeTypes = { gradient: GradientEdge };

// Which source output kinds each generator can consume — image generation takes
// image references only; video generation takes image (i2v) or video (ref/edit).
// Drives the add-node menu gating: a video source greys out image generation.
const GEN_ACCEPTS: Record<
  "generate-image" | "generate-video",
  readonly ("image" | "video" | "audio")[]
> = {
  "generate-image": ["image"],
  "generate-video": ["image", "video", "audio"],
};

// Zoom/pan tuning proven in apps/web's storyboard canvas.
const MIN_ZOOM = 0.16;
const MAX_ZOOM = 2.4;
/** Grid step for snap-to-grid (matches the visible dot grid). */
const GRID_SIZE = 24;

/**
 * "Tidy canvas" — a dependency-free layered layout. Nodes flow left→right by
 * longest-path depth from a source (matching wire direction image→card→output),
 * stacked top→bottom within each column. Returns the new positions to commit.
 */
function computeTidyLayout(
  nodes: Node[],
  edges: Edge[]
): { id: string; position: { x: number; y: number } }[] {
  if (nodes.length === 0) return [];
  const ids = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  // Longest-path depth via bounded relaxation — O(N·E); every node gets a depth
  // (sources/isolated stay 0), and a cycle's depth growth is capped at N passes
  // so it terminates and still places every node (no Kahn negative-indegree bug).
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const e of validEdges) {
      const next = (depth.get(e.source) ?? 0) + 1;
      if (next > (depth.get(e.target) ?? 0)) {
        depth.set(e.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const columns = new Map<number, Node[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    const col = columns.get(d) ?? [];
    col.push(n);
    columns.set(d, col);
  }
  const COL_GAP = 80;
  const ROW_GAP = 48;
  const sizeOf = (n: Node) => ({
    width: n.measured?.width ?? 280,
    height: n.measured?.height ?? 200,
  });
  const positions: { id: string; position: { x: number; y: number } }[] = [];
  let x = 0;
  for (const d of [...columns.keys()].sort((a, b) => a - b)) {
    const col = columns.get(d) ?? [];
    const colWidth = Math.max(...col.map((n) => sizeOf(n).width));
    let y = 0;
    for (const n of col) {
      positions.push({
        id: n.id,
        position: { x: Math.round(x), y: Math.round(y) },
      });
      y += sizeOf(n).height + ROW_GAP;
    }
    x += colWidth + COL_GAP;
  }
  return positions;
}

const PASTE_OFFSET = 32;

type CanvasClipboard = { nodes: CanvasNodeShape[]; edges: CanvasEdgeShape[] };

/** React Flow node → the doc's plain CanvasNodeShape (carrying measured size). */
function toNodeShape(node: Node): CanvasNodeShape {
  return {
    id: node.id,
    type: node.type ?? "default",
    position: node.position,
    data: (node.data ?? {}) as Record<string, unknown>,
    width: node.measured?.width,
    height: node.measured?.height,
  };
}

/** Remap a card's wired references onto cloned edge/source ids; drop refs whose wire wasn't copied. */
function remapReferences(
  data: Record<string, unknown>,
  nodeIds: Map<string, string>,
  edgeIds: Map<string, string>
): Record<string, unknown> {
  const refs = (data as GenerationNodeData).references;
  if (!refs) return data;
  const next: CardReferences = {};
  for (const [field, list] of Object.entries(refs)) {
    const remapped = list
      .filter((ref) => !ref.edgeId || edgeIds.has(ref.edgeId))
      .map((ref) => {
        const edgeId = ref.edgeId ? edgeIds.get(ref.edgeId) : undefined;
        return {
          ...ref,
          id: edgeId ?? crypto.randomUUID(),
          edgeId,
          sourceNodeId: ref.sourceNodeId
            ? (nodeIds.get(ref.sourceNodeId) ?? ref.sourceNodeId)
            : undefined,
        };
      });
    if (remapped.length > 0) next[field] = remapped;
  }
  return { ...data, references: next };
}

/** Clone nodes + internal edges with fresh ids and offset positions (paste / duplicate). */
function cloneForPaste(
  nodes: CanvasNodeShape[],
  edges: CanvasEdgeShape[],
  offset: number
): CanvasClipboard {
  const nodeIds = new Map<string, string>();
  for (const node of nodes) nodeIds.set(node.id, crypto.randomUUID());
  const edgeIds = new Map<string, string>();
  for (const edge of edges) edgeIds.set(edge.id, crypto.randomUUID());

  return {
    nodes: nodes.map((node) => ({
      ...node,
      id: nodeIds.get(node.id) ?? crypto.randomUUID(),
      position: { x: node.position.x + offset, y: node.position.y + offset },
      data: remapReferences(node.data, nodeIds, edgeIds),
    })),
    edges: edges.map((edge) => ({
      id: edgeIds.get(edge.id) ?? crypto.randomUUID(),
      source: nodeIds.get(edge.source) ?? edge.source,
      target: nodeIds.get(edge.target) ?? edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    })),
  };
}

type PendingConnection = {
  nodeId: string;
  handleId: string | null;
  handleType: "source" | "target";
};

type AddMenuState = {
  left: number;
  top: number;
  flow: { x: number; y: number };
  pending?: PendingConnection;
  /** Persistent pending wire (container coords) shown while the menu is open. */
  wire?: { x1: number; y1: number; x2: number; y2: number; color: string };
};

function ZoomControls({
  onTidy,
  snapToGrid,
  onToggleSnap,
  minimapOpen,
  onToggleMinimap,
  leftInset = 0,
}: {
  onTidy: () => void;
  snapToGrid: boolean;
  onToggleSnap: () => void;
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  leftInset?: number;
}) {
  const t = useTranslations("canvas");
  const { zoom } = useViewport();
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const controlClass =
    "flex size-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white";
  const toggleClass = (active: boolean) => cn(controlClass, active && "bg-white/[0.12] text-white");
  const zoomPercent = Math.round(zoom * 100);

  return (
    <div
      className="absolute bottom-4 z-20 flex h-[42px] items-center gap-0.5 rounded-full bg-popover/90 px-2 shadow-md backdrop-blur-xl transition-[left] duration-200 ease-out"
      style={{ left: 16 + leftInset }}
    >
      <ControlTooltip label={t("tidyCanvas")}>
        <button
          type="button"
          aria-label={t("tidyCanvas")}
          className={controlClass}
          onClick={onTidy}
        >
          <IconApps className="size-4" stroke={1.8} />
        </button>
      </ControlTooltip>
      <ControlTooltip label={t("toggleMinimap")}>
        <button
          type="button"
          aria-label={t("toggleMinimap")}
          aria-pressed={minimapOpen}
          className={toggleClass(minimapOpen)}
          onClick={onToggleMinimap}
        >
          <IconMap className="size-4" stroke={1.8} />
        </button>
      </ControlTooltip>
      <ControlTooltip label={t("snapToGrid")}>
        <button
          type="button"
          aria-label={t("snapToGrid")}
          aria-pressed={snapToGrid}
          className={toggleClass(snapToGrid)}
          onClick={onToggleSnap}
        >
          <IconMagnet className="size-4" stroke={1.8} />
        </button>
      </ControlTooltip>
      <span className="mx-0.5 h-4 w-px bg-white/10" />
      <ControlTooltip label={t("zoomOut")}>
        <button
          type="button"
          aria-label={t("zoomOut")}
          className={controlClass}
          onClick={() => zoomOut()}
        >
          <IconMinus className="size-4" stroke={1.8} />
        </button>
      </ControlTooltip>
      <ControlTooltip label={t("zoomLevel", { percent: zoomPercent })}>
        <span className="w-12 text-center text-xs text-white/70 tabular-nums select-none">
          {zoomPercent}%
        </span>
      </ControlTooltip>
      <ControlTooltip label={t("zoomIn")}>
        <button
          type="button"
          aria-label={t("zoomIn")}
          className={controlClass}
          onClick={() => zoomIn()}
        >
          <IconPlus className="size-4" stroke={1.8} />
        </button>
      </ControlTooltip>
      <ControlTooltip label={t("zoomToFit")}>
        <button
          type="button"
          aria-label={t("zoomToFit")}
          className={controlClass}
          onClick={() => fitView({ padding: 0.3, duration: 300 })}
        >
          <IconMaximize className="size-4" stroke={1.8} />
        </button>
      </ControlTooltip>
    </div>
  );
}

function ControlTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

const DOCK_ITEMS: {
  action: AddNodeAction;
  labelKey: "upload" | "image" | "video" | "note";
  Icon: Icon;
}[] = [
  { action: "upload", labelKey: "upload", Icon: IconCloudUpload },
  { action: "generate-image", labelKey: "image", Icon: IconPhoto },
  { action: "generate-video", labelKey: "video", Icon: IconVideo },
  { action: "note", labelKey: "note", Icon: IconNote },
];

/** Bottom dock: one click adds a node of a supported kind to the canvas. */
function NodeDock({ onAdd }: { onAdd: (action: AddNodeAction) => void }) {
  const t = useTranslations("canvas");
  return (
    <div
      className={cn(
        "absolute bottom-5 left-1/2 z-20 flex h-[48px] -translate-x-1/2 items-center gap-1 rounded-2xl px-2.5",
        FLOATING_PANEL
      )}
    >
      {DOCK_ITEMS.map(({ action, labelKey, Icon }) => (
        <ToolbarButton
          key={action}
          label={t(`dock.${labelKey}`)}
          className="size-10 text-white"
          onClick={() => onAdd(action)}
        >
          <Icon className="size-5" stroke={1.7} />
        </ToolbarButton>
      ))}
    </div>
  );
}

/** Map the signed-in user to the collaborative cursor / avatar identity. */
function toCanvasUser(user: AuthUser | null, guestName: string): CanvasUser | null {
  if (!user) return null;
  const id = String(user.id ?? "anon");
  return {
    id,
    name: user.nickName?.trim() || guestName,
    color: cursorColor(id),
    avatarUrl: user.avatar,
  };
}

/** Deterministic, evenly-spread cursor color from a stable seed. */
function cursorColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 70% 60%)`;
}

function CanvasInner({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const t = useTranslations("canvas");
  const tCopilot = useTranslations("copilot");
  const tProject = useTranslations("project");
  const tCanvasControls = useTranslations("canvasControls");
  const { canManage, openShare, setCanvasChromeInset } = useProjectContext();
  const { data: catalog } = useAiCatalog();
  const { user } = useAuth();
  const guestName = t("guest");
  const canvasUser = useMemo(() => toCanvasUser(user, guestName), [user, guestName]);
  const { documentId, status: docStatus } = useCanvasDocument(projectId);
  const {
    doc,
    awareness,
    provider,
    status: connStatus,
    rtt,
  } = useCanvasDoc(documentId, canvasUser);
  const graph = useCanvasGraph(doc, awareness, canEdit);
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    addNode: graphAddNode,
    addEdge: graphAddEdge,
    addNodesAndEdges: graphAddNodesAndEdges,
    patchNodeData,
    removeEdge: graphRemoveEdge,
    addLocalNode,
    promoteLocalNode,
    selectNodes,
    addAssets: graphAddAssets,
    canUndo,
    canRedo,
    undo,
    redo,
  } = graph;
  const [addMenu, setAddMenu] = useState<AddMenuState | null>(null);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const assetLibraryInset = assetsOpen ? ASSET_LIBRARY_WIDTH : 0;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const { screenToFlowPosition, fitView, getNodes, getNode } = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadFlowPos = useRef<{ x: number; y: number } | null>(null);
  const pendingUploadConnection = useRef<PendingConnection | null>(null);
  const reconnectDone = useRef(true);
  const lastConnectEndAt = useRef(0);
  const connectStartRef = useRef<{ x: number; y: number; color: string } | null>(null);
  const fittedRef = useRef(false);
  const lastCursorAt = useRef(0);
  const clipboard = useRef<CanvasClipboard | null>(null);

  // Fit the view once, after the first sync brings the graph in.
  useEffect(() => {
    if (fittedRef.current || connStatus !== "synced" || nodes.length === 0) {
      return;
    }
    fittedRef.current = true;
    const handle = setTimeout(() => fitView({ padding: 0.3 }), 60);
    return () => clearTimeout(handle);
  }, [connStatus, nodes.length, fitView]);

  const onConnectStart = useCallback<OnConnectStart>((event, params) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = "touches" in event ? event.touches[0] : event;
    connectStartRef.current = {
      x: p.clientX - rect.left,
      y: p.clientY - rect.top,
      color: handleColor(params.handleId),
    };
  }, []);

  // The output kind a node exposes — "image" for image nodes, the card's
  // modality for a generation card (image card → image, video card → video).
  const sourceOutputKind = useCallback(
    (nodeId: string | null | undefined): "image" | "video" | "audio" | undefined =>
      nodeId ? wiringSourceOutputKind(getNode, nodeId) : undefined,
    [getNode]
  );

  // The media URL a source node exposes — an image node's src, or another
  // generation card's produced output (enables card→card chaining).
  const sourceMediaUrl = useCallback(
    (nodeId: string | null | undefined) =>
      nodeId ? wiringSourceMediaUrl(getNode, nodeId) : undefined,
    [getNode]
  );

  // Where an incoming wire of `kind` should bind on a card: a field in the
  // current mode if one fits, else the first mode that accepts the kind — so
  // wiring an image into a video card auto-switches it to image-to-video and
  // drops the image straight into that mode's reference.
  const routeReferenceField = useCallback(
    (
      cardId: string | null | undefined,
      kind: string
    ): { mode?: string; field: string } | undefined => {
      if (!cardId) return undefined;
      const node = getNode(cardId);
      if (!node || (node.type !== "prompt" && node.type !== "video")) return undefined;
      const data = node.data as GenerationNodeData;
      const model = catalog?.models.find((m) => m.id === data.modelId);
      return routeReferenceFieldFor(model, data.mode, data.references, kind);
    },
    [getNode, catalog]
  );

  // Typed dataflow: a wire is valid only if the source's output kind can bind to
  // a reference slot on the target card (in some mode). This is the same routing
  // `onConnect` uses, so a valid wire is GUARANTEED to bind — no silent no-ops —
  // and type-incompatible wires are rejected mid-drag (e.g. a video into an
  // image-generation card, which has no video input).
  const canConnect = useCallback(
    (source: string | null | undefined, target: string | null | undefined) => {
      if (!source || !target || source === target) return false;
      // Catalog still loading: stay permissive (output→input) so first-paint
      // wiring isn't blocked; type-safety engages once the models resolve.
      if (!catalog) return true;
      const kind = sourceOutputKind(source);
      return Boolean(kind && routeReferenceField(target, kind));
    },
    [catalog, sourceOutputKind, routeReferenceField]
  );

  // React Flow only allows source→target, so this is output→input. Beyond that,
  // the connection must be type-compatible (see canConnect).
  const isValidConnection = useCallback<IsValidConnection<Edge>>(
    (connection) =>
      connection.targetHandle === "input" && canConnect(connection.source, connection.target),
    [canConnect]
  );

  // The connection (if any) when a node is spawned/hit from a dragged wire.
  const connectionForPending = useCallback(
    (pending: PendingConnection, otherNodeId: string): Connection | null => {
      // Dragged from a card's "+" input → a source feeds it. Only wire if the
      // source's output kind is type-compatible with this card.
      if (pending.handleType === "target" && canConnect(otherNodeId, pending.nodeId)) {
        return {
          source: otherNodeId,
          sourceHandle: "output",
          target: pending.nodeId,
          targetHandle: "input",
        };
      }
      // Dragged from a "+" output → into a card that can consume this output.
      if (pending.handleType === "source" && canConnect(pending.nodeId, otherNodeId)) {
        return {
          source: pending.nodeId,
          sourceHandle: "output",
          target: otherNodeId,
          targetHandle: "input",
        };
      }
      return null;
    },
    [canConnect]
  );

  // Add-node menu gating for a wire dragged onto empty canvas: grey out the
  // generators that can't take part in this connection (the screenshot's
  // "引用该节点生成" — image generation is disabled when the source is a video).
  const menuDisabledActions = useMemo<ReadonlySet<AddNodeAction>>(() => {
    const disabled = new Set<AddNodeAction>();
    const pending = addMenu?.pending;
    if (!pending) return disabled;
    if (pending.handleType === "source") {
      // The dragged source feeds whatever we create — disable generators that
      // can't consume its output kind (a video can't feed image generation).
      const kind = sourceOutputKind(pending.nodeId);
      if (kind) {
        if (!GEN_ACCEPTS["generate-image"].includes(kind)) disabled.add("generate-image");
        if (!GEN_ACCEPTS["generate-video"].includes(kind)) disabled.add("generate-video");
      }
    } else {
      // Dragged from a card's "+" input — the new node FEEDS this card. Disable
      // generators whose output kind this card's model can't accept.
      const node = getNode(pending.nodeId);
      const model = node
        ? catalog?.models.find((m) => m.id === (node.data as GenerationNodeData).modelId)
        : undefined;
      if (!modelAcceptsKind(model, "image")) disabled.add("generate-image");
      if (!modelAcceptsKind(model, "video")) disabled.add("generate-video");
    }
    return disabled;
  }, [addMenu, sourceOutputKind, getNode, catalog]);

  // Bind an edge's source as a reference on the target card, where it fits
  // (auto-switching the card's mode if needed — e.g. an image into a video card
  // → image-to-video). No-op if the source isn't a resolvable media output yet
  // (ungenerated card), the target has no model yet, or the card can't take the
  // kind. Idempotent: re-binding the same edgeId replaces in place.
  const bindEdgeReference = useCallback(
    (edgeId: string, source: string | null, target: string | null) => {
      if (!source || !target) return;
      // Single source of truth: the same routing/binding the copilot uses. Pass
      // stable mutator refs (not the whole `graph`, whose object identity churns
      // each render) so this callback — and the reconciler that depends on it —
      // stays referentially stable.
      wiringBindEdgeReference(
        { getNode, catalog, graph: { addEdge: graphAddEdge, patchNodeData } },
        edgeId,
        source,
        target
      );
    },
    [getNode, catalog, graphAddEdge, patchNodeData]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const edgeId = crypto.randomUUID();
      graphAddEdge({
        id: edgeId,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      });
      if (connection.targetHandle === "input") {
        bindEdgeReference(edgeId, connection.source, connection.target);
      }
    },
    [graphAddEdge, bindEdgeReference]
  );

  // Reference reconciler: an edge into a card's input ALWAYS means "this source
  // is a reference of the card" (wired refs can only be removed by deleting the
  // wire — see reference-stack). onConnect binds at draw time, but that misses
  // timing windows — a freshly-created card whose model resolves a tick later,
  // or a source card that finishes generating after the wire was drawn. So
  // back-fill any edge whose reference isn't bound yet once its inputs resolve.
  // Idempotent + convergent: bound edges are skipped, so this settles in one pass.
  useEffect(() => {
    if (!catalog) return;
    for (const edge of edges) {
      const target = getNode(edge.target);
      if (!target || (target.type !== "prompt" && target.type !== "video")) {
        continue;
      }
      const refs = (target.data as GenerationNodeData).references ?? {};
      let boundField: string | undefined;
      let boundUrl: string | undefined;
      for (const [field, list] of Object.entries(refs)) {
        const hit = (list ?? []).find((r) => r.edgeId === edge.id);
        if (hit) {
          boundField = field;
          boundUrl = hit.url;
          break;
        }
      }
      if (boundField === undefined) {
        // Not yet bound — bind the source as a reference once its inputs resolve.
        bindEdgeReference(edge.id, edge.source, edge.target);
        continue;
      }
      // Already bound — keep the reference's URL in sync with the source's
      // current output, so a "live" wire reflects an upstream re-generation
      // instead of pinning the first output forever (in place; no re-routing).
      // Ignore a transient blob: (a still-uploading source) — never sync it in.
      const url = sourceMediaUrl(edge.source);
      if (url && !url.startsWith("blob:") && url !== boundUrl) {
        const field = boundField;
        patchNodeData(edge.target, (node) => {
          const r = (node.data as GenerationNodeData).references ?? {};
          const list = (r[field] ?? []).map((x) => (x.edgeId === edge.id ? { ...x, url } : x));
          return { references: { ...r, [field]: list } };
        });
      }
    }
  }, [edges, nodes, catalog, getNode, bindEdgeReference, sourceMediaUrl, patchNodeData]);

  // Deleting a wire drops the reference it bound. The field isn't on the edge
  // (the single "+" input fans out), so search every field by edge id.
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      // Single source of truth: the same ref-strip the copilot's remove_edge uses.
      for (const edge of deleted) {
        if (edge.target) stripEdgeRef(patchNodeData, edge.target, edge.id);
      }
    },
    [patchNodeData]
  );

  // Transient state for in-flight optimistic uploads (blob preview / progress /
  // abort), keyed by node id and kept OUT of the shared doc — see
  // upload-state-context. Created once; its identity is stable.
  const uploadStore = useMemo<UploadStateStore>(() => createUploadStateStore(), []);
  // Wires whose binding must wait for the durable URL (set by the file-input
  // path; run on upload confirm). Keyed by the uploaded node id.
  const pendingWires = useRef<Map<string, () => void>>(new Map());

  // Upload one file in the background and settle its node: on confirm, promote
  // the local-only node into the shared doc with the DURABLE url (peers see it
  // now) + register it in the library; on failure, mark it for retry.
  const runUpload = useCallback(
    (id: string, file: File) => {
      const signal = uploadStore.get(id)?.controller.signal;
      uploadFileViaSignedUrl(file, {
        kind: "ai_reference_image",
        signal,
        onProgress: (percent) => uploadStore.patchProgress(id, percent),
      })
        .then((uploaded) => {
          promoteLocalNode(id, {
            src: uploaded.url,
            mediaAssetId: uploaded.mediaAssetId,
            label: file.name,
          });
          // Register in the shared library (Uploaded tab), synced to peers.
          graphAddAssets([
            {
              id: crypto.randomUUID(),
              mediaAssetId: uploaded.mediaAssetId,
              kind: "image",
              source: "uploaded",
              url: uploaded.url,
              name: file.name,
              createdAt: Date.now(),
            },
          ]);
          uploadStore.succeed(id);
          // Bind any wire that was waiting for this node's durable URL.
          const wire = pendingWires.current.get(id);
          if (wire) {
            pendingWires.current.delete(id);
            wire();
          }
        })
        .catch((err) => {
          // Deleted mid-upload → cancel() already aborted + cleaned up; stay quiet.
          if (isUploadAbort(err)) return;
          uploadStore.markFailed(id, err instanceof Error ? err.message : t("uploadFailed"));
        });
    },
    [uploadStore, promoteLocalNode, graphAddAssets, t]
  );

  const addImageFiles = useCallback(
    (files: File[], base: { x: number; y: number }): string[] => {
      // Optimistic: render each image immediately from a local blob (this client
      // only — never a blob: URL in the shared doc), then upload in the
      // background and promote to the durable URL on confirm.
      const ids: string[] = [];
      files.forEach((file, index) => {
        const id = crypto.randomUUID();
        const objectUrl = URL.createObjectURL(file);
        addLocalNode({
          id,
          type: "image",
          position: { x: base.x + index * 32, y: base.y + index * 32 },
          data: { src: objectUrl, label: file.name },
        });
        uploadStore.begin(id, {
          status: "uploading",
          progress: 0,
          objectUrl,
          file,
          controller: new AbortController(),
        });
        runUpload(id, file);
        ids.push(id);
      });
      return ids;
    },
    [addLocalNode, uploadStore, runUpload]
  );

  // Retry a failed upload in place, reusing the same File + blob preview.
  const retryUpload = useCallback(
    (id: string) => {
      const entry = uploadStore.get(id);
      if (!entry) return;
      uploadStore.begin(id, {
        ...entry,
        status: "uploading",
        progress: 0,
        error: undefined,
        controller: new AbortController(),
      });
      runUpload(id, entry.file);
    },
    [uploadStore, runUpload]
  );

  const uploadContextValue = useMemo(
    () => ({ store: uploadStore, retry: retryUpload }),
    [uploadStore, retryUpload]
  );

  // Abort + revoke an image node's upload when it's deleted mid-flight.
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const node of deleted) {
        if (uploadStore.get(node.id)) {
          pendingWires.current.delete(node.id);
          uploadStore.cancel(node.id);
        }
      }
    },
    [uploadStore]
  );

  // Switching projects swaps `doc` in place, but an in-flight upload's async
  // completion still closes over the OLD doc — promoting into it would write to
  // the wrong (disposed) document and leak the blob. So when the doc changes (or
  // the canvas unmounts), abort + revoke every pending upload and drop deferred
  // wires; the aborts reject with AbortError, which runUpload's catch ignores.
  useEffect(() => {
    const wires = pendingWires.current;
    return () => {
      uploadStore.cancelAll();
      wires.clear();
    };
  }, [doc, uploadStore]);

  useEffect(() => {
    setCanvasChromeInset(assetLibraryInset);
    return () => setCanvasChromeInset(0);
  }, [assetLibraryInset, setCanvasChromeInset]);

  const addNode = useCallback(
    (node: CanvasNodeShape) => {
      graphAddNode(node);
      // Select the new node so generation cards reveal their composer at once.
      selectNodes([node.id]);
      setAddMenu(null);
    },
    [graphAddNode, selectNodes]
  );

  const generationDefaults = useCallback(
    (modality: "image" | "video"): Partial<GenerationNodeData> => {
      const model = canvasDefaultModel(catalog, modality);
      if (!model) return {};
      return {
        modelId: model.id,
        modelName: model.name,
        mode: canvasDefaultMode(model),
        settings: defaultSettingsForModel(model),
      };
    },
    [catalog]
  );

  // Create a node of the chosen kind at `flow`; optionally wire it to a pending
  // dragged connection. Shared by the double-click menu and the bottom dock.
  const addNodeOfType = useCallback(
    (action: AddNodeAction, flow: { x: number; y: number }, pending?: PendingConnection | null) => {
      if (action === "upload") {
        pendingUploadFlowPos.current = flow;
        pendingUploadConnection.current = pending ?? null;
        fileInputRef.current?.click();
        return;
      }
      const id = crypto.randomUUID();
      const nodeType =
        action === "generate-image" ? "prompt" : action === "generate-video" ? "video" : "note";
      if (nodeType === "prompt") {
        const count = nodes.filter((node) => node.type === "prompt").length;
        addNode({
          id,
          type: "prompt",
          position: flow,
          data: {
            ...generationDefaults("image"),
            prompt: "",
            name: t("imageCardName", { index: count + 1 }),
          },
        });
      } else if (nodeType === "video") {
        const count = nodes.filter((node) => node.type === "video").length;
        addNode({
          id,
          type: "video",
          position: flow,
          data: {
            ...generationDefaults("video"),
            prompt: "",
            name: t("videoCardName", { index: count + 1 }),
          },
        });
      } else {
        addNode({ id, type: "note", position: flow, data: { text: "" } });
      }
      // Wire the dragged pending connection to the freshly-created card. The new
      // node isn't in React Flow's store yet (and has no resolved model), so the
      // canConnect/getNode path can't validate it — but the add-node menu has
      // ALREADY gated incompatible actions (menuDisabledActions), so the chosen
      // generator is type-compatible. Build the edge directly by wire direction;
      // onConnect binds the reference once the card's model + source output
      // resolve. (Note/upload don't wire here.)
      if (pending && (nodeType === "prompt" || nodeType === "video")) {
        const connection: Connection =
          pending.handleType === "source"
            ? { source: pending.nodeId, sourceHandle: "output", target: id, targetHandle: "input" }
            : { source: id, sourceHandle: "output", target: pending.nodeId, targetHandle: "input" };
        onConnect(connection);
      }
    },
    [nodes, addNode, onConnect, t, generationDefaults]
  );

  // Bottom-dock add: drop the node at the viewport center, nudged per node count
  // so repeated adds don't land exactly on top of each other.
  const addNodeFromDock = useCallback(
    (action: AddNodeAction) => {
      const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const nudge = (nodes.length % 6) * 26;
      addNodeOfType(action, { x: center.x + nudge, y: center.y + nudge });
    },
    [screenToFlowPosition, nodes.length, addNodeOfType]
  );

  // The current selection as a clonable {nodes, internal edges} bundle.
  const collectSelection = useCallback((): CanvasClipboard | null => {
    const selected = getNodes().filter((node) => node.selected);
    if (selected.length === 0) return null;
    const ids = new Set(selected.map((node) => node.id));
    const internalEdges = edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      }));
    return { nodes: selected.map(toNodeShape), edges: internalEdges };
  }, [getNodes, edges]);

  const copySelection = useCallback(() => {
    const selection = collectSelection();
    if (selection) clipboard.current = selection;
  }, [collectSelection]);

  // Place a clone (paste / duplicate) and leave it selected, ready to move.
  const placeClone = useCallback(
    (source: CanvasClipboard | null) => {
      if (!source || source.nodes.length === 0) return;
      const clone = cloneForPaste(source.nodes, source.edges, PASTE_OFFSET);
      graphAddNodesAndEdges(clone.nodes, clone.edges);
      selectNodes(clone.nodes.map((node) => node.id));
    },
    [graphAddNodesAndEdges, selectNodes]
  );

  const pasteClipboard = useCallback(() => placeClone(clipboard.current), [placeClone]);
  const duplicateSelection = useCallback(
    () => placeClone(collectSelection()),
    [placeClone, collectSelection]
  );

  // Keyboard: undo/redo, copy/paste/duplicate, and single-key add-node shortcuts
  // (U/I/V/N). Ignored while typing in an input/textarea/contentEditable.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      // Don't act behind an open modal (e.g. the beta notice).
      if (document.querySelector('[role="dialog"]')) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelection();
        return;
      }
      if (mod && event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteClipboard();
        return;
      }
      if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod || event.altKey) return; // leave other shortcuts alone
      const action: AddNodeAction | null =
        event.key === "u" || event.key === "U"
          ? "upload"
          : event.key === "i" || event.key === "I"
            ? "generate-image"
            : event.key === "v" || event.key === "V"
              ? "generate-video"
              : event.key === "n" || event.key === "N"
                ? "note"
                : null;
      if (action) {
        event.preventDefault();
        addNodeFromDock(action);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, addNodeFromDock, copySelection, pasteClipboard, duplicateSelection]);

  // Place a library asset on the canvas as a typed source node — at `position`
  // when dragged-and-dropped, else the viewport center (click-to-add).
  const addAssetToCanvas = useCallback(
    (asset: CanvasAsset, position?: { x: number; y: number }) => {
      if (!asset.url) return;
      addNode({
        id: crypto.randomUUID(),
        type:
          asset.kind === "audio"
            ? "audioAsset"
            : asset.kind === "video"
              ? "videoAsset"
              : asset.panorama
                ? "panorama"
                : "image",
        position:
          position ?? screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
        data: {
          src: asset.url,
          mediaAssetId: asset.mediaAssetId,
          label: asset.name ?? asset.prompt,
        },
      });
    },
    [addNode, screenToFlowPosition]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const dropPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      // A library asset dragged onto the canvas lands where it's dropped.
      const assetData = event.dataTransfer.getData(ASSET_DRAG_MIME);
      if (assetData) {
        try {
          addAssetToCanvas(JSON.parse(assetData) as CanvasAsset, dropPosition);
        } catch {
          // ignore a malformed payload
        }
        return;
      }
      const files = Array.from(event.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/")
      );
      if (files.length === 0) return;
      void addImageFiles(files, dropPosition);
    },
    [addImageFiles, screenToFlowPosition, addAssetToCanvas]
  );

  const onPickFiles = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []).filter((file) =>
        file.type.startsWith("image/")
      );
      event.target.value = "";
      if (files.length === 0) return;
      const base =
        pendingUploadFlowPos.current ??
        screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      pendingUploadFlowPos.current = null;
      const pending = pendingUploadConnection.current;
      pendingUploadConnection.current = null;
      const [firstId] = addImageFiles(files, base);
      // The wire can only bind once the durable URL exists — binding reads
      // node.data.src, and a blob: would poison the CRDT reference (the panorama
      // bug class). Defer it to upload-confirm via the pending-wires map.
      if (pending && firstId) {
        pendingWires.current.set(firstId, () => {
          const connection = connectionForPending(pending, firstId);
          if (connection) onConnect(connection);
        });
      }
    },
    [addImageFiles, screenToFlowPosition, connectionForPending, onConnect]
  );

  // Dropping a dragged connection on empty canvas opens the node menu;
  // the chosen node is created pre-wired to the dragged handle.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectionState.isValid || !connectionState.fromHandle || !connectionState.fromNode) {
        return;
      }
      const point =
        "changedTouches" in event
          ? { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY }
          : { x: event.clientX, y: event.clientY };
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const flowPoint = screenToFlowPosition(point);
      const pending: PendingConnection = {
        nodeId: connectionState.fromNode.id,
        handleId: connectionState.fromHandle.id ?? null,
        handleType: connectionState.fromHandle.type,
      };

      // Dropped on an existing card (not a handle): wire straight into its
      // compatible port — no need to aim at the 12px circle.
      const hit = getNodes().find((node) => {
        const width = node.measured?.width ?? 0;
        const height = node.measured?.height ?? 0;
        return (
          node.id !== pending.nodeId &&
          flowPoint.x >= node.position.x &&
          flowPoint.x <= node.position.x + width &&
          flowPoint.y >= node.position.y &&
          flowPoint.y <= node.position.y + height
        );
      });
      if (
        hit &&
        (hit.type === "prompt" ||
          hit.type === "note" ||
          hit.type === "image" ||
          hit.type === "video" ||
          hit.type === "videoAsset" ||
          hit.type === "audioAsset")
      ) {
        const connection = connectionForPending(pending, hit.id);
        if (connection) onConnect(connection);
        return;
      }

      lastConnectEndAt.current = Date.now();
      const endX = point.x - rect.left;
      const endY = point.y - rect.top;
      const start = connectStartRef.current;
      setAddMenu({
        left: Math.max(8, Math.min(endX, rect.width - 388)),
        top: Math.max(8, Math.min(endY, rect.height - 520)),
        flow: flowPoint,
        pending,
        wire: start
          ? { x1: start.x, y1: start.y, x2: endX, y2: endY, color: start.color }
          : undefined,
      });
    },
    [screenToFlowPosition, getNodes, connectionForPending, onConnect]
  );

  // Reconnectable edges: drag an edge end to re-route it, drop on empty canvas to delete it.
  const onReconnectStart = useCallback(() => {
    reconnectDone.current = false;
  }, []);
  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      reconnectDone.current = true;
      // addEdge upserts by id → the edge keeps its id but rebinds endpoints.
      graphAddEdge({
        id: oldEdge.id,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      });
    },
    [graphAddEdge]
  );
  const onReconnectEnd = useCallback(
    (_event: unknown, edge: Edge) => {
      if (!reconnectDone.current) {
        graphRemoveEdge(edge.id);
      }
      reconnectDone.current = true;
    },
    [graphRemoveEdge]
  );

  // Broadcast this client's live cursor (in flow coords) to peers, throttled.
  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!awareness) return;
      const now = Date.now();
      if (now - lastCursorAt.current < 45) return;
      lastCursorAt.current = now;
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      awareness.setLocalStateField("cursor", pos);
    },
    [awareness, screenToFlowPosition]
  );
  // Tidy canvas — auto-arrange nodes into a clean left→right layered layout,
  // committed as one transaction (synced + undoable), then fit the view.
  const tidyCanvas = useCallback(() => {
    const positions = computeTidyLayout(getNodes(), edges);
    if (positions.length === 0) return;
    onNodesChange(
      positions.map((p) => ({
        type: "position" as const,
        id: p.id,
        position: p.position,
        dragging: false,
      }))
    );
    setTimeout(() => fitView({ padding: 0.3, duration: 300 }), 60);
  }, [getNodes, edges, onNodesChange, fitView]);

  const onPointerLeave = useCallback(() => {
    awareness?.setLocalStateField("cursor", null);
  }, [awareness]);

  // Double-click on empty canvas opens the add-node menu (imagine.art pattern).
  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if (!(event.target as HTMLElement).classList.contains("react-flow__pane")) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAddMenu({
        left: Math.max(8, Math.min(event.clientX - rect.left, rect.width - 388)),
        top: Math.max(8, Math.min(event.clientY - rect.top, rect.height - 520)),
        flow: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      });
    },
    [screenToFlowPosition]
  );

  // Empty-state "Click to add a node": open the add menu near the canvas center.
  const applyPreset = useApplyPreset(graph);
  const workflowPresets = useMemo(() => createWorkflowPresets(tCanvasControls), [tCanvasControls]);
  const openAddMenuAtCenter = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAddMenu({
      left: Math.max(8, Math.min(rect.width / 2 - 194, rect.width - 388)),
      top: Math.max(8, Math.min(rect.height / 2 - 120, rect.height - 520)),
      flow: screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }),
    });
  }, [screenToFlowPosition]);

  return (
    <CanvasGraphProvider value={graph}>
      <CommentsProvider documentId={documentId} provider={provider} currentUserId={canvasUser?.id}>
        <CanvasGenerationProvider catalog={catalog}>
          <UploadStateContext.Provider value={uploadContextValue}>
            <div
              ref={containerRef}
              className="relative h-full"
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDoubleClick={onDoubleClick}
              onPointerMove={onPointerMove}
              onPointerLeave={onPointerLeave}
            >
              {docStatus === "loading" && nodes.length === 0 && (
                <div className="absolute inset-0 z-50 grid place-items-center bg-[#0a0a0a]">
                  <IconLoader2 className="size-7 animate-spin text-white/40" stroke={1.5} />
                </div>
              )}
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onNodesDelete={onNodesDelete}
                onEdgesChange={onEdgesChange}
                onEdgesDelete={onEdgesDelete}
                onConnect={onConnect}
                onConnectStart={onConnectStart}
                onConnectEnd={onConnectEnd}
                nodesDraggable={canEdit}
                nodesConnectable={canEdit}
                edgesReconnectable={canEdit}
                onReconnectStart={onReconnectStart}
                onReconnect={onReconnect}
                onReconnectEnd={onReconnectEnd}
                isValidConnection={isValidConnection}
                connectionRadius={38}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                connectionLineComponent={CanvasConnectionLine}
                colorMode="dark"
                proOptions={{ hideAttribution: true }}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                snapToGrid={snapToGrid}
                snapGrid={[GRID_SIZE, GRID_SIZE]}
                selectionOnDrag
                selectionMode={SelectionMode.Partial}
                panOnDrag={[1, 2]}
                panOnScroll
                panOnScrollMode={PanOnScrollMode.Free}
                zoomOnScroll={false}
                zoomOnPinch
                zoomOnDoubleClick={false}
                deleteKeyCode={canEdit ? ["Backspace", "Delete"] : null}
                onPaneClick={() => {
                  if (Date.now() - lastConnectEndAt.current < 250) return;
                  setAddMenu(null);
                }}
                onMoveStart={() => setAddMenu(null)}
                style={{ backgroundColor: "#0a0a0a" }}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={20}
                  size={1.5}
                  bgColor="#0a0a0a"
                  color="rgb(255 255 255 / 0.12)"
                />
                <CollabCursors awareness={awareness} localClientId={doc?.clientID} />
                <CommentsLayer nodes={nodes} />
                {minimapOpen && (
                  <MiniMap
                    pannable
                    zoomable
                    position="bottom-right"
                    className="!right-4 !bottom-[68px] !m-0 overflow-hidden rounded-xl border border-white/10 shadow-md"
                    bgColor="rgb(17 17 17)"
                    maskColor="rgba(0,0,0,0.35)"
                    maskStrokeColor="rgba(255,255,255,0.35)"
                    maskStrokeWidth={2}
                    nodeColor="rgba(255,255,255,0.5)"
                    nodeStrokeWidth={0}
                  />
                )}
              </ReactFlow>

              {/* Back / project name / mode switcher live in the project shell;
            this cluster holds the canvas-specific + presence controls. */}
              <div
                className={cn(
                  "absolute top-4 z-20 flex items-center gap-2 transition-[right]",
                  copilotOpen || historyOpen ? "right-[396px]" : "right-4"
                )}
              >
                <button
                  type="button"
                  aria-label={tCopilot("open")}
                  onClick={() => {
                    setHistoryOpen(false);
                    setCopilotOpen((open) => !open);
                  }}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full shadow-md backdrop-blur-xl transition-colors",
                    copilotOpen
                      ? "bg-accent text-white"
                      : "bg-popover/90 text-white/80 hover:bg-accent hover:text-white"
                  )}
                >
                  <IconSparkles className="size-4" stroke={1.8} />
                </button>
                <span className="flex h-9 items-center rounded-full bg-popover/90 px-3.5 shadow-md backdrop-blur-xl">
                  <ConnectionSignal status={connStatus} rtt={rtt} />
                </span>
                {canEdit && (
                  <button
                    type="button"
                    aria-label={t("activityLog")}
                    onClick={() => {
                      setCopilotOpen(false);
                      setHistoryOpen((open) => !open);
                    }}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full shadow-md backdrop-blur-xl transition-colors",
                      historyOpen
                        ? "bg-accent text-white"
                        : "bg-popover/90 text-white/80 hover:bg-accent hover:text-white"
                    )}
                  >
                    <IconHistory className="size-4" stroke={1.8} />
                  </button>
                )}
                {canManage && (
                  <button
                    type="button"
                    onClick={openShare}
                    aria-label={tProject("share")}
                    className="flex h-9 items-center gap-1.5 rounded-full bg-popover/90 px-3.5 text-sm font-medium text-white/80 shadow-md backdrop-blur-xl transition-colors hover:bg-accent hover:text-white"
                  >
                    <IconUsers className="size-4" stroke={1.8} />
                    {tProject("share")}
                  </button>
                )}
                <CollabAvatars awareness={awareness} localClientId={doc?.clientID} />
                <CreditsBadge className="flex h-9 items-center gap-1.5 rounded-full bg-popover/90 px-3.5 text-sm font-medium tabular-nums shadow-md backdrop-blur-xl" />
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={onPickFiles}
              />

              <ZoomControls
                onTidy={tidyCanvas}
                snapToGrid={snapToGrid}
                onToggleSnap={() => setSnapToGrid((v) => !v)}
                minimapOpen={minimapOpen}
                onToggleMinimap={() => setMinimapOpen((v) => !v)}
                leftInset={assetLibraryInset}
              />
              {canEdit && <NodeDock onAdd={addNodeFromDock} />}

              {/* Undo / redo (Ctrl+Z / Ctrl+Shift+Z). */}
              {canEdit && (
                <div className="absolute right-4 bottom-4 z-20 flex items-center gap-0.5 rounded-full bg-popover/90 p-1 shadow-md backdrop-blur-xl">
                  <button
                    type="button"
                    aria-label={t("undo")}
                    disabled={!canUndo}
                    onClick={() => undo()}
                    className="flex size-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <IconArrowBackUp className="size-4" stroke={1.8} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("redo")}
                    disabled={!canRedo}
                    onClick={() => redo()}
                    className="flex size-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <IconArrowForwardUp className="size-4" stroke={1.8} />
                  </button>
                </div>
              )}

              {/* Left rail (root-sidebar style) — opens the project's asset library. */}
              {!assetsOpen && (
                <div className="absolute top-1/2 left-4 z-20 flex -translate-y-1/2 flex-col gap-1 rounded-2xl bg-popover/90 p-1.5 shadow-md backdrop-blur-xl">
                  <button
                    type="button"
                    aria-label={t("openAssets")}
                    onClick={() => setAssetsOpen(true)}
                    className="flex size-9 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
                  >
                    <IconLayoutGrid className="size-5" stroke={1.7} />
                  </button>
                </div>
              )}
              <AssetLibrary open={assetsOpen} onClose={() => setAssetsOpen(false)} />

              <CopilotPanel
                projectId={projectId}
                mode="canvas"
                open={copilotOpen}
                onClose={() => setCopilotOpen(false)}
              />

              {historyOpen && (
                <CanvasHistory
                  documentId={documentId}
                  provider={provider}
                  onClose={() => setHistoryOpen(false)}
                />
              )}

              {/* Persistent pending wire from the source handle to the open menu, so the
          dragged connection stays visually anchored while choosing a node. */}
              {addMenu?.wire && (
                <svg className="pointer-events-none absolute inset-0 z-20 size-full overflow-visible">
                  <defs>
                    <linearGradient
                      id="pending-wire-grad"
                      gradientUnits="userSpaceOnUse"
                      x1={addMenu.wire.x1}
                      y1={addMenu.wire.y1}
                      x2={addMenu.wire.x2}
                      y2={addMenu.wire.y2}
                    >
                      <stop offset="0%" stopColor={addMenu.wire.color} stopOpacity={1} />
                      <stop offset="55%" stopColor={addMenu.wire.color} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={addMenu.wire.color} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <path
                    d={`M ${addMenu.wire.x1} ${addMenu.wire.y1} C ${
                      addMenu.wire.x1 + (addMenu.wire.x2 - addMenu.wire.x1) * 0.5
                    } ${addMenu.wire.y1}, ${
                      addMenu.wire.x2 - (addMenu.wire.x2 - addMenu.wire.x1) * 0.5
                    } ${addMenu.wire.y2}, ${addMenu.wire.x2} ${addMenu.wire.y2}`}
                    fill="none"
                    stroke="url(#pending-wire-grad)"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                </svg>
              )}

              {addMenu && (
                <AddNodeMenu
                  left={addMenu.left}
                  top={addMenu.top}
                  disabledActions={menuDisabledActions}
                  onAction={(action: AddNodeAction) => {
                    addNodeOfType(action, addMenu.flow, addMenu.pending);
                    setAddMenu(null);
                  }}
                />
              )}

              {docStatus === "error" && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60 backdrop-blur-sm">
                  <p className="text-sm text-muted-foreground">{t("openError")}</p>
                </div>
              )}

              {docStatus !== "error" &&
                nodes.length === 0 &&
                !addMenu &&
                (canEdit ? (
                  <CanvasEmptyState
                    presets={workflowPresets}
                    catalogReady={Boolean(catalog && catalog.models.length > 0)}
                    onAddNode={openAddMenuAtCenter}
                    onApplyPreset={applyPreset}
                  />
                ) : (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <p className="text-sm text-muted-foreground">{t("emptyReadOnly")}</p>
                  </div>
                ))}
            </div>
          </UploadStateContext.Provider>
        </CanvasGenerationProvider>
      </CommentsProvider>
    </CanvasGraphProvider>
  );
}

export function CanvasView({
  projectId,
  canEdit = true,
}: {
  projectId: string;
  canEdit?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner projectId={projectId} canEdit={canEdit} />
    </ReactFlowProvider>
  );
}
