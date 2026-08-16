"use client";

import { useEffect, useMemo, useRef } from "react";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { Group, Layer, Rect, Stage, Text, Transformer } from "react-konva";
import type { NormalizedHotspotRect, StoryInteractionDraft } from "./story-interaction-types";

type EditorMode = "edit" | "preview";
type EditorTool = "select" | "rectangle";

interface StoryHotspotStageProps {
  width: number;
  height: number;
  drafts: StoryInteractionDraft[];
  selectedId: string | null;
  currentTime: number;
  mode: EditorMode;
  tool: EditorTool;
  minimumSize: number;
  onCreate: (rect: NormalizedHotspotRect) => string;
  onRectChange: (id: string, rect: NormalizedHotspotRect) => void;
  onSelect: (id: string | null) => void;
  onPreview: (draft: StoryInteractionDraft) => void;
  onDrawComplete: () => void;
}

type DrawOperation = {
  pointerId: number;
  hotspotId: string;
  origin: { x: number; y: number };
};

const BRAND_BLUE = "#4D8DFF";
const CORNER_ANCHORS = ["top-left", "top-right", "bottom-left", "bottom-right"];

export function StoryHotspotStage({
  width,
  height,
  drafts,
  selectedId,
  currentTime,
  mode,
  tool,
  minimumSize,
  onCreate,
  onRectChange,
  onSelect,
  onPreview,
  onDrawComplete,
}: StoryHotspotStageProps) {
  const drawOperationRef = useRef<DrawOperation | null>(null);
  const cursor = mode === "edit" && tool === "rectangle" ? "crosshair" : "default";

  const stagePoint = (stage: Konva.Stage): { x: number; y: number } | null => {
    const position = stage.getPointerPosition();
    if (!position || width <= 0 || height <= 0) return null;
    return {
      x: clamp(position.x / width, 0, 1),
      y: clamp(position.y / height, 0, 1),
    };
  };

  const beginPointerOperation = (event: KonvaEventObject<PointerEvent>) => {
    const stage = event.target.getStage();
    if (!stage || event.target !== stage) return;

    if (mode === "edit" && tool === "select") {
      onSelect(null);
      return;
    }
    if (mode !== "edit" || tool !== "rectangle" || event.evt.button !== 0) return;

    const point = stagePoint(stage);
    if (!point) return;
    event.evt.preventDefault();
    const pointerId = event.evt.pointerId;
    stage.container().setPointerCapture?.(pointerId);
    const hotspotId = onCreate({
      x: point.x,
      y: point.y,
      width: minimumSize,
      height: minimumSize,
    });
    drawOperationRef.current = { pointerId, hotspotId, origin: point };
  };

  const updatePointerOperation = (event: KonvaEventObject<PointerEvent>) => {
    const operation = drawOperationRef.current;
    if (!operation || operation.pointerId !== event.evt.pointerId) return;
    const stage = event.target.getStage();
    if (!stage) return;
    const point = stagePoint(stage);
    if (!point) return;
    const x = Math.min(operation.origin.x, point.x);
    const y = Math.min(operation.origin.y, point.y);
    onRectChange(operation.hotspotId, {
      x: clamp(x, 0, 1 - minimumSize),
      y: clamp(y, 0, 1 - minimumSize),
      width: Math.min(Math.max(minimumSize, Math.abs(point.x - operation.origin.x)), 1 - x),
      height: Math.min(Math.max(minimumSize, Math.abs(point.y - operation.origin.y)), 1 - y),
    });
  };

  const endPointerOperation = (event: KonvaEventObject<PointerEvent>) => {
    const operation = drawOperationRef.current;
    if (!operation || operation.pointerId !== event.evt.pointerId) return;
    drawOperationRef.current = null;
    const stage = event.target.getStage();
    if (stage?.container().hasPointerCapture?.(operation.pointerId)) {
      stage.container().releasePointerCapture(operation.pointerId);
    }
    onDrawComplete();
  };

  if (width <= 0 || height <= 0) return null;

  return (
    <div className="absolute inset-0" data-hotspot-canvas="" style={{ cursor }} aria-hidden="true">
      <Stage
        width={width}
        height={height}
        onPointerDown={beginPointerOperation}
        onPointerMove={updatePointerOperation}
        onPointerUp={endPointerOperation}
        onPointerCancel={endPointerOperation}
      >
        <Layer>
          {drafts.map((draft, index) => (
            <HotspotShape
              key={draft.id}
              draft={draft}
              index={index}
              stageWidth={width}
              stageHeight={height}
              minimumSize={minimumSize}
              selected={mode === "edit" && draft.id === selectedId}
              active={currentTime >= draft.startSeconds && currentTime <= draft.endSeconds}
              mode={mode}
              tool={tool}
              onSelect={() => onSelect(draft.id)}
              onPreview={() => onPreview(draft)}
              onRectChange={(rect) => onRectChange(draft.id, rect)}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
}

interface HotspotShapeProps {
  draft: StoryInteractionDraft;
  index: number;
  stageWidth: number;
  stageHeight: number;
  minimumSize: number;
  selected: boolean;
  active: boolean;
  mode: EditorMode;
  tool: EditorTool;
  onSelect: () => void;
  onPreview: () => void;
  onRectChange: (rect: NormalizedHotspotRect) => void;
}

function HotspotShape({
  draft,
  index,
  stageWidth,
  stageHeight,
  minimumSize,
  selected,
  active,
  mode,
  tool,
  onSelect,
  onPreview,
  onRectChange,
}: HotspotShapeProps) {
  const shapeRef = useRef<Konva.Rect | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const stageRect = useMemo(
    () => ({
      x: draft.rect.x * stageWidth,
      y: draft.rect.y * stageHeight,
      width: draft.rect.width * stageWidth,
      height: draft.rect.height * stageHeight,
    }),
    [draft.rect.height, draft.rect.width, draft.rect.x, draft.rect.y, stageHeight, stageWidth]
  );

  useEffect(() => {
    const transformer = transformerRef.current;
    const shape = shapeRef.current;
    if (!transformer) return;
    transformer.nodes(selected && shape ? [shape] : []);
    transformer.getLayer()?.batchDraw();
  }, [selected]);

  const setStageCursor = (cursor: string) => {
    const stage = shapeRef.current?.getStage();
    if (stage) stage.container().style.cursor = cursor;
  };

  const commitNodeRect = (node: Konva.Rect) => {
    const nextRect = normalizeStageRect(
      {
        x: node.x(),
        y: node.y(),
        width: node.width() * node.scaleX(),
        height: node.height() * node.scaleY(),
      },
      stageWidth,
      stageHeight,
      minimumSize
    );
    node.scale({ x: 1, y: 1 });
    node.position({ x: nextRect.x * stageWidth, y: nextRect.y * stageHeight });
    node.size({ width: nextRect.width * stageWidth, height: nextRect.height * stageHeight });
    onRectChange(nextRect);
  };

  const labelWidth = Math.min(184, Math.max(76, 42 + Math.min(draft.label.length, 18) * 7));
  const canEdit = mode === "edit" && tool === "select";

  return (
    <Group opacity={mode === "edit" && !active ? 0.45 : 1}>
      <Rect
        ref={shapeRef}
        x={stageRect.x}
        y={stageRect.y}
        width={stageRect.width}
        height={stageRect.height}
        fill={selected ? "rgba(77, 141, 255, 0.12)" : "rgba(0, 0, 0, 0.15)"}
        stroke={selected ? BRAND_BLUE : "rgba(255, 255, 255, 0.58)"}
        strokeWidth={1}
        strokeScaleEnabled={false}
        shadowColor={selected ? BRAND_BLUE : "black"}
        shadowOpacity={selected ? 0.26 : 0}
        shadowBlur={selected ? 12 : 0}
        draggable={canEdit}
        dragBoundFunc={(position) => ({
          x: clamp(position.x, 0, stageWidth - stageRect.width),
          y: clamp(position.y, 0, stageHeight - stageRect.height),
        })}
        onPointerDown={(event) => {
          event.cancelBubble = true;
          onSelect();
        }}
        onClick={(event) => {
          event.cancelBubble = true;
          if (mode === "preview") onPreview();
        }}
        onTap={(event) => {
          event.cancelBubble = true;
          if (mode === "preview") onPreview();
          else onSelect();
        }}
        onDragMove={(event) => {
          const node = event.target;
          onRectChange({
            ...draft.rect,
            x: clamp(node.x() / stageWidth, 0, 1 - draft.rect.width),
            y: clamp(node.y() / stageHeight, 0, 1 - draft.rect.height),
          });
        }}
        onTransformEnd={() => {
          const node = shapeRef.current;
          if (node) commitNodeRect(node);
        }}
        onMouseEnter={() =>
          setStageCursor(mode === "preview" ? "pointer" : canEdit ? "move" : "default")
        }
        onMouseLeave={() =>
          setStageCursor(mode === "edit" && tool === "rectangle" ? "crosshair" : "default")
        }
      />

      <Group
        x={stageRect.x + 7}
        y={stageRect.y + 7}
        width={labelWidth}
        height={28}
        listening={false}
      >
        <Rect
          width={labelWidth}
          height={28}
          cornerRadius={7}
          fill={selected ? BRAND_BLUE : "rgba(0, 0, 0, 0.76)"}
          shadowColor="black"
          shadowOpacity={0.28}
          shadowBlur={12}
          shadowOffsetY={4}
        />
        <Rect x={5} y={4} width={20} height={20} cornerRadius={4} fill="rgba(255,255,255,0.14)" />
        <Text
          x={5}
          y={7}
          width={20}
          align="center"
          text={String(index + 1)}
          fontSize={12}
          fontStyle="bold"
          fill="white"
        />
        <Text
          x={31}
          y={7}
          width={labelWidth - 37}
          text={draft.label}
          fontSize={12}
          fontStyle="bold"
          fill="white"
          ellipsis
          wrap="none"
        />
      </Group>

      {selected ? (
        <Transformer
          ref={transformerRef}
          rotateEnabled={false}
          enabledAnchors={CORNER_ANCHORS}
          keepRatio={false}
          flipEnabled={false}
          borderStroke={BRAND_BLUE}
          borderStrokeWidth={1}
          anchorFill="white"
          anchorStroke={BRAND_BLUE}
          anchorStrokeWidth={1}
          anchorSize={10}
          anchorCornerRadius={3}
          boundBoxFunc={(oldBox, newBox) => {
            const minimumWidth = stageWidth * minimumSize;
            const minimumHeight = stageHeight * minimumSize;
            const outsideStage =
              newBox.x < 0 ||
              newBox.y < 0 ||
              newBox.x + newBox.width > stageWidth ||
              newBox.y + newBox.height > stageHeight;
            if (
              Math.abs(newBox.width) < minimumWidth ||
              Math.abs(newBox.height) < minimumHeight ||
              outsideStage
            ) {
              return oldBox;
            }
            return newBox;
          }}
        />
      ) : null}
    </Group>
  );
}

export function normalizeStageRect(
  rect: { x: number; y: number; width: number; height: number },
  stageWidth: number,
  stageHeight: number,
  minimumSize: number
): NormalizedHotspotRect {
  const safeStageWidth = Math.max(1, stageWidth);
  const safeStageHeight = Math.max(1, stageHeight);
  const width = clamp(Math.abs(rect.width) / safeStageWidth, minimumSize, 1);
  const height = clamp(Math.abs(rect.height) / safeStageHeight, minimumSize, 1);
  return {
    x: clamp(rect.x / safeStageWidth, 0, 1 - width),
    y: clamp(rect.y / safeStageHeight, 0, 1 - height),
    width,
    height,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}
