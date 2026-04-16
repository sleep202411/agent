import { useState, useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type ColorMode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  IconArrowLeft,
  IconPlus,
  IconFlag,
  IconFlagFilled,
  IconPlayerPlay,
  IconDeviceFloppy,
  IconMaximize,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { VideoNodeMemo } from "@/components/ip/interactive-node";
import { MOCK_NODES, MOCK_EDGES, type VideoNodeData } from "@/components/ip/interactive-mock";

const NODE_TYPES = { video: VideoNodeMemo };

export default function InteractiveEditorPage({ id, epId }: { id: string; epId: string }) {
  const t = useTranslations("interactiveEditor");
  const [nodes, setNodes, onNodesChange] = useNodesState(MOCK_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(MOCK_EDGES);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, type: "smoothstep" }, eds));
    },
    [setEdges]
  );

  const addNode = useCallback(
    (type: "normal" | "ending") => {
      const newId = `node-${Date.now()}`;
      const newNode = {
        id: newId,
        type: "video" as const,
        position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 200 },
        data: {
          label: type === "ending" ? t("newEnding") : t("newScene"),
          description: "",
          videoUrl: "",
          duration: 30,
          isEnding: type === "ending",
          choices: [],
        } satisfies VideoNodeData,
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes, t]
  );

  const handleSave = () => {
    // TODO: save to backend
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const selectedNodeData = useMemo(() => {
    if (!selectedNode) return null;
    return nodes.find((n) => n.id === selectedNode) ?? null;
  }, [selectedNode, nodes]);

  const updateNodeData = useCallback(
    (nodeId: string, patch: Partial<VideoNodeData>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n))
      );
    },
    [setNodes]
  );

  // Stats
  const startNodes = nodes.filter((n) => (n.data as VideoNodeData).isStart).length;
  const endingNodes = nodes.filter((n) => (n.data as VideoNodeData).isEnding).length;
  const totalDuration = nodes.reduce(
    (sum, n) => sum + ((n.data as VideoNodeData).duration || 0),
    0
  );

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
        <div className="flex items-center gap-3">
          <a
            href={`/ips/${id}/edit`}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <IconArrowLeft className="size-4" />
          </a>
          <div>
            <h1 className="text-sm font-bold text-foreground">{t("pageTitle")}</h1>
            <span className="text-xs text-muted-foreground">EP{epId}</span>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            <IconFlag className="mr-0.5 inline size-3 text-green-400" /> {startNodes} {t("starts")}
          </span>
          <span>
            <IconPlayerPlay className="mr-0.5 inline size-3 text-primary" /> {nodes.length}{" "}
            {t("scenes")}
          </span>
          <span>
            <IconFlagFilled className="mr-0.5 inline size-3 text-amber-400" /> {endingNodes}{" "}
            {t("endings")}
          </span>
          <span>
            {Math.floor(totalDuration / 60)}:{String(totalDuration % 60).padStart(2, "0")}{" "}
            {t("totalDuration")}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-green-400">{t("saved")}</span>}
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <IconDeviceFloppy className="size-3.5" /> {t("save")}
          </button>
        </div>
      </div>

      {/* Main editor */}
      <div className="flex flex-1 overflow-hidden">
        {/* React Flow canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNode(node.id)}
            onPaneClick={() => setSelectedNode(null)}
            nodeTypes={NODE_TYPES}
            colorMode={"dark" as ColorMode}
            fitView
            defaultEdgeOptions={{ type: "smoothstep", animated: true }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(n) => {
                const data = n.data as VideoNodeData;
                if (data.isStart) return "#4ade80";
                if (data.isEnding) return "#fbbf24";
                return "#818cf8";
              }}
              className="!bg-card !border-border"
            />

            {/* Add node buttons */}
            <Panel position="top-left">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => addNode("normal")}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground shadow-lg transition-colors hover:bg-secondary"
                >
                  <IconPlus className="size-3.5 text-primary" /> {t("addScene")}
                </button>
                <button
                  type="button"
                  onClick={() => addNode("ending")}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-400/30 bg-card px-3 py-2 text-xs font-medium text-foreground shadow-lg transition-colors hover:bg-amber-400/5"
                >
                  <IconFlagFilled className="size-3.5 text-amber-400" /> {t("addEnding")}
                </button>
              </div>
            </Panel>
          </ReactFlow>
        </div>

        {/* Right panel — node editor */}
        {selectedNodeData && (
          <div className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-border bg-card p-4">
            <h3 className="text-sm font-bold text-foreground">{t("nodeSettings")}</h3>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("sceneTitle")}
              </label>
              <input
                type="text"
                value={(selectedNodeData.data as VideoNodeData).label}
                onChange={(e) => updateNodeData(selectedNodeData.id, { label: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("sceneDesc")}
              </label>
              <textarea
                value={(selectedNodeData.data as VideoNodeData).description}
                onChange={(e) =>
                  updateNodeData(selectedNodeData.id, { description: e.target.value })
                }
                rows={3}
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("duration")} (s)
              </label>
              <input
                type="number"
                value={(selectedNodeData.data as VideoNodeData).duration}
                onChange={(e) =>
                  updateNodeData(selectedNodeData.id, { duration: Number(e.target.value) || 0 })
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("video")}
              </label>
              <div className="flex aspect-video items-center justify-center rounded-lg border-2 border-dashed border-border bg-secondary/50">
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  <IconPlus className="mx-auto mb-1 size-5" />
                  {t("uploadVideo")}
                </button>
              </div>
            </div>

            {/* Choices */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">{t("choices")}</label>
                {!(selectedNodeData.data as VideoNodeData).isEnding && (
                  <button
                    type="button"
                    onClick={() => {
                      const data = selectedNodeData.data as VideoNodeData;
                      updateNodeData(selectedNodeData.id, {
                        choices: [
                          ...data.choices,
                          { id: `ch-${Date.now()}`, label: "", targetNodeId: "" },
                        ],
                      });
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    + {t("addChoice")}
                  </button>
                )}
              </div>
              {(selectedNodeData.data as VideoNodeData).isEnding ? (
                <p className="text-xs text-muted-foreground/60">{t("endingNoChoices")}</p>
              ) : (
                <div className="space-y-2">
                  {(selectedNodeData.data as VideoNodeData).choices.map((choice, i) => (
                    <div key={choice.id} className="flex items-center gap-2">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
                        {String.fromCharCode(65 + i)}
                      </span>
                      <input
                        type="text"
                        value={choice.label}
                        onChange={(e) => {
                          const data = selectedNodeData.data as VideoNodeData;
                          const newChoices = [...data.choices];
                          newChoices[i] = { ...newChoices[i], label: e.target.value };
                          updateNodeData(selectedNodeData.id, { choices: newChoices });
                        }}
                        placeholder={t("choicePlaceholder")}
                        className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const data = selectedNodeData.data as VideoNodeData;
                          updateNodeData(selectedNodeData.id, {
                            choices: data.choices.filter((_, j) => j !== i),
                          });
                        }}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <IconX className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Node type toggles */}
            <div className="border-t border-border pt-4">
              <label className="mb-2 block text-xs font-medium text-muted-foreground">
                {t("nodeType")}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    updateNodeData(selectedNodeData.id, { isStart: true, isEnding: false })
                  }
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium",
                    (selectedNodeData.data as VideoNodeData).isStart
                      ? "border-green-400/40 bg-green-400/10 text-green-400"
                      : "border-border text-muted-foreground"
                  )}
                >
                  <IconFlag className="mr-1 inline size-3" /> {t("startNode")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateNodeData(selectedNodeData.id, {
                      isEnding: true,
                      isStart: false,
                      choices: [],
                    })
                  }
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium",
                    (selectedNodeData.data as VideoNodeData).isEnding
                      ? "border-amber-400/40 bg-amber-400/10 text-amber-400"
                      : "border-border text-muted-foreground"
                  )}
                >
                  <IconFlagFilled className="mr-1 inline size-3" /> {t("endNode")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IconX({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
