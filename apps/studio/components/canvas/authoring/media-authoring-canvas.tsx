"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { MiniMap, type FitViewOptions, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type Icon } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import {
  AddNodeMenu,
  DEFAULT_ADD_NODE_ACTIONS,
  type AddNodeAction,
} from "@/components/canvas/add-node-menu";
import {
  CanvasAuthoringControls,
  CanvasAuthoringDock,
} from "@/components/canvas/canvas-authoring-chrome";
import { DRAWER_INSET } from "@/components/ui/drawer-panel";
import { CanvasHistoryControls } from "@/components/canvas/canvas-history-controls";
import { CANVAS_DELETE_KEY_CODES } from "@/components/canvas/canvas-interaction-policy";
import { CanvasReactFlow } from "@/components/canvas/canvas-react-flow";
import { CanvasBackdrop } from "@/components/canvas/canvas-backdrop";

import { CanvasConnectionLine } from "@/components/canvas/authoring/connection-line";
import { GradientEdge } from "@/components/canvas/authoring/gradient-edge";
import { ImageNode } from "@/components/canvas/authoring/image-node";
import { AudioAssetNode, VideoAssetNode } from "@/components/canvas/authoring/media-node";
import { NoteNode } from "@/components/canvas/authoring/note-node";
import { PanoramaNode } from "@/components/canvas/authoring/panorama-node";
import { ShotNode } from "@/components/canvas/authoring/shot-node";
import { AudioNode, PromptNode, VideoNode } from "@/components/canvas/authoring/generation-card";
import { CanvasDocumentProvider } from "@/components/canvas/authoring/canvas-document-context";
import { UploadStateContext } from "@/components/canvas/authoring/upload-state-context";
import {
  useMediaAuthoringCanvas,
  type UploadMediaKind,
} from "@/components/canvas/authoring/use-media-authoring-canvas";
import {
  CanvasGroupingActionsProvider,
  useCanvasGrouping,
  type CanvasGroupingController,
} from "@/components/canvas/groups/canvas-grouping";
import type { CanvasGroup } from "@/lib/canvas-core/types";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import { cn } from "@/lib/utils";

const MIN_ZOOM = 0.16;
const MAX_ZOOM = 2.4;
const GRID_SIZE = 24;

// Node type strings live in the CRDT forever — add, never rename.
const NODE_TYPES = {
  image: ImageNode,
  panorama: PanoramaNode,
  note: NoteNode,
  videoAsset: VideoAssetNode,
  audioAsset: AudioAssetNode,
  prompt: PromptNode,
  video: VideoNode,
  audio: AudioNode,
  shot: ShotNode,
};
const EDGE_TYPES = { gradient: GradientEdge };

export interface MediaAuthoringCanvasDrawer {
  label: string;
  Icon: Icon;
  render: (close: () => void) => ReactNode;
}

export interface MediaAuthoringCanvasStatusContext {
  groupDropTarget: CanvasGroup | null;
}

export interface MediaAuthoringCanvasProps {
  canEdit: boolean;
  ready: boolean;
  workspaceId?: string;
  /** Studio document this canvas persists into; media URLs carry it so the
   *  server grants read to everyone who can read the document. */
  documentId?: string | null;
  scopeKey?: string | null;
  uploadKinds: readonly UploadMediaKind[];
  /**
   * Creation actions this canvas offers, in display order (dock, add-menu and
   * their shortcuts). Products opt into node types they have a home for — a
   * shot only makes sense where a storyboard mode can project it.
   */
  addNodeActions?: readonly AddNodeAction[];
  /** Node to select and frame on open, instead of fitting the whole canvas. */
  initialFocusNodeId?: string | null;
  fitEmptyCanvas?: boolean;
  tidySelection?: boolean;
  grouping?: CanvasGroupingController;
  secondaryDrawer?: MediaAuthoringCanvasDrawer;
  onDrawerInsetChange?: (inset: number) => void;
  backdrop?: ReactNode;
  renderViewportLayers?: (nodes: Node[]) => ReactNode;
  topChrome?: ReactNode;
  panels?: ReactNode;
  toolbarActions?: ReactNode;
  statusOverlay?: ReactNode | ((interaction: MediaAuthoringCanvasStatusContext) => ReactNode);
  loadingOverlay?: ReactNode;
  renderErrorOverlay?: (nodes: Node[]) => ReactNode;
  renderEmptyState?: (actions: { openAddMenu: () => void }) => ReactNode;
  onCanvasPointerMove?: (position: { x: number; y: number }) => void;
  onCanvasPointerLeave?: () => void;
  className?: string;
}

/**
 * The single product-neutral media-authoring surface used by Creative Studio
 * and Story Studio. Product shells provide graph persistence, generation
 * context, collaboration layers and optional business actions; this component
 * owns the complete canvas interaction and chrome contract.
 */
export function MediaAuthoringCanvas({
  canEdit,
  ready,
  workspaceId,
  documentId = null,
  scopeKey,
  uploadKinds,
  addNodeActions = DEFAULT_ADD_NODE_ACTIONS,
  initialFocusNodeId,
  fitEmptyCanvas = false,
  tidySelection = false,
  grouping,
  secondaryDrawer,
  onDrawerInsetChange,
  backdrop,
  renderViewportLayers,
  topChrome,
  panels,
  toolbarActions,
  statusOverlay,
  loadingOverlay,
  renderErrorOverlay,
  renderEmptyState,
  onCanvasPointerMove,
  onCanvasPointerLeave,
  className,
}: MediaAuthoringCanvasProps) {
  const t = useTranslations("canvas");
  const graph = useCanvasGraphContext();
  const {
    nodes,
    edges,
    onNodesChange,
    onNodesDelete,
    onEdgesChange,
    onEdgesDelete,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onReconnectStart,
    onReconnect,
    onReconnectEnd,
    isValidConnection,
    addMenu,
    setAddMenu,
    menuDisabledActions,
    addNodeOfType,
    addNodeFromDock,
    assetsOpen,
    setAssetsOpen,
    snapToGrid,
    setSnapToGrid,
    minimapOpen,
    setMinimapOpen,
    containerRef,
    fileInputRef,
    screenToFlowPosition,
    acceptedFileTypes,
    uploadContextValue,
    fileDragActive,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onPickFiles,
    onDoubleClick,
    openAddMenuAtCenter,
    tidyCanvas,
    canUndo,
    canRedo,
    undo,
    redo,
    lastConnectEndAt,
  } = useMediaAuthoringCanvas({
    graph,
    canEdit,
    ready,
    workspaceId,
    scopeKey,
    uploadKinds,
    addNodeActions,
    initialFocusNodeId,
    fitEmptyCanvas,
    tidySelection,
  });
  const [secondaryDrawerOpenState, setSecondaryDrawerOpen] = useState(false);
  const secondaryDrawerOpen = Boolean(secondaryDrawer) && secondaryDrawerOpenState;
  // Asset library is now shell-owned (flex push), so only secondaryDrawer
  // contributes to the canvas's internal drawer inset.
  const drawerInset = secondaryDrawerOpen ? DRAWER_INSET : 0;
  const railVisible = Boolean(secondaryDrawer) || !assetsOpen;
  const fitViewPadding = useMemo<FitViewOptions["padding"]>(
    () =>
      drawerInset
        ? {
            top: "64px",
            right: "48px",
            bottom: "88px",
            left: `${drawerInset + 32}px`,
          }
        : 0.3,
    [drawerInset]
  );
  const groupingState = useCanvasGrouping({
    controller: grouping,
    nodes,
    canEdit,
    onNodesChange,
    selectNodes: graph.selectNodes,
  });
  const resolvedStatusOverlay =
    typeof statusOverlay === "function"
      ? statusOverlay({ groupDropTarget: groupingState.dropTargetGroup })
      : statusOverlay;
  const pendingWireGradientId = `canvas-pending-wire-${useId().replaceAll(":", "")}`;
  const resolvedBackdrop = backdrop === undefined ? <CanvasBackdrop /> : backdrop;

  useEffect(() => {
    onDrawerInsetChange?.(drawerInset);
  }, [drawerInset, onDrawerInsetChange]);

  useEffect(
    () => () => {
      onDrawerInsetChange?.(0);
    },
    [onDrawerInsetChange]
  );

  return (
    <CanvasDocumentProvider value={documentId}>
      <CanvasGroupingActionsProvider controller={grouping} canEdit={canEdit}>
        <UploadStateContext.Provider value={uploadContextValue}>
          <div
            ref={containerRef}
            className={cn(
              "relative h-full",
              groupingState.hoveredGroupId && "cursor-grab",
              groupingState.draggingGroupId && "cursor-grabbing",
              className
            )}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onDoubleClick={onDoubleClick}
            onPointerDownCapture={groupingState.containerHandlers.onPointerDownCapture}
            onPointerMoveCapture={groupingState.containerHandlers.onPointerMoveCapture}
            onPointerUpCapture={groupingState.containerHandlers.onPointerUpCapture}
            onPointerCancelCapture={groupingState.containerHandlers.onPointerCancelCapture}
            onLostPointerCapture={groupingState.containerHandlers.onLostPointerCapture}
            onPointerMove={(event) => {
              if (!onCanvasPointerMove) return;
              onCanvasPointerMove(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
            }}
            onPointerLeave={() => {
              groupingState.containerHandlers.onPointerLeave();
              onCanvasPointerLeave?.();
            }}
          >
            {resolvedBackdrop}
            <CanvasReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onNodesDelete={onNodesDelete}
              onEdgesChange={onEdgesChange}
              onEdgesDelete={onEdgesDelete}
              onConnect={onConnect}
              onConnectStart={onConnectStart}
              onConnectEnd={onConnectEnd}
              onNodeDragStart={groupingState.nodeHandlers.onNodeDragStart}
              onNodeDrag={groupingState.nodeHandlers.onNodeDrag}
              onNodeDragStop={groupingState.nodeHandlers.onNodeDragStop}
              nodesDraggable={canEdit}
              nodesConnectable={canEdit}
              edgesReconnectable={canEdit}
              onReconnectStart={onReconnectStart}
              onReconnect={onReconnect}
              onReconnectEnd={onReconnectEnd}
              isValidConnection={isValidConnection}
              connectionRadius={38}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              connectionLineComponent={CanvasConnectionLine}
              colorMode="dark"
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              snapToGrid={snapToGrid}
              snapGrid={[GRID_SIZE, GRID_SIZE]}
              zoomOnDoubleClick={false}
              deleteKeyCode={canEdit ? CANVAS_DELETE_KEY_CODES : null}
              proOptions={{ hideAttribution: true }}
              onPaneClick={() => {
                if (Date.now() - lastConnectEndAt.current < 250) return;
                setAddMenu(null);
              }}
              onMoveStart={() => setAddMenu(null)}
              className={cn(
                groupingState.hoveredGroupId && "[&_.react-flow__pane]:cursor-grab",
                groupingState.draggingGroupId && "[&_.react-flow__pane]:!cursor-grabbing"
              )}
              style={{ backgroundColor: "transparent" }}
            >
              {groupingState.viewportLayer}
              {renderViewportLayers?.(nodes)}
              {minimapOpen ? (
                <MiniMap
                  pannable
                  position="bottom-right"
                  className="canvas-wheel-zoom !right-4 !bottom-[68px] !m-0 overflow-hidden rounded-xl shadow-md"
                  bgColor="rgb(17 17 17)"
                  maskColor="rgba(0,0,0,0.35)"
                  maskStrokeColor="rgba(255,255,255,0.35)"
                  maskStrokeWidth={2}
                  nodeColor="rgba(255,255,255,0.5)"
                  nodeStrokeWidth={0}
                />
              ) : null}
              <CanvasAuthoringControls
                onTidy={() => tidyCanvas(fitViewPadding)}
                snapToGrid={snapToGrid}
                onToggleSnap={() => setSnapToGrid((value) => !value)}
                minimapOpen={minimapOpen}
                onToggleMinimap={() => setMinimapOpen((value) => !value)}
                leftInset={drawerInset}
                fitViewPadding={fitViewPadding}
              />
            </CanvasReactFlow>

            {groupingState.dropTargetGroup ? null : groupingState.toolbar}
            {resolvedStatusOverlay ? (
              <div
                className={
                  groupingState.action && !groupingState.dropTargetGroup ? "hidden" : "contents"
                }
              >
                {resolvedStatusOverlay}
              </div>
            ) : null}
            {topChrome}

            {railVisible && secondaryDrawer ? (
              <div className="absolute top-1/2 left-4 z-[80] flex -translate-y-1/2 flex-col gap-1 rounded-2xl bg-popover/90 p-1.5 shadow-md backdrop-blur-xl">
                <button
                  type="button"
                  aria-pressed={secondaryDrawerOpen}
                  onClick={() => {
                    setAssetsOpen(false);
                    setSecondaryDrawerOpen((open) => !open);
                  }}
                  aria-label={secondaryDrawer.label}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
                    secondaryDrawerOpen && "bg-white/[0.12] text-white"
                  )}
                >
                  <secondaryDrawer.Icon className="size-5" stroke={1.7} />
                </button>
              </div>
            ) : null}

            {secondaryDrawerOpen
              ? secondaryDrawer?.render(() => setSecondaryDrawerOpen(false))
              : null}

            <input
              ref={fileInputRef}
              type="file"
              accept={acceptedFileTypes}
              multiple
              hidden
              onChange={onPickFiles}
            />

            {canEdit || toolbarActions ? (
              <CanvasAuthoringDock
                actions={canEdit ? addNodeActions : []}
                onAdd={addNodeFromDock}
                toolbarActions={toolbarActions}
              />
            ) : null}
            {canEdit ? (
              <CanvasHistoryControls
                canUndo={canUndo}
                canRedo={canRedo}
                undo={undo}
                redo={redo}
                undoLabel={t("undo")}
                redoLabel={t("redo")}
                className="absolute bottom-4 z-20"
                style={{
                  right: "calc(var(--project-canvas-right-overlay-inset, 0px) + 1rem)",
                }}
              />
            ) : null}

            {panels}

            {addMenu?.wire ? (
              <svg className="pointer-events-none absolute inset-0 z-20 size-full overflow-visible">
                <defs>
                  <linearGradient
                    id={pendingWireGradientId}
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
                  stroke={`url(#${pendingWireGradientId})`}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </svg>
            ) : null}
            {addMenu ? (
              <AddNodeMenu
                left={addMenu.left}
                top={addMenu.top}
                actions={addNodeActions}
                disabledActions={menuDisabledActions}
                onAction={(action) => {
                  if (!addMenu) return;
                  addNodeOfType(action, addMenu.flow, addMenu.pending);
                  setAddMenu(null);
                }}
              />
            ) : null}

            {nodes.length === 0 && !addMenu
              ? renderEmptyState?.({ openAddMenu: openAddMenuAtCenter })
              : null}
            {fileDragActive ? (
              <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-black/45">
                <p className="rounded-2xl bg-popover/95 px-4 py-2 text-sm text-white shadow-md">
                  {t("dropToAdd")}
                </p>
              </div>
            ) : null}
            {loadingOverlay}
            {renderErrorOverlay?.(nodes)}
          </div>
        </UploadStateContext.Provider>
      </CanvasGroupingActionsProvider>
    </CanvasDocumentProvider>
  );
}
