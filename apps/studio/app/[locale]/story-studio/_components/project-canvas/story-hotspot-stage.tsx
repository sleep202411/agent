"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import Konva from "konva";
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
  origin: { x: number; y: number };
};

const LABEL_FONT_SIZE = 12;
const LABEL_TEXT_X = 31;
const LABEL_PAD_RIGHT = 10;

/** Pill width for the index badge plus the full name, limited to the hotspot box. */
export function hotspotLabelWidth(textWidth: number, hotspotWidth: number): number {
  const contentWidth = LABEL_TEXT_X + Math.ceil(textWidth) + LABEL_PAD_RIGHT;
  const maxWidth = Math.max(LABEL_TEXT_X + LABEL_PAD_RIGHT, hotspotWidth - 14);
  return Math.min(contentWidth, maxWidth);
}

function measureHotspotLabel(label: string): number {
  const probe = new Konva.Text({
    text: label,
    fontSize: LABEL_FONT_SIZE,
    fontStyle: "bold",
  });
  const width = probe.getTextWidth();
  probe.destroy();
  return width;
}
const BRAND_BLUE = "#4D8DFF";
const CORNER_ANCHORS = ["top-left", "top-right", "bottom-left", "bottom-right"];

export function StoryHotspotStage({
  width,
  height,
  drafts,
  selectedId,
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
  const previewRef = useRef<Konva.Rect | null>(null);
  const cursor = mode === "edit" && tool === "rectangle" ? "crosshair" : "default";

  const paintPreview = (rect: NormalizedHotspotRect | null) => {
    const node = previewRef.current;
    if (!node) return;
    if (!rect) {
      node.visible(false);
    } else {
      node.visible(true);
      node.position({ x: rect.x * width, y: rect.y * height });
      node.size({ width: rect.width * width, height: rect.height * height });
    }
    node.getLayer()?.batchDraw();
  };

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
    drawOperationRef.current = { pointerId, origin: point };
    paintPreview(rectFromPointer(point, point, minimumSize));
  };

  const updatePointerOperation = (event: KonvaEventObject<PointerEvent>) => {
    const operation = drawOperationRef.current;
    if (!operation || operation.pointerId !== event.evt.pointerId) return;
    const stage = event.target.getStage();
    if (!stage) return;
    const point = stagePoint(stage);
    if (!point) return;
    paintPreview(rectFromPointer(operation.origin, point, minimumSize));
  };

  const endPointerOperation = (event: KonvaEventObject<PointerEvent>) => {
    const operation = drawOperationRef.current;
    if (!operation || operation.pointerId !== event.evt.pointerId) return;
    drawOperationRef.current = null;
    const stage = event.target.getStage();
    const point = stage ? stagePoint(stage) : null;
    if (stage?.container().hasPointerCapture?.(operation.pointerId)) {
      stage.container().releasePointerCapture(operation.pointerId);
    }
    paintPreview(null);
    onCreate(rectFromPointer(operation.origin, point ?? operation.origin, minimumSize));
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
              mode={mode}
              tool={tool}
              onSelect={() => onSelect(draft.id)}
              onPreview={() => onPreview(draft)}
              onRectChange={(rect) => onRectChange(draft.id, rect)}
            />
          ))}
          <Rect
            ref={previewRef}
            visible={false}
            listening={false}
            perfectDrawEnabled={false}
            fill="rgba(77, 141, 255, 0.12)"
            stroke={BRAND_BLUE}
            strokeWidth={1}
          />
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
  mode: EditorMode;
  tool: EditorTool;
  onSelect: () => void;
  onPreview: () => void;
  onRectChange: (rect: NormalizedHotspotRect) => void;
}

const HotspotShape = memo(function HotspotShape({
  draft,
  index,
  stageWidth,
  stageHeight,
  minimumSize,
  selected,
  mode,
  tool,
  onSelect,
  onPreview,
  onRectChange,
}: HotspotShapeProps) {
  const shapeRef = useRef<Konva.Rect | null>(null);
  const labelRef = useRef<Konva.Group | null>(null);
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
    const origin = node.getAbsolutePosition();
    const nextRect = normalizeStageRect(
      {
        x: origin.x,
        y: origin.y,
        width: node.width() * node.scaleX(),
        height: node.height() * node.scaleY(),
      },
      stageWidth,
      stageHeight,
      minimumSize
    );
    const group = node.getParent();
    node.scale({ x: 1, y: 1 });
    node.position({ x: 0, y: 0 });
    node.size({ width: nextRect.width * stageWidth, height: nextRect.height * stageHeight });
    group?.position({ x: nextRect.x * stageWidth, y: nextRect.y * stageHeight });
    labelRef.current?.position({ x: 7, y: 7 });
    onRectChange(nextRect);
  };

  const labelWidth = hotspotLabelWidth(measureHotspotLabel(draft.label), stageRect.width);
  const canEdit = mode === "edit" && tool === "select";

  return (
    <Group>
      <Group
        x={stageRect.x}
        y={stageRect.y}
        draggable={canEdit}
        transformsEnabled="position"
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
        onDragEnd={(event) => {
          onRectChange({
            ...draft.rect,
            x: clamp(event.target.x() / stageWidth, 0, 1 - draft.rect.width),
            y: clamp(event.target.y() / stageHeight, 0, 1 - draft.rect.height),
          });
        }}
        onMouseEnter={() =>
          setStageCursor(mode === "preview" ? "pointer" : canEdit ? "move" : "default")
        }
        onMouseLeave={() =>
          setStageCursor(mode === "edit" && tool === "rectangle" ? "crosshair" : "default")
        }
      >
        <Rect
          ref={shapeRef}
          width={stageRect.width}
          height={stageRect.height}
          fill={selected ? "rgba(77, 141, 255, 0.12)" : "rgba(0, 0, 0, 0.15)"}
          stroke={selected ? BRAND_BLUE : "rgba(255, 255, 255, 0.58)"}
          strokeWidth={1}
          strokeScaleEnabled={false}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
          shadowColor={selected ? BRAND_BLUE : "black"}
          shadowOpacity={selected ? 0.26 : 0}
          shadowBlur={selected ? 12 : 0}
          onTransform={() => {
            const node = shapeRef.current;
            if (!node) return;
            labelRef.current?.position({ x: node.x() + 7, y: node.y() + 7 });
          }}
          onTransformEnd={() => {
            const node = shapeRef.current;
            if (node) commitNodeRect(node);
          }}
        />

        <Group ref={labelRef} x={7} y={7} width={labelWidth} height={28} listening={false}>
          <Rect
            width={labelWidth}
            height={28}
            cornerRadius={7}
            fill={selected ? BRAND_BLUE : "rgba(0, 0, 0, 0.76)"}
            perfectDrawEnabled={false}
            shadowForStrokeEnabled={false}
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
            listening={false}
          />
          <Text
            x={LABEL_TEXT_X}
            y={7}
            width={Math.max(0, labelWidth - LABEL_TEXT_X - LABEL_PAD_RIGHT)}
            text={draft.label}
            fontSize={LABEL_FONT_SIZE}
            fontStyle="bold"
            fill="white"
            ellipsis
            wrap="none"
            listening={false}
          />
        </Group>
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
});

export function rectFromPointer(
  origin: { x: number; y: number },
  point: { x: number; y: number },
  minimumSize: number
): NormalizedHotspotRect {
  const x = Math.min(origin.x, point.x);
  const y = Math.min(origin.y, point.y);
  const clampedX = clamp(x, 0, 1 - minimumSize);
  const clampedY = clamp(y, 0, 1 - minimumSize);
  return {
    x: clampedX,
    y: clampedY,
    width: Math.min(Math.max(minimumSize, Math.abs(point.x - origin.x)), 1 - clampedX),
    height: Math.min(Math.max(minimumSize, Math.abs(point.y - origin.y)), 1 - clampedY),
  };
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
