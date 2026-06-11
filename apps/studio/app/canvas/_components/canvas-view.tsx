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
import { IconArrowLeft, IconMaximize, IconMinus, IconPlus, IconUpload } from "@tabler/icons-react";
import {
  getImage,
  getProject,
  putImage,
  saveProjectContent,
  type StoredCanvasNode,
} from "@/lib/canvas-store";
import { AddNodeMenu, type AddNodeAction, type ConnectFilter } from "./add-node-menu";
import { CanvasConnectionLine } from "./connection-line";
import { GradientEdge } from "./gradient-edge";
import { handleColor } from "./port-colors";
import { ImageNode, type ImageNodeType } from "./image-node";
import { NoteNode, type NoteNodeType } from "./note-node";
import { PromptNode, VideoNode, type GenerationNodeType } from "./generation-card";

export type CanvasNode = ImageNodeType | NoteNodeType | GenerationNodeType;

const nodeTypes = { image: ImageNode, note: NoteNode, prompt: PromptNode, video: VideoNode };
const edgeTypes = { gradient: GradientEdge };

// Which node-menu items make sense after dragging a wire from this handle.
function filterForHandle(handleId: string | null): ConnectFilter | undefined {
  if (handleId === "image" || handleId === "reference") return "image";
  if (handleId === "text" || handleId === "prompt") return "text";
  if (handleId === "video") return "video";
  return undefined;
}

// Zoom/pan tuning proven in apps/web's storyboard canvas.
const MIN_ZOOM = 0.16;
const MAX_ZOOM = 2.4;

// Typed connections: text feeds prompts, images feed references (imagine.art model).
const isValidConnection: IsValidConnection<Edge> = (connection) => {
  if (connection.targetHandle === "prompt") return connection.sourceHandle === "text";
  if (connection.targetHandle === "reference") return connection.sourceHandle === "image";
  return true;
};

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

function newEdge(connection: Connection): Edge {
  return { id: crypto.randomUUID(), type: "gradient", ...connection };
}

/**
 * The edge to create when a node is spawned from a dragged-out connection.
 * Forward drags (from an output) wire into the new node's matching input;
 * backward drags (from an input) wire the new node's output into it.
 */
function edgeForPending(
  pending: PendingConnection,
  newNodeId: string,
  newNodeType: "prompt" | "note" | "image" | "video"
): Edge | null {
  if (pending.handleType === "source") {
    if (newNodeType !== "prompt" && newNodeType !== "video") return null;
    const targetHandle =
      pending.handleId === "text" ? "prompt" : pending.handleId === "image" ? "reference" : null;
    if (!targetHandle) return null;
    return newEdge({
      source: pending.nodeId,
      sourceHandle: pending.handleId,
      target: newNodeId,
      targetHandle,
    });
  }
  if (pending.handleId === "prompt" && newNodeType === "note") {
    return newEdge({
      source: newNodeId,
      sourceHandle: "text",
      target: pending.nodeId,
      targetHandle: "prompt",
    });
  }
  if (pending.handleId === "reference" && (newNodeType === "image" || newNodeType === "prompt")) {
    return newEdge({
      source: newNodeId,
      sourceHandle: "image",
      target: pending.nodeId,
      targetHandle: "reference",
    });
  }
  return null;
}

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

function toStoredNodes(nodes: CanvasNode[]): StoredCanvasNode[] {
  return nodes.map((node) => {
    if (node.type === "note") {
      return { id: node.id, position: node.position, kind: "note" as const, text: node.data.text };
    }
    if (node.type === "image") {
      return {
        id: node.id,
        position: node.position,
        kind: "image" as const,
        imageId: node.data.imageId,
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
    };
  });
}

function CanvasInner({ projectId }: { projectId: string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [projectName, setProjectName] = useState("Untitled canvas");
  const [addMenu, setAddMenu] = useState<AddMenuState | null>(null);
  const { screenToFlowPosition, fitView, getNodes } = useReactFlow();
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
      const project = await getProject(projectId);
      if (cancelled) return;
      if (!project) {
        loadedRef.current = true;
        return;
      }
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
            },
          });
          continue;
        }
        if (stored.kind !== "image") continue;
        const blob = await getImage(stored.imageId);
        if (!blob) continue;
        restored.push({
          id: stored.id,
          type: "image",
          position: stored.position,
          data: { src: URL.createObjectURL(blob), imageId: stored.imageId, label: stored.label },
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

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) => addEdge({ ...connection, type: "gradient" }, eds)),
    [setEdges]
  );

  const addEdgeUnique = useCallback(
    (edge: Edge) => {
      setEdges((eds) =>
        eds.some(
          (e) =>
            e.source === edge.source &&
            e.target === edge.target &&
            e.sourceHandle === edge.sourceHandle &&
            e.targetHandle === edge.targetHandle
        )
          ? eds
          : [...eds, edge]
      );
    },
    [setEdges]
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

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/")
      );
      if (files.length === 0) return;
      void addImageFiles(files, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [addImageFiles, screenToFlowPosition]
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
        const edge = edgeForPending(pending, firstId, "image");
        if (edge) addEdgeUnique(edge);
      });
    },
    [addImageFiles, screenToFlowPosition, setEdges]
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
        const edge = edgeForPending(pending, hit.id, hit.type);
        if (edge) addEdgeUnique(edge);
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
    [screenToFlowPosition, getNodes, addEdgeUnique]
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

      <Link
        href="/canvas"
        aria-label="Back to canvas projects"
        className="absolute top-4 left-4 z-20 flex h-9 items-center gap-2 rounded-full bg-popover/90 pr-3.5 pl-2.5 text-sm font-medium shadow-md backdrop-blur-xl transition-colors hover:bg-accent"
      >
        <IconArrowLeft className="size-4" />
        {projectName}
      </Link>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="absolute top-4 right-4 z-20 flex h-9 items-center gap-2 rounded-full bg-popover/90 px-3.5 text-sm font-medium shadow-md backdrop-blur-xl transition-colors hover:bg-accent"
      >
        <IconUpload className="size-4" stroke={1.8} />
        Upload
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onPickFiles}
      />

      <ZoomControls />

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
          filter={addMenu.pending ? filterForHandle(addMenu.pending.handleId) : undefined}
          onAction={(action: AddNodeAction) => {
            if (action === "upload") {
              pendingUploadFlowPos.current = addMenu.flow;
              pendingUploadConnection.current = addMenu.pending ?? null;
              setAddMenu(null);
              fileInputRef.current?.click();
              return;
            }
            const id = crypto.randomUUID();
            const nodeType =
              action === "generate-image"
                ? ("prompt" as const)
                : action === "generate-video"
                  ? ("video" as const)
                  : ("note" as const);
            if (nodeType === "prompt") {
              const count = nodes.filter((node) => node.type === "prompt").length;
              addNode({
                id,
                type: "prompt",
                position: addMenu.flow,
                data: { prompt: "", name: `Image ${count + 1}` },
              });
            } else if (nodeType === "video") {
              const count = nodes.filter((node) => node.type === "video").length;
              addNode({
                id,
                type: "video",
                position: addMenu.flow,
                data: { prompt: "", name: `Video ${count + 1}` },
              });
            } else {
              addNode({ id, type: "note", position: addMenu.flow, data: { text: "" } });
            }
            if (addMenu.pending) {
              const edge = edgeForPending(addMenu.pending, id, nodeType);
              if (edge) addEdgeUnique(edge);
            }
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
  );
}

export function CanvasView({ projectId }: { projectId: string }) {
  return (
    <ReactFlowProvider>
      <CanvasInner projectId={projectId} />
    </ReactFlowProvider>
  );
}
