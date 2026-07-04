"use client";

import { useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { IconPlus } from "@tabler/icons-react";
import { AiEdgeGlow, AiSketchGhost } from "./ai-edge-glow";
import { NODE_TYPES } from "./canvas/cards/narrative-node-card";
import { DraftConflictBanner } from "./canvas/conflict-banner";
import { CanvasHeader } from "./canvas/header";
import { CanvasIntake } from "./canvas/intake";
import { NodeEditorPanel } from "./canvas/node-editor-panel";
import { CURVED_EDGE_OPTIONS } from "./canvas/ports";
import type { NarrativeEdge, NarrativeNode } from "./canvas/types";
import { useCanvasInteractions } from "./canvas/use-canvas-interactions";
import { useStoryDraft } from "./canvas/use-story-draft";
import { useStoryGeneration } from "./canvas/use-story-generation";
import { CharacterViewer, StoryRootViewer } from "./canvas/viewers";

type StoryStudioCanvasProps = {
  projectId?: string | null;
};

/** The workbench orchestrator: owns the canvas state, composes the draft
 *  persistence / StoryOS generation / interaction hooks (./canvas/*), and
 *  lays out the chrome around the React Flow surface. Split from
 *  StoryStudioCanvas only because useReactFlow needs the provider above. */
function NarrativeStudioInner({ projectId }: StoryStudioCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<NarrativeNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<NarrativeEdge>([]);
  const [canvasTitle, setCanvasTitle] = useState("未命名故事");
  /** fizzstory-v3 story spec (genre / generator stamp / pipeline state) —
   *  REACT STATE, not a ref: pure spec changes must trigger autosave and
   *  join the snapshot signature. */
  const [storySpec, setStorySpec] = useState<Record<string, unknown> | null>(null);
  /** True while the analyzed story is being staged onto the canvas node by
   *  node — the AI edge glow stays on and autosave/lazy-create hold off
   *  until the full result has landed. */
  const [isAiDrawing, setIsAiDrawing] = useState(false);
  const leftDockWidth = 82;

  const draft = useStoryDraft({
    projectId,
    nodes,
    edges,
    storySpec,
    isAiDrawing,
    setNodes,
    setEdges,
    setStorySpec,
    setCanvasTitle,
  });

  const generation = useStoryGeneration({
    draft,
    isAiDrawing,
    setIsAiDrawing,
    setNodes,
    setEdges,
    setStorySpec,
    setCanvasTitle,
  });

  const {
    nodesWithActions,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onSelectionChange,
    isSelectionMode,
    setIsSelectionMode,
    selectedNodeCount,
    activeStoryRoot,
    setActiveStoryRoot,
    activeCharacter,
    setActiveCharacter,
    activeEditNode,
    setActiveEditNodeId,
    addNode,
    openNodeEditor,
    updateNodeData,
    deleteNode,
  } = useCanvasInteractions({ nodes, setNodes, setEdges });

  return (
    <main className="relative h-screen overflow-hidden bg-[oklch(0.105_0_0)] text-white">
      <AiEdgeGlow
        active={generation.showAnalyzeLoading || isAiDrawing}
        label={
          // The draw wins the label: a refresh-resumed generation keeps
          // showAnalyzeLoading true until its poll fully settles, but once
          // nodes are staging in it is drawing, not thinking.
          isAiDrawing ? "StoryOS is drawing your story..." : "StoryOS is thinking..."
        }
      />
      <AiSketchGhost active={generation.showAnalyzeLoading && nodes.length === 0} />
      <div
        className="absolute inset-y-0 right-0 transition-[left] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ left: leftDockWidth }}
      >
        <ReactFlow
          nodes={nodesWithActions}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onSelectionChange={onSelectionChange}
          onNodeDoubleClick={(_event, node) => openNodeEditor(node.id)}
          nodeTypes={NODE_TYPES}
          defaultEdgeOptions={CURVED_EDGE_OPTIONS}
          connectionLineStyle={CURVED_EDGE_OPTIONS.style}
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
          minZoom={0.18}
          maxZoom={1.8}
          defaultViewport={{ x: 80, y: 390, zoom: 0.44 }}
          snapToGrid
          snapGrid={[20, 20]}
          panOnScroll
          panOnDrag={!isSelectionMode}
          selectionOnDrag={isSelectionMode}
          elementsSelectable
          nodesDraggable
          selectNodesOnDrag={false}
          zoomOnDoubleClick={false}
          className="[&_.react-flow__selection]:border-white/36! [&_.react-flow__selection]:bg-white/8! [&_.react-flow__nodesselection-rect]:stroke-white/40!"
          style={{ backgroundColor: "oklch(0.105 0 0)" }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={18}
            size={1.2}
            color="rgb(255 255 255 / 0.12)"
            bgColor="oklch(0.105 0 0)"
          />
          <MiniMap
            pannable
            zoomable
            position="bottom-left"
            className="bottom-6! left-20.5! m-0! overflow-hidden rounded-[22px] bg-[oklch(0.18_0_0)]! shadow-[0_18px_60px_rgba(0,0,0,0.4)]"
            bgColor="oklch(0.18 0 0)"
            maskColor="rgba(0,0,0,0.42)"
            maskStrokeColor="rgba(255,255,255,0.32)"
            nodeColor="rgba(255,255,255,0.46)"
            nodeStrokeWidth={0}
          />
          <Controls
            position="bottom-left"
            className="bottom-6! left-6! overflow-hidden rounded-full bg-[oklch(0.18_0_0)]! p-1! shadow-[0_18px_60px_rgba(0,0,0,0.35)] [&_button]:size-9! [&_button]:border-0! [&_button]:bg-transparent! [&_button]:text-white/70! [&_button:hover]:bg-white/10! [&_svg]:fill-white/70!"
            showInteractive={false}
          />
        </ReactFlow>
      </div>

      {draft.isCanvasLoading ? (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/10 px-5 py-3 text-sm font-semibold text-white/62 shadow-[0_18px_60px_rgba(0,0,0,0.32)] backdrop-blur-xl"
          role="status"
        >
          正在读取项目画布...
        </div>
      ) : null}

      {!draft.isCanvasLoading && draft.canvasLoadError ? (
        <div className="absolute left-1/2 top-1/2 z-20 w-105 -translate-x-1/2 -translate-y-1/2 rounded-[28px] bg-[oklch(0.18_0_0)/0.92] p-6 text-center shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
          <p className="text-sm font-semibold text-[#ff8b8e]">项目画布读取失败</p>
          <p className="mt-3 text-sm leading-6 text-white/52">{draft.canvasLoadError}</p>
        </div>
      ) : null}

      {!draft.isCanvasLoading &&
      draft.hasHydratedCanvas &&
      !draft.canvasLoadError &&
      nodes.length === 0 &&
      // From the moment Generate is pressed the intake yields to the canvas
      // (sketch ghost + edge glow) — it only returns on analyze failure.
      !generation.showAnalyzeLoading &&
      !isAiDrawing ? (
        <CanvasIntake
          prompt={generation.emptyCanvasPrompt}
          onPromptChange={generation.setEmptyCanvasPrompt}
          inputRef={generation.emptyCanvasInputRef}
          uploadRef={generation.emptyCanvasUploadRef}
          onUploadChange={generation.handleUploadChange}
          uploadName={generation.emptyCanvasUploadName}
          analyzeState={generation.emptyCanvasAnalyzeState}
          analyzeError={generation.emptyCanvasAnalyzeError}
          starters={generation.emptyCanvasStarters}
          onStarterClick={generation.applyStarterPrompt}
          onGenerate={() => void generation.createStoryRootFromEmptyState()}
          leftDockWidth={leftDockWidth}
        />
      ) : null}

      <CanvasHeader
        canvasTitle={canvasTitle}
        isCanvasLoading={draft.isCanvasLoading}
        canvasLoadError={draft.canvasLoadError}
        canvasSaveState={draft.canvasSaveState}
        canvasSaveError={draft.canvasSaveError}
        hasConflict={Boolean(draft.draftConflict)}
        hasProject={Boolean(draft.activeProjectId)}
        isSelectionMode={isSelectionMode}
        selectedNodeCount={selectedNodeCount}
        onToggleSelectionMode={() => setIsSelectionMode((current) => !current)}
        leftDockWidth={leftDockWidth}
      />

      {draft.draftConflict ? (
        <DraftConflictBanner
          conflict={draft.draftConflict}
          busy={draft.conflictBusy}
          onLoadLatest={draft.resolveConflictLoadLatest}
          onOverwrite={() => void draft.resolveConflictOverwrite()}
        />
      ) : null}

      {activeEditNode ? (
        <NodeEditorPanel
          key={activeEditNode.id}
          node={activeEditNode}
          onClose={() => setActiveEditNodeId(null)}
          onChange={(patch) => updateNodeData(activeEditNode.id, patch)}
          onDelete={() => deleteNode(activeEditNode.id)}
        />
      ) : null}

      <div
        className="absolute inset-y-0 left-0 z-30 flex overflow-hidden bg-[oklch(0.13_0_0)] shadow-[18px_0_80px_rgba(0,0,0,0.32)] transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ width: leftDockWidth }}
      >
        <aside className="flex h-full w-20.5 shrink-0 flex-col items-center justify-between bg-[oklch(0.13_0_0)] px-3 py-6">
          <button
            type="button"
            onClick={() => addNode("storyRoot")}
            className="grid size-12 place-items-center rounded-full bg-[#E52227] text-white shadow-[0_10px_30px_rgba(229,34,39,0.28)] transition hover:bg-[#ff3d42]"
            aria-label="新增节点"
            title="新增节点"
          >
            <IconPlus className="size-6" />
          </button>
        </aside>
      </div>
      {activeStoryRoot ? (
        <StoryRootViewer storyRoot={activeStoryRoot} onClose={() => setActiveStoryRoot(null)} />
      ) : null}
      {activeCharacter ? (
        <CharacterViewer character={activeCharacter} onClose={() => setActiveCharacter(null)} />
      ) : null}
    </main>
  );
}

export function StoryStudioCanvas({ projectId = null }: StoryStudioCanvasProps) {
  return (
    <ReactFlowProvider>
      <NarrativeStudioInner projectId={projectId} />
    </ReactFlowProvider>
  );
}
