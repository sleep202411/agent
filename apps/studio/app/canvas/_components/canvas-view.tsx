"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  addEdge,
  reconnectEdge,
  Background,
  BackgroundVariant,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type IsValidConnection,
  type OnConnectStart,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  IconArrowLeft,
  IconBolt,
  IconCloudUpload,
  IconLayoutGrid,
  IconMaximize,
  IconMinus,
  IconNote,
  IconPhoto,
  IconPlus,
  IconVideo,
  type Icon,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  ensureProject,
  getImage,
  putImage,
  renameProject,
  saveProjectContent,
  type ProjectAsset,
  type StoredCanvasNode,
} from "@/lib/canvas-store";
import { cn } from "@/lib/utils";
import { AssetLibrary, ASSET_DRAG_MIME } from "./asset-library";
import { AddNodeMenu, type AddNodeAction } from "./add-node-menu";
import { ToolbarButton, FLOATING_PANEL } from "./node-toolbar";
import { CanvasConnectionLine } from "./connection-line";
import { GradientEdge } from "./gradient-edge";
import { handleColor } from "./port-colors";
import { ImageNode, type ImageNodeType } from "./image-node";
import { PanoramaNode, type PanoramaNodeType } from "./panorama-node";
import { NoteNode, type NoteNodeType } from "./note-node";
import {
  PromptNode,
  VideoNode,
  type GenerationNodeData,
  type GenerationNodeType,
} from "./generation-card";
import { useAiCatalog } from "@/app/canvas/_lib/use-ai-catalog";
import { CanvasGenerationProvider } from "@/app/canvas/_lib/use-canvas-generation";
import { defaultMode, referenceFieldsForMode } from "@/app/canvas/_lib/generation-api";
import type { CardReference, CardReferences } from "./reference-stack";

export type CanvasNode = ImageNodeType | PanoramaNodeType | NoteNodeType | GenerationNodeType;

const nodeTypes = {
  image: ImageNode,
  panorama: PanoramaNode,
  note: NoteNode,
  prompt: PromptNode,
  video: VideoNode,
};
const edgeTypes = { gradient: GradientEdge };

// Zoom/pan tuning proven in apps/web's storyboard canvas.
const MIN_ZOOM = 0.16;
const MAX_ZOOM = 2.4;

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

function ZoomControls() {
  const { zoom } = useViewport();
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const controlClass =
    "flex size-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white";

  return (
    <div className="absolute right-4 bottom-4 z-20 flex items-center gap-0.5 rounded-full bg-popover/90 p-1 shadow-md backdrop-blur-xl">
      <button
        type="button"
        aria-label="Zoom out"
        className={controlClass}
        onClick={() => zoomOut()}
      >
        <IconMinus className="size-4" stroke={1.8} />
      </button>
      <span className="w-12 text-center text-xs text-white/70 tabular-nums select-none">
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" aria-label="Zoom in" className={controlClass} onClick={() => zoomIn()}>
        <IconPlus className="size-4" stroke={1.8} />
      </button>
      <button
        type="button"
        aria-label="Zoom to fit"
        className={controlClass}
        onClick={() => fitView({ padding: 0.3, duration: 300 })}
      >
        <IconMaximize className="size-4" stroke={1.8} />
      </button>
    </div>
  );
}

const DOCK_ITEMS: { action: AddNodeAction; label: string; Icon: Icon }[] = [
  { action: "upload", label: "Upload", Icon: IconCloudUpload },
  { action: "generate-image", label: "Image", Icon: IconPhoto },
  { action: "generate-video", label: "Video", Icon: IconVideo },
  { action: "note", label: "Note", Icon: IconNote },
];

/** Bottom dock: one click adds a node of a supported kind to the canvas. */
function NodeDock({ onAdd }: { onAdd: (action: AddNodeAction) => void }) {
  return (
    <div
      className={cn(
        "absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-2xl p-1.5",
        FLOATING_PANEL
      )}
    >
      {DOCK_ITEMS.map(({ action, label, Icon }) => (
        <ToolbarButton key={action} label={label} onClick={() => onAdd(action)}>
          <Icon className="size-5" stroke={1.7} />
        </ToolbarButton>
      ))}
    </div>
  );
}

/** Keep only references with a durable http URL (drop session blob URLs). */
function persistableReferences(references: GenerationNodeData["references"]) {
  if (!references) return undefined;
  const out: Record<string, CardReference[]> = {};
  for (const [field, list] of Object.entries(references)) {
    const keep = list.filter((r) => /^https?:/i.test(r.url));
    if (keep.length) out[field] = keep;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function toStoredNodes(nodes: CanvasNode[]): StoredCanvasNode[] {
  return nodes.map((node) => {
    if (node.type === "note") {
      return { id: node.id, position: node.position, kind: "note" as const, text: node.data.text };
    }
    if (node.type === "image" || node.type === "panorama") {
      return {
        id: node.id,
        position: node.position,
        kind: node.type,
        imageId: node.data.imageId || undefined,
        // Blob-backed src is a per-session object URL — only persist a durable url.
        src: node.data.imageId ? undefined : node.data.src,
        label: node.data.label,
      };
    }
    // Generation cards (`prompt` | `video`).
    return {
      id: node.id,
      position: node.position,
      kind: node.type,
      name: node.data.name,
      prompt: node.data.prompt,
      modelId: node.data.modelId,
      modelName: node.data.modelName,
      mode: node.data.mode,
      settings: node.data.settings,
      generation: node.data.generation,
      references: persistableReferences(node.data.references),
    };
  });
}

function CanvasInner({ projectId }: { projectId: string }) {
  const { data: catalog } = useAiCatalog();
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [projectName, setProjectName] = useState("Untitled canvas");
  const [addMenu, setAddMenu] = useState<AddMenuState | null>(null);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const { screenToFlowPosition, fitView, getNodes, getNode, updateNodeData } = useReactFlow();
  const loadedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadFlowPos = useRef<{ x: number; y: number } | null>(null);
  const pendingUploadConnection = useRef<PendingConnection | null>(null);
  const reconnectDone = useRef(true);
  const lastConnectEndAt = useRef(0);
  const connectStartRef = useRef<{ x: number; y: number; color: string } | null>(null);

  // Restore the project from local storage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const project = await ensureProject(projectId);
      if (cancelled) return;
      setProjectName(project.name);
      const restored: CanvasNode[] = [];
      for (const stored of project.nodes) {
        // Records written before node kinds existed are image nodes.
        const kind = stored.kind ?? "image";
        if (kind === "note" && stored.kind === "note") {
          restored.push({
            id: stored.id,
            type: "note",
            position: stored.position,
            data: { text: stored.text },
          });
          continue;
        }
        if (
          (kind === "prompt" || kind === "video") &&
          (stored.kind === "prompt" || stored.kind === "video")
        ) {
          restored.push({
            id: stored.id,
            type: stored.kind,
            position: stored.position,
            data: {
              name: stored.name,
              prompt: stored.prompt,
              modelId: stored.modelId,
              modelName: stored.modelName,
              mode: stored.mode,
              settings: stored.settings,
              generation: stored.generation,
              references: stored.references as GenerationNodeData["references"],
            },
          });
          continue;
        }
        if (stored.kind !== "image" && stored.kind !== "panorama") continue;
        let src = stored.src;
        if (stored.imageId) {
          const blob = await getImage(stored.imageId);
          if (blob) src = URL.createObjectURL(blob);
        }
        if (!src) continue;
        restored.push({
          id: stored.id,
          type: stored.kind,
          position: stored.position,
          data: { src, imageId: stored.imageId ?? "", label: stored.label },
        });
      }
      if (cancelled) return;
      setNodes(restored);
      // Drop edges that point at input handles removed from the generation
      // nodes (they can no longer bind, and React Flow warns on each).
      setEdges(
        (project.edges ?? [])
          .filter((edge) => edge.targetHandle !== "prompt" && edge.targetHandle !== "reference")
          .map((edge) => ({ ...edge, type: "gradient" }))
      );
      loadedRef.current = true;
      if (restored.length > 0) {
        setTimeout(() => fitView({ padding: 0.3 }), 60);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, setNodes, setEdges, fitView]);

  // Persist layout/content changes, debounced.
  useEffect(() => {
    if (!loadedRef.current) return;
    const handle = setTimeout(() => {
      void saveProjectContent(
        projectId,
        toStoredNodes(nodes),
        edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({
          id,
          source,
          target,
          sourceHandle,
          targetHandle,
        }))
      );
    }, 600);
    return () => clearTimeout(handle);
  }, [nodes, edges, projectId]);

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
    (nodeId: string | null | undefined): "image" | "video" | undefined => {
      if (!nodeId) return undefined;
      const node = getNode(nodeId);
      if (!node) return undefined;
      if (node.type === "image" || node.type === "panorama" || node.type === "prompt")
        return "image";
      if (node.type === "video") return "video";
      return undefined;
    },
    [getNode]
  );

  // The media URL a source node exposes — an image node's src, or another
  // generation card's produced output (enables card→card chaining).
  const sourceMediaUrl = useCallback(
    (nodeId: string | null | undefined) => {
      if (!nodeId) return undefined;
      const node = getNode(nodeId);
      if (!node) return undefined;
      if (node.type === "image" || node.type === "panorama")
        return (node.data as { src?: string }).src;
      if (node.type === "prompt" || node.type === "video") {
        return (node.data as GenerationNodeData).generation?.outputs?.[0]?.url;
      }
      return undefined;
    },
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
      if (!model) return undefined;
      const currentMode = data.mode ?? defaultMode(model);
      const refs = data.references ?? {};
      const inCurrent = referenceFieldsForMode(model, currentMode).find(
        (f) => f.kind === kind && (refs[f.field]?.length ?? 0) < f.maxItems
      );
      if (inCurrent) return { field: inCurrent.field };
      for (const m of model.generationModes ?? []) {
        const f = referenceFieldsForMode(model, m).find((ff) => ff.kind === kind);
        if (f) return { mode: m, field: f.field };
      }
      return undefined;
    },
    [getNode, catalog]
  );

  // Simple model: any card's output can wire into any card's input. React Flow
  // only allows source→target, so this is output→input — just block self-loops.
  const isValidConnection = useCallback<IsValidConnection<Edge>>(
    (connection) => connection.targetHandle === "input" && connection.source !== connection.target,
    []
  );

  // The connection (if any) when a node is spawned/hit from a dragged wire.
  const connectionForPending = useCallback(
    (pending: PendingConnection, otherNodeId: string, otherNodeType: string): Connection | null => {
      // Dragged from a card's "+" input → an image source feeds it.
      if (pending.handleType === "target" && otherNodeType === "image") {
        return {
          source: otherNodeId,
          sourceHandle: "output",
          target: pending.nodeId,
          targetHandle: "input",
        };
      }
      // Dragged from a "+" output → into any card.
      if (
        pending.handleType === "source" &&
        (otherNodeType === "prompt" || otherNodeType === "video")
      ) {
        return {
          source: pending.nodeId,
          sourceHandle: "output",
          target: otherNodeId,
          targetHandle: "input",
        };
      }
      return null;
    },
    []
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const edge: Edge = { id: crypto.randomUUID(), type: "gradient", ...connection };
      setEdges((eds) => addEdge(edge, eds));
      // Bind the source as a reference where it fits (auto-switching the card's
      // mode if needed — e.g. an image into a video card → image-to-video). If
      // the card can't take this kind at all, the wire stands but binds nothing.
      if (connection.targetHandle !== "input" || !connection.target) return;
      const kind = sourceOutputKind(connection.source);
      const routed = kind ? routeReferenceField(connection.target, kind) : undefined;
      const url = sourceMediaUrl(connection.source);
      if (!kind || !routed || !url) return;
      const reference: CardReference = {
        id: edge.id,
        edgeId: edge.id,
        sourceNodeId: connection.source ?? undefined,
        url,
        kind,
      };
      updateNodeData(connection.target, (node) => {
        const refs = (node.data as GenerationNodeData).references ?? {};
        const list = (refs[routed.field] ?? []).filter((r) => r.edgeId !== edge.id);
        const patch: Partial<GenerationNodeData> = {
          references: { ...refs, [routed.field]: [...list, reference] },
        };
        if (routed.mode) patch.mode = routed.mode;
        return patch;
      });
    },
    [setEdges, sourceOutputKind, routeReferenceField, sourceMediaUrl, updateNodeData]
  );

  // Deleting a wire drops the reference it bound. The field isn't on the edge
  // (the single "+" input fans out), so search every field by edge id.
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const edge of deleted) {
        if (!edge.target) continue;
        updateNodeData(edge.target, (node) => {
          const refs = (node.data as GenerationNodeData).references ?? {};
          const next: CardReferences = {};
          for (const [field, list] of Object.entries(refs)) {
            next[field] = list.filter((r) => r.edgeId !== edge.id);
          }
          return { references: next };
        });
      }
    },
    [updateNodeData]
  );

  const addImageFiles = useCallback(
    async (files: File[], base: { x: number; y: number }) => {
      const additions: CanvasNode[] = [];
      for (const [index, file] of files.entries()) {
        const imageId = await putImage(file);
        additions.push({
          id: crypto.randomUUID(),
          type: "image",
          position: { x: base.x + index * 32, y: base.y + index * 32 },
          data: { src: URL.createObjectURL(file), imageId, label: file.name },
        });
      }
      setNodes((prev) => [...prev, ...additions]);
      return additions.map((node) => node.id);
    },
    [setNodes]
  );

  const addNode = useCallback(
    (node: CanvasNode) => {
      // Select the new node (and deselect the rest) so generation cards reveal
      // their composer immediately on create.
      setNodes((prev) => [
        ...prev.map((n) => (n.selected ? { ...n, selected: false } : n)),
        { ...node, selected: true },
      ]);
      setAddMenu(null);
    },
    [setNodes]
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
          data: { prompt: "", name: `Image ${count + 1}` },
        });
      } else if (nodeType === "video") {
        const count = nodes.filter((node) => node.type === "video").length;
        addNode({
          id,
          type: "video",
          position: flow,
          data: { prompt: "", name: `Video ${count + 1}` },
        });
      } else {
        addNode({ id, type: "note", position: flow, data: { text: "" } });
      }
      if (pending) {
        const connection = connectionForPending(pending, id, nodeType);
        if (connection) onConnect(connection);
      }
    },
    [nodes, addNode, connectionForPending, onConnect]
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

  // Place a library asset on the canvas as an image node — at `position` when
  // dragged-and-dropped, else the viewport center (click-to-add).
  const addAssetToCanvas = useCallback(
    async (asset: ProjectAsset, position?: { x: number; y: number }) => {
      if (asset.kind !== "image") {
        toast.info("Video assets · coming soon");
        return;
      }
      let src = asset.url;
      let imageId = "";
      if (!src && asset.imageId) {
        const blob = await getImage(asset.imageId);
        if (blob) {
          src = URL.createObjectURL(blob);
          imageId = asset.imageId;
        }
      }
      if (!src) return;
      addNode({
        id: crypto.randomUUID(),
        type: asset.panorama ? "panorama" : "image",
        position:
          position ?? screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
        data: { src, imageId, label: asset.prompt },
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
          void addAssetToCanvas(JSON.parse(assetData) as ProjectAsset, dropPosition);
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
      void addImageFiles(files, base).then(([firstId]) => {
        if (!pending || !firstId) return;
        const connection = connectionForPending(pending, firstId, "image");
        if (connection) onConnect(connection);
      });
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
          hit.type === "video")
      ) {
        const connection = connectionForPending(pending, hit.id, hit.type);
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
      setEdges((eds) => reconnectEdge(oldEdge, connection, eds));
    },
    [setEdges]
  );
  const onReconnectEnd = useCallback(
    (_event: unknown, edge: Edge) => {
      if (!reconnectDone.current) {
        setEdges((eds) => eds.filter((candidate) => candidate.id !== edge.id));
      }
      reconnectDone.current = true;
    },
    [setEdges]
  );

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

  return (
    <CanvasGenerationProvider projectId={projectId} catalog={catalog}>
      <div
        ref={containerRef}
        className="relative h-full"
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDoubleClick={onDoubleClick}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onEdgesDelete={onEdgesDelete}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          edgesReconnectable
          onReconnectStart={onReconnectStart}
          onReconnect={onReconnect}
          onReconnectEnd={onReconnectEnd}
          isValidConnection={isValidConnection}
          connectionRadius={38}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineComponent={CanvasConnectionLine}
          colorMode="dark"
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          panOnScroll
          panOnScrollMode={PanOnScrollMode.Free}
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          deleteKeyCode={["Backspace", "Delete"]}
          onPaneClick={() => {
            if (Date.now() - lastConnectEndAt.current < 250) return;
            setAddMenu(null);
          }}
          onMoveStart={() => setAddMenu(null)}
          className="!bg-[oklch(0.105_0_0)]"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1.5}
            color="rgb(255 255 255 / 0.07)"
          />
        </ReactFlow>

        <div className="absolute top-4 left-4 z-20 flex items-center gap-1">
          <Link
            href="/canvas"
            aria-label="Back to projects"
            className="flex size-9 items-center justify-center rounded-full bg-popover/90 shadow-md backdrop-blur-xl transition-colors hover:bg-accent"
          >
            <IconArrowLeft className="size-4" />
          </Link>
          <input
            value={projectName}
            aria-label="Project name"
            placeholder="Untitled"
            onChange={(event) => setProjectName(event.target.value)}
            onBlur={() => {
              const trimmed = projectName.trim();
              if (trimmed) setProjectName(trimmed);
              void renameProject(projectId, trimmed);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="field-sizing-content h-9 min-w-[80px] max-w-[280px] rounded-full bg-popover/90 px-3.5 text-sm font-medium shadow-md backdrop-blur-xl outline-none transition-colors hover:bg-accent focus:bg-accent"
          />
        </div>

        <div className="absolute top-4 right-4 z-20 flex h-9 items-center gap-1.5 rounded-full bg-popover/90 px-3.5 text-sm font-medium shadow-md backdrop-blur-xl">
          <IconBolt className="size-4 text-white/85" stroke={1.8} />
          <span className="tabular-nums">Credits</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={onPickFiles}
        />

        <ZoomControls />
        <NodeDock onAdd={addNodeFromDock} />

        {/* Left rail (root-sidebar style) — opens the project's asset library. */}
        {!assetsOpen && (
          <div className="absolute top-1/2 left-4 z-20 flex -translate-y-1/2 flex-col gap-1 rounded-2xl bg-popover/90 p-1.5 shadow-md backdrop-blur-xl">
            <button
              type="button"
              aria-label="Open assets"
              onClick={() => setAssetsOpen(true)}
              className="flex size-9 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <IconLayoutGrid className="size-5" stroke={1.7} />
            </button>
          </div>
        )}
        <AssetLibrary
          projectId={projectId}
          open={assetsOpen}
          onClose={() => setAssetsOpen(false)}
        />

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
            onAction={(action: AddNodeAction) => {
              addNodeOfType(action, addMenu.flow, addMenu.pending);
              setAddMenu(null);
            }}
          />
        )}

        {nodes.length === 0 && !addMenu && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Double-click to add a node, or describe what to create below
            </p>
          </div>
        )}
      </div>
    </CanvasGenerationProvider>
  );
}

export function CanvasView({ projectId }: { projectId: string }) {
  return (
    <ReactFlowProvider>
      <CanvasInner projectId={projectId} />
    </ReactFlowProvider>
  );
}
