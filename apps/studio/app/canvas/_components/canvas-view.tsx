"use client";

import { useCallback, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ImageNode, type ImageNodeType } from "./image-node";
import { PromptBar } from "./prompt-bar";

const nodeTypes = { image: ImageNode };

// Zoom/pan tuning proven in apps/web's storyboard canvas.
const MIN_ZOOM = 0.16;
const MAX_ZOOM = 2.4;

function CanvasInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<ImageNodeType>([]);
  const { screenToFlowPosition } = useReactFlow();
  const nextIdRef = useRef(0);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  // Dropping local image files places them on the canvas as nodes.
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/")
      );
      if (files.length === 0) return;

      const base = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setNodes((prev) => [
        ...prev,
        ...files.map((file, index) => ({
          id: `image-${++nextIdRef.current}`,
          type: "image" as const,
          position: { x: base.x + index * 32, y: base.y + index * 32 },
          data: { src: URL.createObjectURL(file), label: file.name },
        })),
      ]);
    },
    [screenToFlowPosition, setNodes]
  );

  return (
    <div className="relative h-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        colorMode="dark"
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        deleteKeyCode={["Backspace", "Delete"]}
        fitView
        className="!bg-background"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.5}
          color="rgb(255 255 255 / 0.07)"
        />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">
            Drop images anywhere, or describe what to create below
          </p>
        </div>
      )}

      <PromptBar />
    </div>
  );
}

export function CanvasView() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
