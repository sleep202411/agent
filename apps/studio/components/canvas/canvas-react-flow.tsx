"use client";

import { useEffect, useMemo, useRef } from "react";
import { ReactFlow, SelectionMode, type Edge, type Node, type ReactFlowProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import {
  CANVAS_MANAGED_WHEEL_CLASS,
  CANVAS_MULTI_SELECTION_KEY,
  CANVAS_PAN_ACTIVATION_KEY,
  resolveCanvasPointerMode,
  type CanvasTool,
} from "./canvas-interaction-policy";
import { CanvasToolProvider } from "./canvas-tool-context";
import { useCanvasInteraction } from "./use-canvas-interaction";
import { useCanvasTool } from "./use-canvas-tool";

type ManagedInteractionProp =
  | "noWheelClassName"
  | "nodeClickDistance"
  | "nodeDragThreshold"
  | "multiSelectionKeyCode"
  | "paneClickDistance"
  | "panActivationKeyCode"
  | "panOnDrag"
  | "panOnScroll"
  | "panOnScrollMode"
  | "panOnScrollSpeed"
  | "preventScrolling"
  | "selectionKeyCode"
  | "selectionMode"
  | "selectionOnDrag"
  | "zoomActivationKeyCode"
  | "zoomOnPinch"
  | "zoomOnScroll";

export type CanvasReactFlowProps<NodeType extends Node = Node, EdgeType extends Edge = Edge> = Omit<
  ReactFlowProps<NodeType, EdgeType>,
  ManagedInteractionProp | "minZoom" | "maxZoom"
> & {
  defaultTool?: CanvasTool;
  minZoom: number;
  maxZoom: number;
  onInteractionStart?: () => void;
};

/**
 * Product-level React Flow boundary. It owns the canvas gesture contract:
 * Select is the default tool, Shift-click toggles nodes, native controls keep
 * ordinary primary input, Space/middle-drag always pan, and wheel input is
 * routed exactly once.
 */
export function CanvasReactFlow<NodeType extends Node = Node, EdgeType extends Edge = Edge>({
  className,
  defaultTool = "select",
  minZoom,
  maxZoom,
  onInteractionStart,
  ...props
}: CanvasReactFlowProps<NodeType, EdgeType>) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const { activeTool, setActiveTool } = useCanvasTool(surfaceRef, defaultTool);
  const pointerMode = resolveCanvasPointerMode(activeTool);
  const toolContext = useMemo(() => ({ activeTool, setActiveTool }), [activeTool, setActiveTool]);
  const previousToolRef = useRef(activeTool);
  useCanvasInteraction({
    surfaceRef,
    minZoom,
    maxZoom,
    primaryPanActive: activeTool === "pan",
    onInteractionStart,
  });

  useEffect(() => {
    if (previousToolRef.current !== activeTool) onInteractionStart?.();
    previousToolRef.current = activeTool;
  }, [activeTool, onInteractionStart]);

  return (
    <CanvasToolProvider value={toolContext}>
      <ReactFlow<NodeType, EdgeType>
        ref={surfaceRef}
        {...props}
        className={cn(CANVAS_MANAGED_WHEEL_CLASS, className)}
        data-canvas-tool={activeTool}
        minZoom={minZoom}
        maxZoom={maxZoom}
        noWheelClassName={CANVAS_MANAGED_WHEEL_CLASS}
        nodeClickDistance={4}
        nodeDragThreshold={3}
        multiSelectionKeyCode={CANVAS_MULTI_SELECTION_KEY}
        paneClickDistance={4}
        panActivationKeyCode={CANVAS_PAN_ACTIVATION_KEY}
        panOnDrag={pointerMode.panOnDrag}
        panOnScroll={false}
        preventScrolling={false}
        selectionKeyCode={null}
        selectionMode={SelectionMode.Partial}
        selectionOnDrag={pointerMode.selectionOnDrag}
        zoomActivationKeyCode={null}
        zoomOnPinch
        zoomOnScroll={false}
      />
    </CanvasToolProvider>
  );
}
