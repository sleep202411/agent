"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  IconPlus,
  IconTrash,
  IconUpload,
  IconVideo,
  IconArrowLeft,
  IconLoader2,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ─── Types ──────────────────────────────────

interface EpisodeNodeData {
  title: string;
  videoFile: File | null;
  videoPreview: string;
  isStart: boolean;
  isEnding: boolean;
  onUpdate: (id: string, data: Partial<EpisodeNodeData>) => void;
  onDelete: (id: string) => void;
  t: (key: string) => string;
  [key: string]: unknown;
}

// ─── Episode Node Component ─────────────────

function EpisodeNode({ id, data }: NodeProps<Node<EpisodeNodeData>>) {
  const { title, videoPreview, isStart, isEnding, onUpdate, onDelete, t } = data;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (!file.type.startsWith("video/")) {
      toast.error(t("interactiveVideoTypeError"));
      return;
    }
    onUpdate(id, {
      videoFile: file,
      videoPreview: URL.createObjectURL(file),
    });
  };

  return (
    <div className="w-72 rounded-xl border border-border bg-card shadow-lg">
      {/* Input handle (top) */}
      {!isStart && (
        <Handle
          type="target"
          position={Position.Top}
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            border: "2px solid #e53e3e",
            background: "#1a1a2e",
            zIndex: 10,
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {isStart && (
          <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
            {t("interactiveStart")}
          </span>
        )}
        {isEnding && (
          <span className="shrink-0 rounded-full bg-green-500/15 px-1.5 py-0.5 text-[9px] font-bold text-green-400">
            {t("interactiveEnding")}
          </span>
        )}
        <input
          value={title}
          onChange={(e) => onUpdate(id, { title: e.target.value })}
          placeholder={t("interactiveEpisodeTitle")}
          className="nodrag h-6 flex-1 border-0 bg-transparent px-0 text-xs font-medium text-foreground outline-none placeholder:text-muted-foreground"
        />
        {!isStart && (
          <button
            type="button"
            onClick={() => onDelete(id)}
            className="rounded p-0.5 text-muted-foreground hover:text-destructive"
          >
            <IconTrash className="size-3.5" />
          </button>
        )}
      </div>

      {/* Video */}
      <div className="p-2">
        {videoPreview ? (
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video src={videoPreview} className="aspect-video w-full object-contain" />
            <label className="nodrag absolute bottom-1 right-1 flex cursor-pointer items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white hover:bg-black/80">
              <IconUpload className="size-2.5" />
              {t("interactiveChangeVideo")}
              <input type="file" accept="video/*" className="hidden" onChange={handleVideoSelect} />
            </label>
          </div>
        ) : (
          <label className="nodrag flex aspect-video cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/20 text-muted-foreground hover:border-primary/50 hover:text-primary">
            <IconVideo className="size-6" />
            <span className="text-[10px]">{t("interactiveUploadVideo")}</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={handleVideoSelect}
            />
          </label>
        )}
      </div>

      {/* Output handle (bottom) — for connecting to next episodes */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "2px solid #888",
          background: "#1a1a2e",
          zIndex: 10,
        }}
      />
    </div>
  );
}

const nodeTypes = { episode: EpisodeNode };

// ─── Helpers ────────────────────────────────

let idCounter = 0;
function nextId() {
  return `ep_${++idCounter}`;
}

function createEpisodeNode(
  x: number,
  y: number,
  isStart: boolean,
  callbacks: {
    onUpdate: EpisodeNodeData["onUpdate"];
    onDelete: EpisodeNodeData["onDelete"];
    t: EpisodeNodeData["t"];
  }
): Node<EpisodeNodeData> {
  return {
    id: nextId(),
    type: "episode",
    position: { x, y },
    data: {
      title: "",
      videoFile: null,
      videoPreview: "",
      isStart,
      isEnding: false,
      ...callbacks,
    },
  };
}

// ─── Main Page ──────────────────────────────

export default function InteractiveEditorPage() {
  const t = useTranslations("profile");
  const router = useRouter();
  const saving = false;
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId?: string;
  } | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<EpisodeNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const onUpdateNode = useCallback(
    (nodeId: string, updates: Partial<EpisodeNodeData>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n))
      );
    },
    [setNodes]
  );

  const onDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    },
    [setNodes, setEdges]
  );

  // Initialize with one start node
  const initialized = useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    const startNode = createEpisodeNode(300, 50, true, {
      onUpdate: onUpdateNode,
      onDelete: onDeleteNode,
      t,
    });
    setNodes([startNode]);
  }

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: "default",
            animated: true,
            style: { stroke: "#e53e3e", strokeWidth: 2 },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const handleAddNode = useCallback(() => {
    const lastNode = nodes[nodes.length - 1];
    const x = (lastNode?.position?.x ?? 300) + (Math.random() * 100 - 50);
    const y = (lastNode?.position?.y ?? 0) + 350;
    const newNode = createEpisodeNode(x, y, false, {
      onUpdate: onUpdateNode,
      onDelete: onDeleteNode,
      t,
    });
    setNodes((nds) => [...nds, newNode]);
  }, [nodes, onUpdateNode, onDeleteNode, t, setNodes]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }, []);

  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    const bounds = flowRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setContextMenu({
      x: (event as React.MouseEvent).clientX,
      y: (event as React.MouseEvent).clientY,
    });
  }, []);

  const onPaneClick = useCallback(() => setContextMenu(null), []);

  const handleToggleEnding = useCallback(
    (nodeId: string) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, isEnding: !n.data.isEnding } } : n
        )
      );
      setContextMenu(null);
    },
    [setNodes]
  );

  const handleSave = () => {
    // This legacy editor has no persistence contract. Preserve the draft in
    // memory, but never acknowledge a save that did not occur.
    toast.error(t("interactiveSaveUnavailable"));
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/profile")}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <IconArrowLeft className="size-5" />
          </button>
          <h1 className="text-sm font-semibold">{t("interactiveEditorTitle")}</h1>
          <span className="text-xs text-muted-foreground">
            {nodes.length} {t("interactiveNodeCount")} · {edges.length} {t("interactiveEdgeCount")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleAddNode}>
            <IconPlus className="size-3.5" />
            {t("interactiveAddEpisode")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving && <IconLoader2 className="size-3.5 animate-spin" />}
            {t("interactiveSave")}
          </Button>
        </div>
      </header>

      {/* Canvas */}
      <div className="relative flex-1" ref={flowRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeContextMenu={onNodeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          snapToGrid
          snapGrid={[20, 20]}
          deleteKeyCode={["Backspace", "Delete"]}
          className="bg-background"
        >
          <Background gap={20} size={1} color="hsl(var(--border) / 0.3)" />
          <Controls className="!rounded-lg !border !border-border !bg-card !shadow-md [&>button]:!border-border [&>button]:!bg-card [&>button]:!text-foreground [&>button:hover]:!bg-muted" />
          <MiniMap
            className="!rounded-lg !border !border-border !bg-card"
            nodeColor="hsl(var(--primary) / 0.3)"
            maskColor="hsl(var(--background) / 0.8)"
          />
        </ReactFlow>

        {/* Context menu */}
        {contextMenu && (
          <div
            className="fixed z-50 min-w-40 rounded-lg border border-border bg-popover p-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.nodeId ? (
              <>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                  onClick={() => {
                    handleToggleEnding(contextMenu.nodeId!);
                  }}
                >
                  {nodes.find((n) => n.id === contextMenu.nodeId)?.data.isEnding
                    ? t("interactiveUnsetEnding")
                    : t("interactiveSetEnding")}
                </button>
                {!nodes.find((n) => n.id === contextMenu.nodeId)?.data.isStart && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/10"
                    onClick={() => {
                      onDeleteNode(contextMenu.nodeId!);
                      setContextMenu(null);
                    }}
                  >
                    {t("interactiveDeleteNode")}
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                onClick={() => {
                  handleAddNode();
                  setContextMenu(null);
                }}
              >
                <IconPlus className="size-3.5" />
                {t("interactiveAddEpisode")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
