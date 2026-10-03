"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  getStraightPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
  type OnNodeDrag,
  type Position,
  type Viewport,
} from "@xyflow/react";
import {
  Icon360View,
  IconArrowsMaximize,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconGridDots,
  IconLayoutKanban,
  IconLoader2,
  IconMaximize,
  IconMinus,
  IconPhoto,
  IconPlus,
  IconRoute,
  IconSearch,
  IconTrash,
  IconVideo,
  IconWand,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/components/ui/native-select";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch } from "@/src/store";
import { touchCredits } from "@/src/store/slices/userSlice";
import type { FizzDocument } from "../../../../_lib/api";
import {
  filterFizzAiInput,
  getFizzAiJob,
  listFizzAiCatalog,
  normalizeFizzAiError,
  pickFizzAiModel,
  submitFizzAiJob,
  type FizzAiCatalog,
  type FizzAiGenerationMode,
  type FizzAiJobView,
} from "../../../../_lib/generation-api";
import { useStoryboard, type SaveState } from "../../_hooks/use-storyboard";
import {
  StudioResultLightbox,
  type StudioResultLightboxItem,
} from "../../../_components/studio-result-lightbox";
import {
  getCanvas,
  localId,
  type CanvasGenerationStatus,
  type CanvasAssetNode,
  type CanvasNodePos,
  type MediaItem,
  type Shot,
  type ShotCell,
  type StoryboardColumn,
  type StoryboardContent,
} from "../../_data/storyboard-schema";
import {
  MIN_CANVAS_ZOOM,
  NODE_COMPOSER_GAP,
  NODE_COMPOSER_HEIGHT,
  NODE_COMPOSER_VIEWPORT_PADDING,
  NODE_COMPOSER_WIDTH,
  PANORAMA_NODE_HEIGHT,
  PANORAMA_NODE_WIDTH,
  SHOT_NODE_HEIGHT,
  SHOT_NODE_WIDTH,
} from "./canvas-constants";
import { PanoramaNode, type PanoramaNodeData } from "./panorama-node";
import {
  ShotNode,
  type NodeComposerLayout,
  type ShotGenerationRequest,
  type ShotComposerState,
  type ShotNodeData,
} from "./shot-node";
import type { PanoramaGenerationRequest } from "./panorama-node";

const nodeTypes: NodeTypes = { panorama: PanoramaNode, shot: ShotNode };
const edgeTypes: EdgeTypes = { creative: CreativeCanvasEdge };

type CanvasNodeData = PanoramaNodeData | ShotNodeData;
type CanvasNode = Node<CanvasNodeData>;
type CanvasEdgeData = {
  active?: boolean;
  dimmed?: boolean;
  direct?: boolean;
  relation?: "incoming" | "outgoing";
};

type CanvasNodeRelation = "incoming" | "neutral" | "outgoing" | "selected";

type CanvasNodeSize = {
  height: number;
  width: number;
};

type EdgeTone = {
  dash: string;
  glow: string;
  main: string;
  particle: string;
};

type CanvasBounds = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

type AlignmentGuide = {
  x?: number;
  y?: number;
};

type ActiveGenerationTarget =
  | {
      columnId: string;
      jobId: string;
      kind: "shot-video";
      mediaId: string;
      shotId: string;
    }
  | {
      jobId: string;
      kind: "panorama";
      mediaId?: string;
      nodeId: string;
    };

interface CanvasColumnIds {
  image: string;
  video: string;
  description: string;
  dialogue: string;
  duration: string;
  shotSize: string;
  movement: string;
}

function defaultPos(index: number): CanvasNodePos {
  return {
    x: 72 + (index % 4) * 396,
    y: 84 + Math.floor(index / 4) * 272,
  };
}

const EMPTY_CANVAS_BOUNDS: CanvasBounds = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  top: 0,
  width: 0,
};

const ALIGNMENT_SNAP_DISTANCE_PX = 6;
const NODE_DRAG_CLICK_SUPPRESS_MS = 220;

function layoutPos(index: number): CanvasNodePos {
  return {
    x: 88 + (index % 5) * 412,
    y: 92 + Math.floor(index / 5) * 286,
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function findColumnId(content: StoryboardContent, preset: string, fallback: string) {
  return content.columns.find((c) => c.preset === preset)?.id ?? fallback;
}

function getComposerLayout(
  position: CanvasNodePos,
  viewport: Viewport,
  bounds: CanvasBounds,
  nodeSize: CanvasNodeSize = { height: SHOT_NODE_HEIGHT, width: SHOT_NODE_WIDTH }
): NodeComposerLayout {
  if (bounds.width <= 0 || bounds.height <= 0) return { offsetX: 0, placement: "bottom" };

  const zoom = Math.max(viewport.zoom, MIN_CANVAS_ZOOM);
  const nodeLeft = bounds.left + position.x * zoom + viewport.x;
  const nodeTop = bounds.top + position.y * zoom + viewport.y;
  const nodeWidth = nodeSize.width * zoom;
  const nodeHeight = nodeSize.height * zoom;
  const nodeCenterX = nodeLeft + nodeWidth / 2;
  const minCenter = bounds.left + NODE_COMPOSER_VIEWPORT_PADDING + NODE_COMPOSER_WIDTH / 2;
  const maxCenter = bounds.right - NODE_COMPOSER_VIEWPORT_PADDING - NODE_COMPOSER_WIDTH / 2;
  const targetCenter =
    minCenter <= maxCenter
      ? clampNumber(nodeCenterX, minCenter, maxCenter)
      : bounds.left + bounds.width / 2;
  const belowTop = nodeTop + nodeHeight + NODE_COMPOSER_GAP;
  const aboveTop = nodeTop - NODE_COMPOSER_GAP - NODE_COMPOSER_HEIGHT;
  const availableBelow = bounds.bottom - NODE_COMPOSER_VIEWPORT_PADDING - belowTop;
  const availableAbove = aboveTop - (bounds.top + NODE_COMPOSER_VIEWPORT_PADDING);
  const placement =
    availableBelow >= NODE_COMPOSER_HEIGHT || availableBelow >= availableAbove ? "bottom" : "top";

  return {
    offsetX: Math.round((targetCenter - nodeCenterX) * 10) / 10,
    placement,
  };
}

function sameComposerLayout(a: NodeComposerLayout | undefined, b: NodeComposerLayout): boolean {
  return Boolean(a && a.placement === b.placement && a.offsetX === b.offsetX);
}

function sameComposerState(a: ShotComposerState | undefined, b: ShotComposerState): boolean {
  return Boolean(
    a &&
    a.activeTool === b.activeTool &&
    a.aspectRatio === b.aspectRatio &&
    a.autoValidate === b.autoValidate &&
    a.duration === b.duration &&
    a.expanded === b.expanded &&
    a.mode === b.mode &&
    a.model === b.model &&
    a.outputCount === b.outputCount &&
    a.promptDraft === b.promptDraft &&
    a.resolution === b.resolution &&
    a.translateEnabled === b.translateEnabled &&
    a.webSearch === b.webSearch &&
    a.withAudio === b.withAudio
  );
}

function getColumnIds(content: StoryboardContent): CanvasColumnIds {
  return {
    image: findColumnId(content, "image_path", "col_image"),
    video: findColumnId(content, "video_path", "col_video"),
    description: findColumnId(content, "description", "col_description"),
    dialogue: findColumnId(content, "dialogue", "col_dialogue"),
    duration: findColumnId(content, "duration", "col_duration"),
    shotSize: findColumnId(content, "shot_size", "col_shot_size"),
    movement: findColumnId(content, "movement", "col_movement"),
  };
}

function getCell(shot: Shot | null | undefined, columnId: string): ShotCell {
  return shot?.cells[columnId] ?? {};
}

function getCellText(shot: Shot, columnId: string): string {
  const cell = getCell(shot, columnId);
  return cell.richText ?? cell.text ?? "";
}

function getCoverUrl(shot: Shot, imageColumnId: string): string | undefined {
  const media = shot.cells[imageColumnId]?.media ?? [];
  return media.find((m) => m.preferred)?.url ?? media[0]?.url;
}

function getPreferredMedia(shot: Shot | null | undefined, columnId: string): MediaItem | undefined {
  const media = shot?.cells[columnId]?.media ?? [];
  return media.find((item) => item.preferred) ?? media[0];
}

function hasMedia(shot: Shot, ...columnIds: string[]): boolean {
  return columnIds.some((columnId) => {
    const media = shot.cells[columnId]?.media ?? [];
    return media.some((item) => Boolean(item.url));
  });
}

function displayValue(value: string | undefined, t: (key: string) => string) {
  if (!value) return "";
  return value.startsWith("sb") ? t(value) : value;
}

function generationIdempotencyKey(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${localId("job")}`;
}

function compactInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([, value]) => value !== undefined && value !== null && value !== ""
    )
  );
}

function generationStatusFromRaw(status: string | null | undefined): CanvasGenerationStatus {
  if (status === "completed") return "done";
  if (status === "failed" || status === "expired") return "failed";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "in_progress" || status === "running") return "generating";
  if (status === "in_queue" || status === "queued") return "queued";
  return "queued";
}

function mediaStatusFromGeneration(
  status: CanvasGenerationStatus
): NonNullable<MediaItem["status"]> {
  if (status === "done") return "done";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "generating") return "generating";
  return "pending";
}

function pollingStatusFromSubmit(status: string | null | undefined): CanvasGenerationStatus {
  const next = generationStatusFromRaw(status);
  return next === "done" ? "generating" : next;
}

function errorMessageFromJob(job: FizzAiJobView, fallback: string) {
  return job.error?.userMessage || job.error?.message || fallback;
}

function upsertPreferredMedia(cell: ShotCell, item: MediaItem): ShotCell {
  const existing = cell.media ?? [];
  const media = [
    item,
    ...existing
      .filter((mediaItem) => mediaItem.id !== item.id && mediaItem.jobId !== item.jobId)
      .map((mediaItem) => (item.preferred ? { ...mediaItem, preferred: false } : mediaItem)),
  ];
  return { ...cell, media };
}

function upsertPreferredMediaList(media: MediaItem[] | undefined, item: MediaItem): MediaItem[] {
  return [
    item,
    ...(media ?? [])
      .filter((mediaItem) => mediaItem.id !== item.id && mediaItem.jobId !== item.jobId)
      .map((mediaItem) => (item.preferred ? { ...mediaItem, preferred: false } : mediaItem)),
  ];
}

function mediaFromJob(
  job: FizzAiJobView,
  existing: MediaItem | undefined,
  fallbackError: string
): MediaItem {
  const status = generationStatusFromRaw(job.status);
  const output = job.outputs[0];
  return {
    id: output?.id ?? existing?.id ?? job.id,
    durationSeconds: output?.durationSeconds ?? existing?.durationSeconds,
    error:
      status === "failed" || status === "cancelled"
        ? errorMessageFromJob(job, fallbackError)
        : undefined,
    height: output?.height ?? existing?.height,
    jobId: job.id,
    mimeType: output?.mimeType ?? existing?.mimeType,
    path: output?.storagePath ?? existing?.path,
    preferred: true,
    progress: job.progress ?? null,
    stage: job.stage,
    status: mediaStatusFromGeneration(status),
    url: output?.url ?? existing?.url,
    width: output?.width ?? existing?.width,
  };
}

function sameMediaJobState(a: MediaItem | undefined, b: MediaItem): boolean {
  return Boolean(
    a &&
    a.durationSeconds === b.durationSeconds &&
    a.error === b.error &&
    a.height === b.height &&
    a.jobId === b.jobId &&
    a.mimeType === b.mimeType &&
    a.path === b.path &&
    a.progress === b.progress &&
    a.stage === b.stage &&
    a.status === b.status &&
    a.url === b.url &&
    a.width === b.width
  );
}

function isActiveMediaJob(item: MediaItem): item is MediaItem & { jobId: string } {
  if (!item.jobId) return false;
  return item.status === "pending" || item.status === "generating";
}

function getActiveGenerationTargets(
  shots: Shot[],
  assetNodes: CanvasAssetNode[],
  videoColumnId: string
): ActiveGenerationTarget[] {
  const targets: ActiveGenerationTarget[] = [];

  for (const shot of shots) {
    const videoMedia = shot.cells[videoColumnId]?.media ?? [];
    for (const item of videoMedia) {
      if (!isActiveMediaJob(item)) continue;
      targets.push({
        columnId: videoColumnId,
        jobId: item.jobId,
        kind: "shot-video",
        mediaId: item.id,
        shotId: shot.id,
      });
    }
  }

  for (const node of assetNodes) {
    const jobId = node.generation?.jobId;
    const active =
      jobId &&
      (node.status === "queued" ||
        node.status === "generating" ||
        node.generation?.status === "queued" ||
        node.generation?.status === "generating");
    if (!active || !jobId) continue;
    const media = node.media?.find((item) => item.jobId === jobId);
    targets.push({
      jobId,
      kind: "panorama",
      mediaId: media?.id,
      nodeId: node.id,
    });
  }

  return targets;
}

function preferredVideoModes(request: ShotGenerationRequest): FizzAiGenerationMode[] {
  if (request.mode === "first-last") {
    return ["first_last_frame_to_video", "image_to_video", "text_to_video"];
  }
  if (request.referenceUrl) return ["image_to_video", "first_last_frame_to_video", "text_to_video"];
  return ["text_to_video", "image_to_video"];
}

function getInsetEdgePoint(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourceInset: number,
  targetInset: number
) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const distance = Math.max(Math.hypot(dx, dy), 1);
  const ux = dx / distance;
  const uy = dy / distance;
  return {
    sourceX: sourceX + ux * sourceInset,
    sourceY: sourceY + uy * sourceInset,
    targetX: targetX - ux * targetInset,
    targetY: targetY - uy * targetInset,
    ux,
    uy,
  };
}

function getEdgeTone(relation: CanvasEdgeData["relation"]): EdgeTone {
  if (relation === "outgoing") {
    return {
      dash: "rgba(255,255,255,0.88)",
      glow: "rgba(222,227,234,0.26)",
      main: "#d8dde5",
      particle: "rgba(255,255,255,0.96)",
    };
  }

  if (relation === "incoming") {
    return {
      dash: "rgba(232,238,246,0.82)",
      glow: "rgba(157,170,188,0.24)",
      main: "#aab6c5",
      particle: "rgba(235,241,247,0.9)",
    };
  }

  return {
    dash: "rgba(255,255,255,0.82)",
    glow: "rgba(160,176,195,0.24)",
    main: "#a6b2c2",
    particle: "rgba(235,241,247,0.9)",
  };
}

function CreativeCanvasEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps) {
  const edgeData = data as CanvasEdgeData | undefined;
  const active = selected || Boolean(edgeData?.active);
  const dimmed = Boolean(edgeData?.dimmed);
  const direct = Boolean(edgeData?.direct);
  const tone = getEdgeTone(edgeData?.relation);
  const point = getInsetEdgePoint(
    sourceX,
    sourceY,
    targetX,
    targetY,
    active ? 9 : 5,
    active ? 18 : 7
  );
  const nearHorizontal = Math.abs(sourceY - targetY) < 28;
  const [path] =
    direct && nearHorizontal
      ? getStraightPath({
          sourceX: point.sourceX,
          sourceY: point.sourceY,
          targetX: point.targetX,
          targetY: point.targetY,
        })
      : getBezierPath({
          sourceX: point.sourceX,
          sourceY: point.sourceY,
          sourcePosition: sourcePosition as Position,
          targetX: point.targetX,
          targetY: point.targetY,
          targetPosition: targetPosition as Position,
          curvature: active ? 0.18 : 0.32,
        });

  const stroke = active ? tone.main : "rgba(145,156,174,0.5)";
  const strokeWidth = active ? 2 : 1;
  const opacity = active ? 1 : dimmed ? 0.2 : 0.58;
  const arrowLength = active ? 13 : 0;
  const arrowWidth = active ? 9 : 0;
  const nx = -point.uy;
  const ny = point.ux;
  const arrowBaseX = point.targetX - point.ux * arrowLength;
  const arrowBaseY = point.targetY - point.uy * arrowLength;
  const arrowPoints = [
    `${point.targetX},${point.targetY}`,
    `${arrowBaseX + nx * (arrowWidth / 2)},${arrowBaseY + ny * (arrowWidth / 2)}`,
    `${arrowBaseX - nx * (arrowWidth / 2)},${arrowBaseY - ny * (arrowWidth / 2)}`,
  ].join(" ");

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        style={{
          stroke,
          strokeWidth,
          opacity,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }}
      />
      {active && (
        <>
          <path d={path} fill="none" stroke={tone.glow} strokeLinecap="round" strokeWidth="6.5" />
          <path
            d={path}
            fill="none"
            stroke={tone.main}
            strokeDasharray="20 26"
            strokeLinecap="round"
            strokeWidth="2.6"
          >
            <animate
              attributeName="stroke-dashoffset"
              dur="1.05s"
              from="50"
              repeatCount="indefinite"
              to="0"
            />
          </path>
          <path
            d={path}
            fill="none"
            stroke={tone.dash}
            strokeDasharray="6 44"
            strokeLinecap="round"
            strokeWidth="1.35"
          >
            <animate
              attributeName="stroke-dashoffset"
              dur="1.05s"
              from="50"
              repeatCount="indefinite"
              to="0"
            />
          </path>
          <circle r="3.2" fill={tone.main} opacity="0.95">
            <animateMotion dur="1.1s" path={path} repeatCount="indefinite" />
          </circle>
          <circle r="2.1" fill={tone.particle}>
            <animateMotion begin="0.18s" dur="1.1s" path={path} repeatCount="indefinite" />
          </circle>
        </>
      )}
      {active && <polygon points={arrowPoints} fill={stroke} opacity={0.98} />}
    </>
  );
}

function CanvasAlignmentGuides({
  bounds,
  guide,
  viewport,
}: {
  bounds: CanvasBounds;
  guide: AlignmentGuide | null;
  viewport: Viewport;
}) {
  if (!guide || bounds.width <= 0 || bounds.height <= 0) return null;

  const zoom = Math.max(viewport.zoom, MIN_CANVAS_ZOOM);
  const x = typeof guide.x === "number" ? viewport.x + guide.x * zoom : null;
  const y = typeof guide.y === "number" ? viewport.y + guide.y * zoom : null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[6] overflow-hidden"
      data-fizz-alignment-guides="true"
    >
      {x !== null ? (
        <div
          className="absolute bottom-0 top-0 w-px bg-cyan-200/20 shadow-[0_0_10px_rgba(103,232,249,0.14)]"
          style={{ transform: `translateX(${Math.round(x)}px)` }}
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 border-l border-dashed border-cyan-100/30" />
        </div>
      ) : null}
      {y !== null ? (
        <div
          className="absolute left-0 right-0 h-px bg-cyan-200/20 shadow-[0_0_10px_rgba(103,232,249,0.14)]"
          style={{ transform: `translateY(${Math.round(y)}px)` }}
        >
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 border-t border-dashed border-cyan-100/30" />
        </div>
      ) : null}
    </div>
  );
}

function edgeFromCanvas(
  edge: { id: string; source: string; target: string },
  selectedNodeId: string | null
): Edge<CanvasEdgeData> {
  const active = Boolean(
    selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId)
  );
  const relation =
    active && selectedNodeId
      ? edge.source === selectedNodeId
        ? "outgoing"
        : "incoming"
      : undefined;
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "creative",
    data: { active, dimmed: Boolean(selectedNodeId && !active), direct: true, relation },
    selectable: true,
    zIndex: active ? 20 : 0,
  };
}

function getNodeRelation(
  nodeId: string,
  selectedNodeId: string | null,
  edges: { source: string; target: string }[]
): CanvasNodeRelation {
  if (!selectedNodeId) return "neutral";
  if (nodeId === selectedNodeId) return "selected";

  const linked = edges.find(
    (edge) =>
      (edge.source === selectedNodeId && edge.target === nodeId) ||
      (edge.target === selectedNodeId && edge.source === nodeId)
  );
  if (!linked) return "neutral";

  return linked.source === selectedNodeId ? "outgoing" : "incoming";
}

function getNodeZIndex(relation: CanvasNodeRelation) {
  if (relation === "selected") return 1000;
  if (relation === "incoming" || relation === "outgoing") return 80;
  return 10;
}

function getNodeSizeByType(type: string | undefined): CanvasNodeSize {
  if (type === "panorama") return { height: PANORAMA_NODE_HEIGHT, width: PANORAMA_NODE_WIDTH };
  return { height: SHOT_NODE_HEIGHT, width: SHOT_NODE_WIDTH };
}

function getNodeAlignmentFrame(position: CanvasNodePos, size: CanvasNodeSize) {
  return {
    bottom: position.y + size.height,
    centerX: position.x + size.width / 2,
    centerY: position.y + size.height / 2,
    left: position.x,
    right: position.x + size.width,
    top: position.y,
  };
}

function getAlignmentGuideForPosition({
  movingNodeId,
  nodes,
  position,
  zoom,
}: {
  movingNodeId: string;
  nodes: CanvasNode[];
  position: CanvasNodePos;
  zoom: number;
}): AlignmentGuide | null {
  const threshold = ALIGNMENT_SNAP_DISTANCE_PX / Math.max(zoom, MIN_CANVAS_ZOOM);
  const movingNode = nodes.find((node) => node.id === movingNodeId);
  const movingFrame = getNodeAlignmentFrame(position, getNodeSizeByType(movingNode?.type));
  let bestX: { distance: number; line: number } | null = null;
  let bestY: { distance: number; line: number } | null = null;

  for (const node of nodes) {
    if (node.id === movingNodeId) continue;

    const frame = getNodeAlignmentFrame(node.position, getNodeSizeByType(node.type));
    const xPairs = [
      [movingFrame.left, frame.left],
      [movingFrame.centerX, frame.centerX],
      [movingFrame.right, frame.right],
      [movingFrame.left, frame.right],
      [movingFrame.right, frame.left],
    ] as const;
    const yPairs = [
      [movingFrame.top, frame.top],
      [movingFrame.centerY, frame.centerY],
      [movingFrame.bottom, frame.bottom],
      [movingFrame.top, frame.bottom],
      [movingFrame.bottom, frame.top],
    ] as const;

    for (const [movingValue, targetValue] of xPairs) {
      const distance = Math.abs(targetValue - movingValue);
      if (distance > threshold || (bestX && distance >= bestX.distance)) continue;
      bestX = { distance, line: targetValue };
    }

    for (const [movingValue, targetValue] of yPairs) {
      const distance = Math.abs(targetValue - movingValue);
      if (distance > threshold || (bestY && distance >= bestY.distance)) continue;
      bestY = { distance, line: targetValue };
    }
  }

  return bestX || bestY ? { x: bestX?.line, y: bestY?.line } : null;
}

function CanvasInner({ doc }: { doc: FizzDocument }) {
  const t = useTranslations("fizzStudio");
  const dispatch = useAppDispatch();
  const {
    content,
    saveState,
    addShotAtCanvas,
    addCanvasAssetNode,
    setCell,
    updateShotCell,
    removeShotFromCanvas,
    setCanvasPositions,
    setNodePosition,
    addCanvasEdge,
    removeCanvasEdge,
    updateCanvasAssetNode,
    removeCanvasAssetNode,
    setViewport,
  } = useStoryboard(doc);
  const flow = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const initialViewport = getCanvas(content).viewport ?? { x: 0, y: 0, zoom: 1 };
  const [viewportState, setViewportState] = useState<Viewport>(initialViewport);
  const [canvasBounds, setCanvasBounds] = useState<CanvasBounds>(EMPTY_CANVAS_BOUNDS);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [composerStates, setComposerStates] = useState<Record<string, ShotComposerState>>({});
  const [alignmentGuide, setAlignmentGuide] = useState<AlignmentGuide | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [previewMediaId, setPreviewMediaId] = useState<string | null>(null);
  const dragEndRef = useRef<{ at: number; nodeId: string } | null>(null);
  const aiCatalogRef = useRef<FizzAiCatalog | null>(null);
  const generationPollInFlightRef = useRef(false);
  const zoom = viewportState.zoom;

  const columnIds = useMemo(() => getColumnIds(content), [content]);
  const canvas = getCanvas(content);
  const shots = content.shots;
  const assetNodes = useMemo(() => canvas.nodes ?? [], [canvas.nodes]);
  const selectedShot = shots.find((shot) => shot.id === selectedNodeId) ?? null;
  const selectedAssetNode = assetNodes.find((node) => node.id === selectedNodeId) ?? null;
  const hasSelectedNode = Boolean(selectedShot || selectedAssetNode);
  const selectedIndex = selectedShot ? shots.findIndex((shot) => shot.id === selectedShot.id) : -1;

  const updateCell = useCallback(
    (shotId: string, columnId: string, cell: ShotCell) => {
      setCell(shotId, columnId, cell);
    },
    [setCell]
  );

  const openMediaPreview = useCallback((mediaId: string) => {
    setPreviewMediaId(mediaId);
  }, []);

  /** Every playable media on the board in document order — drives the shared
   *  result lightbox so canvas previews navigate across shots and panoramas. */
  const lightboxItems = useMemo<StudioResultLightboxItem[]>(() => {
    const items: StudioResultLightboxItem[] = [];
    for (const shot of shots) {
      const prompt = shot.cells[columnIds.description]?.text?.trim() || undefined;
      for (const columnId of [columnIds.video, columnIds.image]) {
        const kind: StudioResultLightboxItem["kind"] =
          columnId === columnIds.video ? "video" : "image";
        for (const item of shot.cells[columnId]?.media ?? []) {
          if (!item.url) continue;
          items.push({
            id: item.id,
            kind,
            url: item.url,
            prompt,
            width: item.width ?? null,
            height: item.height ?? null,
            durationSeconds: item.durationSeconds ?? null,
          });
        }
      }
    }
    for (const node of assetNodes) {
      const prompt = node.prompt?.trim() || undefined;
      const createdAt = node.generation?.completedAt ?? node.generation?.submittedAt;
      for (const item of node.media ?? []) {
        if (!item.url) continue;
        items.push({
          id: item.id,
          kind: "image",
          url: item.url,
          prompt,
          createdAt,
          modelLabel: node.settings?.model,
          width: item.width ?? null,
          height: item.height ?? null,
        });
      }
    }
    return items;
  }, [assetNodes, columnIds.description, columnIds.image, columnIds.video, shots]);
  const previewActive =
    previewMediaId != null && lightboxItems.some((item) => item.id === previewMediaId);

  const loadAiCatalog = useCallback(async () => {
    if (aiCatalogRef.current) return aiCatalogRef.current;
    const catalog = await listFizzAiCatalog();
    aiCatalogRef.current = catalog;
    return catalog;
  }, []);

  const updateComposerState = useCallback((shotId: string, state: ShotComposerState) => {
    setComposerStates((current) => {
      if (sameComposerState(current[shotId], state)) return current;
      return { ...current, [shotId]: state };
    });
  }, []);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;

    const updateBounds = () => {
      const rect = element.getBoundingClientRect();
      setCanvasBounds({
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
      });
    };

    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(element);
    window.addEventListener("resize", updateBounds);
    window.visualViewport?.addEventListener("resize", updateBounds);
    window.visualViewport?.addEventListener("scroll", updateBounds);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBounds);
      window.visualViewport?.removeEventListener("resize", updateBounds);
      window.visualViewport?.removeEventListener("scroll", updateBounds);
    };
  }, []);

  const onDeleteShot = useCallback(
    (shotId: string) => {
      removeShotFromCanvas(shotId);
      setSelectedNodeId((current) => (current === shotId ? null : current));
      setComposerStates((current) => {
        if (!current[shotId]) return current;
        const next = { ...current };
        delete next[shotId];
        return next;
      });
    },
    [removeShotFromCanvas]
  );

  const updateAssetNode = useCallback(
    (nodeId: string, patch: Partial<Omit<CanvasAssetNode, "id" | "kind">>) => {
      updateCanvasAssetNode(nodeId, patch);
    },
    [updateCanvasAssetNode]
  );

  const submitShotGeneration = useCallback(
    async (shot: Shot, request: ShotGenerationRequest) => {
      const mediaId = localId("media");
      updateShotCell(shot.id, columnIds.video, (cell) =>
        upsertPreferredMedia(cell, {
          id: mediaId,
          preferred: true,
          progress: null,
          stage: "submitting",
          status: "pending",
        })
      );

      try {
        const catalog = await loadAiCatalog();
        const model = pickFizzAiModel(catalog, "video", preferredVideoModes(request));
        if (!model) throw new Error(t("sbGenerationNoVideoModel"));

        const rawInput = compactInput({
          aspectRatio: request.aspectRatio,
          aspect_ratio: request.aspectRatio,
          durationSeconds: request.durationSeconds,
          n: request.outputCount,
          numOutputs: request.outputCount,
          prompt: request.prompt,
          seconds: request.durationSeconds,
          startFrame: request.referenceUrl ? { url: request.referenceUrl } : undefined,
          withAudio: request.withAudio,
        });
        const input = filterFizzAiInput(model, rawInput);
        const response = await submitFizzAiJob({
          context: {
            workspaceId: doc.workspaceId,
            projectId: doc.projectId,
            documentId: doc.id,
            documentBlockId: shot.id,
            sourceSurface: "fizzstudio-canvas",
          },
          idempotencyKey: generationIdempotencyKey(`fizzstudio:${doc.id}:${shot.id}:video`),
          input,
          modelId: model.id,
          schemaVersion: model.schemaVersion,
        });
        dispatch(touchCredits());
        const status = pollingStatusFromSubmit(response.status);
        updateShotCell(shot.id, columnIds.video, (cell) =>
          upsertPreferredMedia(cell, {
            id: mediaId,
            jobId: response.request_id,
            preferred: true,
            progress: response.progress,
            stage: response.stage,
            status: mediaStatusFromGeneration(status),
          })
        );
      } catch (error) {
        const message = normalizeFizzAiError(error, t("sbGenerationSubmitFailed"));
        updateShotCell(shot.id, columnIds.video, (cell) =>
          upsertPreferredMedia(cell, {
            id: mediaId,
            error: message,
            preferred: true,
            progress: null,
            stage: "failed",
            status: "failed",
          })
        );
        throw new Error(message);
      }
    },
    [
      columnIds.video,
      dispatch,
      doc.id,
      doc.projectId,
      doc.workspaceId,
      loadAiCatalog,
      t,
      updateShotCell,
    ]
  );

  const submitPanoramaGeneration = useCallback(
    async (node: CanvasAssetNode, request: PanoramaGenerationRequest) => {
      const mediaId = localId("media");
      updateCanvasAssetNode(node.id, {
        generation: {
          progress: null,
          stage: "submitting",
          status: "queued",
          submittedAt: new Date().toISOString(),
        },
        media: upsertPreferredMediaList(node.media, {
          id: mediaId,
          preferred: true,
          progress: null,
          stage: "submitting",
          status: "pending",
        }),
        prompt: request.prompt,
        status: "queued",
      });

      try {
        const catalog = await loadAiCatalog();
        const model = pickFizzAiModel(catalog, "image", ["text_to_image", "image_to_image"]);
        if (!model) throw new Error(t("sbGenerationNoImageModel"));

        const rawInput = compactInput({
          aspectRatio: "2:1",
          aspect_ratio: "2:1",
          imageSize: "landscape_16_9",
          input_reference: request.referenceUrl ? [{ url: request.referenceUrl }] : undefined,
          n: request.outputCount,
          numOutputs: request.outputCount,
          prompt: request.prompt,
          referenceImages: request.referenceUrl ? [{ url: request.referenceUrl }] : undefined,
          resolution: request.resolution,
          size: "2048x1024",
        });
        const input = filterFizzAiInput(model, rawInput);
        const response = await submitFizzAiJob({
          context: {
            workspaceId: doc.workspaceId,
            projectId: doc.projectId,
            documentId: doc.id,
            documentBlockId: node.id,
            sourceSurface: "fizzstudio-canvas",
          },
          idempotencyKey: generationIdempotencyKey(`fizzstudio:${doc.id}:${node.id}:panorama`),
          input,
          modelId: model.id,
          schemaVersion: model.schemaVersion,
        });
        dispatch(touchCredits());
        const status = pollingStatusFromSubmit(response.status);
        updateCanvasAssetNode(node.id, {
          generation: {
            jobId: response.request_id,
            progress: response.progress,
            stage: response.stage,
            status,
            submittedAt: new Date().toISOString(),
          },
          media: upsertPreferredMediaList(node.media, {
            id: mediaId,
            jobId: response.request_id,
            preferred: true,
            progress: response.progress,
            stage: response.stage,
            status: mediaStatusFromGeneration(status),
          }),
          prompt: request.prompt,
          status,
        });
      } catch (error) {
        const message = normalizeFizzAiError(error, t("sbGenerationSubmitFailed"));
        updateCanvasAssetNode(node.id, {
          generation: {
            error: message,
            progress: null,
            stage: "failed",
            status: "failed",
            submittedAt: new Date().toISOString(),
          },
          media: upsertPreferredMediaList(node.media, {
            id: mediaId,
            error: message,
            preferred: true,
            progress: null,
            stage: "failed",
            status: "failed",
          }),
          prompt: request.prompt,
          status: "failed",
        });
        throw new Error(message);
      }
    },
    [dispatch, doc.id, doc.projectId, doc.workspaceId, loadAiCatalog, t, updateCanvasAssetNode]
  );

  const nodeData = useCallback(
    (shot: Shot, index: number, position: CanvasNodePos): ShotNodeData => ({
      shot,
      index,
      columnIds,
      composerLayout: getComposerLayout(position, viewportState, canvasBounds),
      composerVisible: selectedNodeId === shot.id && draggingNodeId === null,
      composerState: composerStates[shot.id],
      inspectorSelected: selectedNodeId === shot.id,
      onComposerStateChange: updateComposerState,
      onSubmitGeneration: submitShotGeneration,
      onOpenPreview: openMediaPreview,
      relation: getNodeRelation(shot.id, selectedNodeId, canvas.edges),
      viewportZoom: zoom,
      sourceHandleActive: Boolean(
        selectedNodeId &&
        canvas.edges.some(
          (edge) =>
            (edge.source === shot.id && edge.target === selectedNodeId) ||
            (edge.source === shot.id && shot.id === selectedNodeId)
        )
      ),
      targetHandleActive: Boolean(
        selectedNodeId &&
        canvas.edges.some(
          (edge) =>
            (edge.target === shot.id && edge.source === selectedNodeId) ||
            (edge.target === shot.id && shot.id === selectedNodeId)
        )
      ),
    }),
    [
      canvas.edges,
      canvasBounds,
      columnIds,
      composerStates,
      draggingNodeId,
      openMediaPreview,
      selectedNodeId,
      submitShotGeneration,
      updateComposerState,
      viewportState,
      zoom,
    ]
  );

  const panoramaNodeData = useCallback(
    (node: CanvasAssetNode, index: number, position: CanvasNodePos): PanoramaNodeData => {
      const sourceShot = node.sourceShotId
        ? (shots.find((shot) => shot.id === node.sourceShotId) ?? null)
        : null;
      const relation = getNodeRelation(node.id, selectedNodeId, canvas.edges);
      return {
        node,
        index,
        composerLayout: getComposerLayout(position, viewportState, canvasBounds, {
          height: PANORAMA_NODE_HEIGHT,
          width: PANORAMA_NODE_WIDTH,
        }),
        composerVisible: selectedNodeId === node.id && draggingNodeId === null,
        inspectorSelected: selectedNodeId === node.id,
        onNodeChange: updateAssetNode,
        onOpenPreview: openMediaPreview,
        onSubmitGeneration: submitPanoramaGeneration,
        referenceLabel: sourceShot
          ? t("sbComposerImageRef").replace("{index}", String(shots.indexOf(sourceShot) + 1))
          : undefined,
        referenceMedia: getPreferredMedia(sourceShot, columnIds.image),
        relation,
        viewportZoom: zoom,
        sourceHandleActive: Boolean(
          selectedNodeId &&
          canvas.edges.some(
            (edge) =>
              (edge.source === node.id && edge.target === selectedNodeId) ||
              (edge.source === node.id && node.id === selectedNodeId)
          )
        ),
        targetHandleActive: Boolean(
          selectedNodeId &&
          canvas.edges.some(
            (edge) =>
              (edge.target === node.id && edge.source === selectedNodeId) ||
              (edge.target === node.id && node.id === selectedNodeId)
          )
        ),
      };
    },
    [
      canvas.edges,
      canvasBounds,
      columnIds.image,
      draggingNodeId,
      openMediaPreview,
      selectedNodeId,
      shots,
      submitPanoramaGeneration,
      t,
      updateAssetNode,
      viewportState,
      zoom,
    ]
  );

  const activeGenerationTargets = useMemo(
    () => getActiveGenerationTargets(shots, assetNodes, columnIds.video),
    [assetNodes, columnIds.video, shots]
  );
  const activeGenerationKey = useMemo(
    () =>
      activeGenerationTargets
        .map(
          (target) =>
            `${target.kind}:${target.jobId}:${"shotId" in target ? target.shotId : target.nodeId}`
        )
        .sort()
        .join("|"),
    [activeGenerationTargets]
  );

  useEffect(() => {
    if (!activeGenerationTargets.length) return;
    let cancelled = false;

    const poll = async () => {
      if (generationPollInFlightRef.current) return;
      generationPollInFlightRef.current = true;

      try {
        const uniqueJobs = [...new Set(activeGenerationTargets.map((target) => target.jobId))];
        const results = await Promise.allSettled(uniqueJobs.map((jobId) => getFizzAiJob(jobId)));
        if (cancelled) return;

        const jobs = new Map<string, FizzAiJobView>();
        for (const result of results) {
          if (result.status === "fulfilled") jobs.set(result.value.id, result.value);
        }

        const terminalJobIds = new Set<string>();
        for (const target of activeGenerationTargets) {
          const job = jobs.get(target.jobId);
          if (!job) continue;
          const status = generationStatusFromRaw(job.status);
          if (status === "done" || status === "failed" || status === "cancelled") {
            terminalJobIds.add(job.id);
          }
          const existingError = t("sbGenerationFailed");

          if (target.kind === "shot-video") {
            updateShotCell(target.shotId, target.columnId, (cell) => {
              const existing = cell.media?.find(
                (item) => item.id === target.mediaId || item.jobId === target.jobId
              );
              const media = mediaFromJob(job, existing, existingError);
              if (sameMediaJobState(existing, media)) return cell;
              return upsertPreferredMedia(cell, media);
            });
            continue;
          }

          const node = assetNodes.find((item) => item.id === target.nodeId);
          if (!node) continue;
          const existing = node.media?.find(
            (item) => item.id === target.mediaId || item.jobId === target.jobId
          );
          const media = mediaFromJob(job, existing, existingError);
          const completedAt =
            status === "done" ? (job.completedAt ?? job.updatedAt) : node.generation?.completedAt;
          const generationChanged =
            node.status !== status ||
            node.generation?.completedAt !== completedAt ||
            node.generation?.error !==
              (status === "failed" || status === "cancelled" ? media.error : undefined) ||
            node.generation?.jobId !== job.id ||
            node.generation?.progress !== (job.progress ?? null) ||
            node.generation?.stage !== job.stage ||
            node.generation?.status !== status;
          if (!generationChanged && sameMediaJobState(existing, media)) continue;
          updateCanvasAssetNode(target.nodeId, {
            generation: {
              completedAt,
              error: status === "failed" || status === "cancelled" ? media.error : undefined,
              jobId: job.id,
              progress: job.progress ?? null,
              stage: job.stage,
              status,
              submittedAt: node.generation?.submittedAt,
            },
            media: upsertPreferredMediaList(node.media, media),
            status,
          });
        }
        if (terminalJobIds.size > 0) dispatch(touchCredits());
      } finally {
        generationPollInFlightRef.current = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 2200);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    activeGenerationKey,
    activeGenerationTargets,
    assetNodes,
    dispatch,
    t,
    updateCanvasAssetNode,
    updateShotCell,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    const currentCanvas = getCanvas(content);
    setNodes((prevNodes) => {
      const previous = new Map(prevNodes.map((node) => [node.id, node]));
      const shotNodes = shots.map((shot, index) => {
        const prev = previous.get(shot.id);
        const position = currentCanvas.positions[shot.id] ?? prev?.position ?? defaultPos(index);
        const relation = getNodeRelation(shot.id, selectedNodeId, currentCanvas.edges);
        const selected = relation === "selected";
        const zIndex = getNodeZIndex(relation);
        return {
          id: shot.id,
          type: "shot",
          position,
          selected,
          zIndex,
          data: nodeData(shot, index, position),
        };
      });

      const panoramaNodes = (currentCanvas.nodes ?? []).map((node, index) => {
        const prev = previous.get(node.id);
        const position = currentCanvas.positions[node.id] ??
          prev?.position ?? {
            x: 520 + index * (PANORAMA_NODE_WIDTH + 180),
            y: 96 + index * 80,
          };
        const relation = getNodeRelation(node.id, selectedNodeId, currentCanvas.edges);
        const selected = relation === "selected";
        return {
          id: node.id,
          type: "panorama",
          position,
          selected,
          dragHandle: ".canvas-node-drag-handle",
          zIndex: getNodeZIndex(relation),
          data: panoramaNodeData(node, index, position),
        };
      });

      return [...shotNodes, ...panoramaNodes];
    });
  }, [content, nodeData, panoramaNodeData, selectedNodeId, setNodes, shots]);

  useEffect(() => {
    setEdges((prevEdges) => {
      const nextEdges = canvas.edges.map((edge) => edgeFromCanvas(edge, selectedNodeId));
      if (
        prevEdges.length === nextEdges.length &&
        prevEdges.every((edge, index) => {
          const next = nextEdges[index];
          return (
            next &&
            edge.id === next.id &&
            edge.source === next.source &&
            edge.target === next.target &&
            Boolean((edge.data as CanvasEdgeData | undefined)?.active) ===
              Boolean(next.data?.active) &&
            Boolean((edge.data as CanvasEdgeData | undefined)?.dimmed) ===
              Boolean(next.data?.dimmed)
          );
        })
      ) {
        return prevEdges;
      }
      return nextEdges;
    });
  }, [canvas.edges, selectedNodeId, setEdges]);

  const createShotAt = useCallback(
    (pos: CanvasNodePos) => {
      const shotId = addShotAtCanvas(pos);
      setSelectedNodeId(shotId);
      window.requestAnimationFrame(() => {
        flow.setCenter(pos.x + SHOT_NODE_WIDTH / 2, pos.y + SHOT_NODE_HEIGHT / 2, {
          duration: 260,
          zoom: Math.max(zoom, 0.82),
        });
      });
    },
    [addShotAtCanvas, flow, zoom]
  );

  const addAtCenter = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const center = rect
      ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 220, y: 220 };
    createShotAt({ x: center.x - SHOT_NODE_WIDTH / 2, y: center.y - SHOT_NODE_HEIGHT / 2 });
  }, [createShotAt, flow]);

  const createPanoramaAt = useCallback(
    (pos: CanvasNodePos, sourceShotId?: string) => {
      const nodeId = addCanvasAssetNode(
        {
          kind: "panorama",
          media: [],
          sourceShotId,
          status: "idle",
          settings: {
            aspectRatio: "2:1",
            model: "Fizz Image 2.0",
            outputCount: 1,
            quality: "standard",
            resolution: "2K",
          },
        },
        pos
      );
      if (sourceShotId) addCanvasEdge(sourceShotId, nodeId);
      setSelectedNodeId(nodeId);
      window.requestAnimationFrame(() => {
        flow.setCenter(pos.x + PANORAMA_NODE_WIDTH / 2, pos.y + PANORAMA_NODE_HEIGHT / 2, {
          duration: 260,
          zoom: Math.max(zoom, 0.72),
        });
      });
    },
    [addCanvasAssetNode, addCanvasEdge, flow, zoom]
  );

  const addPanoramaNode = useCallback(() => {
    if (selectedShot) {
      const index = shots.findIndex((shot) => shot.id === selectedShot.id);
      const shotPos = canvas.positions[selectedShot.id] ?? defaultPos(Math.max(index, 0));
      createPanoramaAt(
        {
          x: shotPos.x + SHOT_NODE_WIDTH + 148,
          y: shotPos.y - (PANORAMA_NODE_HEIGHT - SHOT_NODE_HEIGHT) / 2,
        },
        selectedShot.id
      );
      return;
    }

    const rect = wrapperRef.current?.getBoundingClientRect();
    const center = rect
      ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 520, y: 160 };
    createPanoramaAt({
      x: center.x - PANORAMA_NODE_WIDTH / 2,
      y: center.y - PANORAMA_NODE_HEIGHT / 2,
    });
  }, [canvas.positions, createPanoramaAt, flow, selectedShot, shots]);

  const focusShot = useCallback(
    (shotId: string) => {
      const index = shots.findIndex((shot) => shot.id === shotId);
      const pos = canvas.positions[shotId] ?? defaultPos(Math.max(index, 0));
      setSelectedNodeId(shotId);
      flow.setCenter(pos.x + SHOT_NODE_WIDTH / 2, pos.y + SHOT_NODE_HEIGHT / 2, {
        duration: 260,
        zoom: Math.max(zoom, 0.82),
      });
    },
    [canvas.positions, flow, shots, zoom]
  );

  const autoLayout = useCallback(() => {
    const shotPositions = Object.fromEntries(
      shots.map((shot, index) => [shot.id, layoutPos(index)])
    );
    const panoramaPositions = Object.fromEntries(
      assetNodes.map((node, index) => [
        node.id,
        {
          x: 520 + index * (PANORAMA_NODE_WIDTH + 180),
          y: 96 + Math.floor(index / 2) * (PANORAMA_NODE_HEIGHT + 210),
        },
      ])
    );
    const positions = { ...shotPositions, ...panoramaPositions };
    setCanvasPositions(positions);
    setNodes((current) =>
      current.map((node, index) => ({
        ...node,
        position: positions[node.id] ?? layoutPos(index),
      }))
    );
    window.requestAnimationFrame(() => flow.fitView({ padding: 0.22, maxZoom: 1, duration: 260 }));
  }, [assetNodes, flow, setCanvasPositions, setNodes, shots]);

  const handlePaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".react-flow__node")) return;
      const pos = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      createShotAt({ x: pos.x - SHOT_NODE_WIDTH / 2, y: pos.y - SHOT_NODE_HEIGHT / 2 });
    },
    [createShotAt, flow]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      let nextGuide: AlignmentGuide | null = null;
      for (const change of changes) {
        if (change.type !== "position" || !change.position || !change.dragging) continue;
        nextGuide = getAlignmentGuideForPosition({
          movingNodeId: change.id,
          nodes,
          position: change.position,
          zoom,
        });
      }

      setAlignmentGuide(nextGuide);
      onNodesChange(changes);
      const positionChanges = changes.flatMap((change) => {
        if (change.type !== "position" || !change.position) return [];
        return [{ id: change.id, position: change.position }];
      });

      if (positionChanges.length > 0) {
        const nextPositions = new Map(
          positionChanges.map((change) => [change.id, change.position])
        );
        setNodes((currentNodes) =>
          currentNodes.map((node) => {
            const position = nextPositions.get(node.id);
            if (!position) return node;

            const composerLayout = getComposerLayout(
              position,
              viewportState,
              canvasBounds,
              getNodeSizeByType(node.type)
            );
            if (sameComposerLayout(node.data.composerLayout, composerLayout)) return node;

            return {
              ...node,
              data: {
                ...node.data,
                composerLayout,
              },
            };
          })
        );
      }

      for (const change of changes) {
        if (change.type === "position" && change.dragging === false && change.position) {
          setNodePosition(change.id, change.position);
        }
      }
    },
    [canvasBounds, nodes, onNodesChange, setNodePosition, setNodes, viewportState, zoom]
  );

  const handleNodeDragStart = useCallback<OnNodeDrag<CanvasNode>>((_, node) => {
    dragEndRef.current = null;
    setDraggingNodeId(node.id);
    setAlignmentGuide(null);
  }, []);

  const handleNodeDragStop = useCallback<OnNodeDrag<CanvasNode>>((_, node) => {
    dragEndRef.current = { at: performance.now(), nodeId: node.id };
    setDraggingNodeId(null);
    setAlignmentGuide(null);
  }, []);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: CanvasNode) => {
    const dragEnd = dragEndRef.current;
    if (
      dragEnd &&
      dragEnd.nodeId === node.id &&
      performance.now() - dragEnd.at < NODE_DRAG_CLICK_SUPPRESS_MS
    ) {
      return;
    }

    setSelectedNodeId(node.id);
  }, []);

  const handleConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target || params.source === params.target) return;
      const edgeId = addCanvasEdge(params.source, params.target);
      if (edgeId) setSelectedNodeId(params.target);
    },
    [addCanvasEdge]
  );

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const edge of deleted) removeCanvasEdge(edge.id);
    },
    [removeCanvasEdge]
  );

  const handleNodesDelete = useCallback(
    (deleted: CanvasNode[]) => {
      for (const node of deleted) {
        if (node.type === "panorama") {
          removeCanvasAssetNode(node.id);
          continue;
        }
        removeShotFromCanvas(node.id);
      }
      setSelectedNodeId((current) =>
        deleted.some((node) => node.id === current) ? null : current
      );
    },
    [removeCanvasAssetNode, removeShotFromCanvas]
  );

  const handleMove = useCallback((_: unknown, viewport: Viewport) => {
    setViewportState(viewport);
  }, []);

  const handleMoveEnd = useCallback(
    (_: unknown, viewport: Viewport) => {
      setViewportState(viewport);
      setViewport(viewport);
    },
    [setViewport]
  );

  const filteredShots = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shots;
    return shots.filter((shot) => {
      const description = getCellText(shot, columnIds.description).toLowerCase();
      const dialogue = getCellText(shot, columnIds.dialogue).toLowerCase();
      const index = String(shots.indexOf(shot) + 1);
      return description.includes(q) || dialogue.includes(q) || index.includes(q);
    });
  }, [columnIds.description, columnIds.dialogue, query, shots]);

  const metrics = useMemo(() => {
    const totalDuration = shots.reduce((sum, shot) => {
      const value = getCell(shot, columnIds.duration).number;
      return sum + (typeof value === "number" ? value : 0);
    }, 0);
    const framed = shots.filter((shot) => hasMedia(shot, columnIds.image, columnIds.video)).length;
    return {
      shots: shots.length,
      totalDuration,
      framed,
      assets: assetNodes.length,
      edges: canvas.edges.length,
    };
  }, [
    assetNodes.length,
    canvas.edges.length,
    columnIds.duration,
    columnIds.image,
    columnIds.video,
    shots,
  ]);

  const hasCanvasNodes = shots.length + assetNodes.length > 0;

  return (
    <div
      className={cn(
        "grid h-[calc(100vh-56px)] min-h-[620px] grid-cols-1 overflow-hidden bg-[#0b0b0d] text-white",
        libraryOpen
          ? "lg:grid-cols-[292px_minmax(0,1fr)] xl:grid-cols-[292px_minmax(0,1fr)_348px]"
          : "xl:grid-cols-[minmax(0,1fr)_348px]"
      )}
    >
      {libraryOpen ? (
        <ShotLibrary
          columnIds={columnIds}
          filteredShots={filteredShots}
          metrics={metrics}
          query={query}
          selectedNodeId={selectedNodeId}
          shots={shots}
          onAdd={addAtCenter}
          onClose={() => setLibraryOpen(false)}
          onFocus={focusShot}
          onQueryChange={setQuery}
        />
      ) : null}

      <section ref={wrapperRef} className="relative min-w-0 overflow-hidden bg-[#09090b]">
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div className="pointer-events-auto flex max-w-full items-center gap-2">
            {!libraryOpen ? (
              <button
                type="button"
                onClick={() => setLibraryOpen(true)}
                className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#17171a]/92 text-white/72 shadow-2xl shadow-black/30 backdrop-blur-md transition-colors hover:border-white/16 hover:bg-[#202024] hover:text-white"
                aria-label={t("sbOpenShotLibrary")}
                title={t("sbOpenShotLibrary")}
              >
                <IconLayoutKanban className="size-4" />
              </button>
            ) : null}
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#17171a]/92 px-3 py-2 shadow-2xl shadow-black/30 backdrop-blur-md">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/[0.08] text-white/72">
                <IconLayoutKanban className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{t("sbCanvasTitle")}</p>
                <p className="truncate text-xs text-white/42">
                  {t("sbCanvasSubtitle")
                    .replace("{shots}", String(metrics.shots))
                    .replace("{assets}", String(metrics.assets))
                    .replace("{edges}", String(metrics.edges))}
                </p>
              </div>
            </div>
          </div>

          <div className="pointer-events-auto flex items-center gap-2 self-start">
            <button
              type="button"
              onClick={addPanoramaNode}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#17171a]/92 px-3 text-sm font-semibold text-white/72 backdrop-blur-md transition-colors hover:border-white/20 hover:text-white"
            >
              <Icon360View className="size-4" />
              <span className="hidden sm:inline">{t("sbAddPanorama")}</span>
            </button>
            <button
              type="button"
              onClick={autoLayout}
              disabled={!hasCanvasNodes}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#17171a]/92 px-3 text-sm font-semibold text-white/72 backdrop-blur-md transition-colors hover:border-white/20 hover:text-white disabled:pointer-events-none disabled:opacity-40"
            >
              <IconGridDots className="size-4" />
              <span className="hidden sm:inline">{t("sbAutoLayout")}</span>
            </button>
            <SaveBadge state={saveState} />
          </div>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onEdgesDelete={handleEdgesDelete}
          onNodesDelete={handleNodesDelete}
          onMove={handleMove}
          onMoveEnd={handleMoveEnd}
          onNodeClick={handleNodeClick}
          onNodeDragStart={handleNodeDragStart}
          onNodeDragStop={handleNodeDragStop}
          onPaneClick={() => setSelectedNodeId(null)}
          onDoubleClick={handlePaneDoubleClick}
          panOnDrag
          panOnScroll
          panOnScrollMode={PanOnScrollMode.Free}
          panOnScrollSpeed={0.9}
          zoomOnPinch
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          defaultViewport={canvas.viewport ?? { x: 0, y: 0, zoom: 1 }}
          minZoom={0.16}
          maxZoom={2.4}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={["Backspace", "Delete"]}
          className="bg-[#09090b]"
          fitView={hasCanvasNodes}
          fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
          defaultEdgeOptions={{ type: "creative", data: { direct: true } }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.15}
            color="rgba(255,255,255,0.14)"
          />
        </ReactFlow>
        <CanvasAlignmentGuides
          bounds={canvasBounds}
          guide={alignmentGuide}
          viewport={viewportState}
        />

        {!hasCanvasNodes && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6">
            <div className="pointer-events-auto flex w-full max-w-sm flex-col items-center rounded-lg border border-white/[0.08] bg-[#151518]/90 px-7 py-8 text-center shadow-2xl shadow-black/35 backdrop-blur-md">
              <div className="flex size-12 items-center justify-center rounded-lg bg-white/[0.06] text-white/55">
                <IconLayoutKanban className="size-6" />
              </div>
              <p className="mt-4 text-sm font-semibold text-white">{t("sbEmptyTitle")}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-white/42">{t("sbEmptyHint")}</p>
              <button
                type="button"
                onClick={addAtCenter}
                className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/88"
              >
                <IconPlus className="size-4" />
                {t("sbAddShot")}
              </button>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-4 left-4 z-10">
          <span className="rounded-lg border border-white/[0.08] bg-[#17171a]/90 px-2.5 py-1 text-xs font-medium tabular-nums text-white/52 backdrop-blur-md">
            {Math.round(zoom * 100)}%
          </span>
        </div>

        {hasSelectedNode ? null : (
          <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
            <div className="flex items-center gap-1 rounded-lg border border-white/[0.09] bg-[#17171a]/95 p-1.5 shadow-2xl shadow-black/35 backdrop-blur-md">
              <ToolButton label={t("sbAddShot")} onClick={addAtCenter} primary>
                <IconPlus className="size-[18px]" />
              </ToolButton>
              <ToolButton label={t("sbAddPanorama")} onClick={addPanoramaNode}>
                <Icon360View className="size-[18px]" />
              </ToolButton>
              <div className="mx-0.5 h-5 w-px bg-white/10" />
              <ToolButton label={t("sbZoomOut")} onClick={() => flow.zoomOut({ duration: 180 })}>
                <IconMinus className="size-[18px]" />
              </ToolButton>
              <ToolButton label={t("sbZoomIn")} onClick={() => flow.zoomIn({ duration: 180 })}>
                <IconPlus className="size-[18px]" />
              </ToolButton>
              <ToolButton
                label={t("sbFitView")}
                onClick={() => flow.fitView({ padding: 0.22, maxZoom: 1, duration: 240 })}
              >
                <IconMaximize className="size-[17px]" />
              </ToolButton>
              <ToolButton label={t("sbAutoLayout")} onClick={autoLayout}>
                <IconArrowsMaximize className="size-[17px]" />
              </ToolButton>
            </div>
          </div>
        )}
      </section>

      <ShotInspector
        columnIds={columnIds}
        columns={content.columns}
        selectedIndex={selectedIndex}
        shot={selectedShot}
        onAdd={addAtCenter}
        onDelete={onDeleteShot}
        onUpdateCell={updateCell}
      />

      {previewActive && previewMediaId ? (
        <StudioResultLightbox
          items={lightboxItems}
          activeId={previewMediaId}
          onClose={() => setPreviewMediaId(null)}
          onSelect={setPreviewMediaId}
        />
      ) : null}
    </div>
  );
}

function ShotLibrary({
  columnIds,
  filteredShots,
  metrics,
  query,
  selectedNodeId,
  shots,
  onAdd,
  onClose,
  onFocus,
  onQueryChange,
}: {
  columnIds: CanvasColumnIds;
  filteredShots: Shot[];
  metrics: { shots: number; totalDuration: number; framed: number; edges: number };
  query: string;
  selectedNodeId: string | null;
  shots: Shot[];
  onAdd: () => void;
  onClose: () => void;
  onFocus: (shotId: string) => void;
  onQueryChange: (value: string) => void;
}) {
  const t = useTranslations("fizzStudio");

  return (
    <aside className="hidden min-h-0 flex-col border-r border-white/[0.07] bg-[#101013] lg:flex">
      <div className="border-b border-white/[0.07] px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-white/34">{t("sbLibraryEyebrow")}</p>
            <h2 className="mt-1 truncate text-lg font-semibold text-white">
              {t("sbLibraryTitle")}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onAdd}
              className="flex size-9 items-center justify-center rounded-lg bg-white/[0.08] text-white/72 transition-colors hover:bg-white/[0.12] hover:text-white"
              aria-label={t("sbAddShot")}
              title={t("sbAddShot")}
            >
              <IconPlus className="size-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex size-9 items-center justify-center rounded-lg text-white/42 transition-colors hover:bg-white/[0.07] hover:text-white/75"
              aria-label={t("sbCollapseShotLibrary")}
              title={t("sbCollapseShotLibrary")}
            >
              <IconChevronDown className="size-4 rotate-90" />
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <MetricCell label={t("sbMetricShots")} value={String(metrics.shots)} />
          <MetricCell
            label={t("sbMetricDuration")}
            value={`${metrics.totalDuration}${t("sbDurationUnit")}`}
          />
          <MetricCell label={t("sbMetricFrames")} value={`${metrics.framed}/${metrics.shots}`} />
          <MetricCell label={t("sbMetricLinks")} value={String(metrics.edges)} />
        </div>

        <label className="mt-4 flex h-10 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-white/42 focus-within:border-white/18 focus-within:text-white/62">
          <IconSearch className="size-4 shrink-0" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("sbSearchShots")}
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/28"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {filteredShots.length > 0 ? (
          <div className="space-y-1.5">
            {filteredShots.map((shot) => {
              const index = shots.findIndex((item) => item.id === shot.id);
              return (
                <ShotListItem
                  key={shot.id}
                  columnIds={columnIds}
                  index={index}
                  selected={selectedNodeId === shot.id}
                  shot={shot}
                  onClick={() => onFocus(shot.id)}
                />
              );
            })}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <IconSearch className="size-6 text-white/18" />
            <p className="mt-3 text-sm font-medium text-white/48">{t("sbNoSearchResults")}</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.045] px-3 py-2">
      <p className="text-[11px] font-medium text-white/34">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-white/82">{value}</p>
    </div>
  );
}

function ShotListItem({
  columnIds,
  index,
  selected,
  shot,
  onClick,
}: {
  columnIds: CanvasColumnIds;
  index: number;
  selected: boolean;
  shot: Shot;
  onClick: () => void;
}) {
  const t = useTranslations("fizzStudio");
  const cover = getCoverUrl(shot, columnIds.image);
  const description = getCellText(shot, columnIds.description) || t("sbDescriptionPlaceholder");
  const duration = getCell(shot, columnIds.duration).number;
  const movement = displayValue(getCell(shot, columnIds.movement).text, t);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
        selected
          ? "bg-white/[0.08] text-white ring-1 ring-inset ring-white/[0.1]"
          : "text-white/62 hover:bg-white/[0.06] hover:text-white"
      )}
    >
      <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-md bg-black/35 ring-1 ring-inset ring-white/[0.07]">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <IconPhoto className="size-5 text-white/18" />
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white/80">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-xs font-medium leading-snug">{description}</p>
        <div className="mt-1.5 flex min-w-0 items-center gap-2 text-[11px] text-white/34">
          {typeof duration === "number" ? (
            <span className="inline-flex items-center gap-1">
              <IconClock className="size-3" />
              {duration}
              {t("sbDurationUnit")}
            </span>
          ) : null}
          {movement ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <IconRoute className="size-3 shrink-0" />
              <span className="truncate">{movement}</span>
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function ShotInspector({
  columnIds,
  columns,
  selectedIndex,
  shot,
  onAdd,
  onDelete,
  onUpdateCell,
}: {
  columnIds: CanvasColumnIds;
  columns: StoryboardColumn[];
  selectedIndex: number;
  shot: Shot | null;
  onAdd: () => void;
  onDelete: (shotId: string) => void;
  onUpdateCell: (shotId: string, columnId: string, cell: ShotCell) => void;
}) {
  const t = useTranslations("fizzStudio");
  const shotSizeColumn = columns.find((column) => column.id === columnIds.shotSize);
  const movementColumn = columns.find((column) => column.id === columnIds.movement);

  if (!shot) {
    return (
      <aside className="hidden min-h-0 flex-col border-l border-white/[0.07] bg-[#101013] xl:flex">
        <div className="flex flex-1 flex-col items-center justify-center px-7 text-center">
          <div className="flex size-12 items-center justify-center rounded-lg bg-white/[0.05] text-white/28">
            <IconVideo className="size-6" />
          </div>
          <p className="mt-4 text-sm font-semibold text-white/62">{t("sbInspectorEmptyTitle")}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-white/36">
            {t("sbInspectorEmptyHint")}
          </p>
          <button
            type="button"
            onClick={onAdd}
            className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/88"
          >
            <IconPlus className="size-4" />
            {t("sbAddShot")}
          </button>
        </div>
      </aside>
    );
  }

  const cover = getCoverUrl(shot, columnIds.image);
  const description = getCell(shot, columnIds.description).richText ?? "";
  const dialogue = getCell(shot, columnIds.dialogue).richText ?? "";
  const duration = getCell(shot, columnIds.duration).number;
  const shotSize = getCell(shot, columnIds.shotSize).text ?? "";
  const movement = getCell(shot, columnIds.movement).text ?? "";

  return (
    <aside className="hidden min-h-0 flex-col border-l border-white/[0.07] bg-[#101013] xl:flex">
      <div className="border-b border-white/[0.07] px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-white/34">
              {t("sbInspectorEyebrow")}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">
              {t("sbShot")} #{String(selectedIndex + 1).padStart(2, "0")}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onDelete(shot.id)}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white/35 transition-colors hover:bg-white/[0.07] hover:text-white/75"
            aria-label={t("sbDeleteShot")}
            title={t("sbDeleteShot")}
          >
            <IconTrash className="size-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="overflow-hidden rounded-lg bg-[#0a0a0c] ring-1 ring-inset ring-white/[0.07]">
          <div className="aspect-video">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt="" className="size-full object-cover" />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-2 text-white/24">
                <IconPhoto className="size-7" />
                <span className="text-xs font-medium">{t("sbNoFrame")}</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-white/[0.07] px-3 py-2 text-xs text-white/38">
            <span>{t("sbFrameSlot")}</span>
            <span>{t("sbMediaPending")}</span>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <InspectorTextarea
            label={t("sbColDescription")}
            value={description}
            placeholder={t("sbDescriptionPlaceholder")}
            onChange={(value) => onUpdateCell(shot.id, columnIds.description, { richText: value })}
          />
          <InspectorTextarea
            label={t("sbColDialogue")}
            value={dialogue}
            placeholder={t("sbDialoguePlaceholder")}
            onChange={(value) => onUpdateCell(shot.id, columnIds.dialogue, { richText: value })}
          />

          <div className="grid grid-cols-2 gap-3">
            <InspectorNumber
              label={t("sbColDuration")}
              value={typeof duration === "number" ? duration : ""}
              suffix={t("sbDurationUnit")}
              onChange={(value) =>
                onUpdateCell(
                  shot.id,
                  columnIds.duration,
                  value === "" ? {} : { number: Number(value) }
                )
              }
            />
            <InspectorSelect
              label={t("sbColShotSize")}
              options={shotSizeColumn?.options ?? []}
              value={shotSize}
              onChange={(value) => onUpdateCell(shot.id, columnIds.shotSize, { text: value })}
            />
          </div>

          <InspectorSelect
            label={t("sbColMovement")}
            options={movementColumn?.options ?? []}
            value={movement}
            onChange={(value) => onUpdateCell(shot.id, columnIds.movement, { text: value })}
          />

          <div className="rounded-lg bg-white/[0.045] p-3">
            <div className="flex items-center gap-2">
              <IconWand className="size-4 text-amber-300/75" />
              <p className="text-sm font-semibold text-white/78">{t("sbAiPanelTitle")}</p>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-white/36">{t("sbAiPanelHint")}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled
                className="inline-flex h-8 items-center justify-center rounded-md bg-white/[0.06] px-3 text-xs font-semibold text-white/28"
              >
                {t("sbGenerateFrame")}
              </button>
              <button
                type="button"
                disabled
                className="inline-flex h-8 items-center justify-center rounded-md bg-white/[0.06] px-3 text-xs font-semibold text-white/28"
              >
                {t("sbGenerateMotion")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function InspectorTextarea({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-white/42">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        className="mt-1.5 w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 py-2.5 text-sm leading-relaxed text-white outline-none placeholder:text-white/24 focus:border-white/18 focus:bg-white/[0.065]"
      />
    </label>
  );
}

function InspectorNumber({
  label,
  suffix,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number | "";
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-white/42">{label}</span>
      <div className="mt-1.5 flex h-10 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 focus-within:border-white/18 focus-within:bg-white/[0.065]">
        <input
          type="number"
          min="0"
          step="0.5"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium tabular-nums text-white outline-none"
        />
        <span className="text-xs font-medium text-white/30">{suffix}</span>
      </div>
    </label>
  );
}

function InspectorSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("fizzStudio");

  return (
    <label className="block">
      <span className="text-xs font-semibold text-white/42">{label}</span>
      <NativeSelect
        value={value}
        onChange={onChange}
        className="mt-1.5 h-10 w-full rounded-lg border border-white/[0.08] bg-[#17171a] px-3 text-sm font-medium text-white outline-none focus:border-white/18"
      >
        <option value="">{t("sbSelectEmpty")}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {displayValue(option, t)}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

function ToolButton({
  children,
  label,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-9 items-center justify-center rounded-md transition-colors",
        primary
          ? "bg-white text-black hover:bg-white/90"
          : "text-white/55 hover:bg-white/10 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const t = useTranslations("fizzStudio");
  if (state === "idle") return <span />;
  const map = {
    saving: {
      icon: <IconLoader2 className="size-3.5 animate-spin" />,
      label: t("sbSaving"),
      cls: "text-white/56",
    },
    saved: {
      icon: <IconCheck className="size-3.5" />,
      label: t("sbSaved"),
      cls: "text-emerald-300/88",
    },
    error: {
      icon: <IconLoader2 className="size-3.5 animate-spin" />,
      label: t("sbSaveError"),
      cls: "text-amber-300/88",
    },
  } as const;
  const item = map[state];
  return (
    <span
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#17171a]/92 px-3 text-xs font-semibold backdrop-blur-md",
        item.cls
      )}
    >
      {item.icon}
      {item.label}
    </span>
  );
}

export function StoryboardCanvas({ doc }: { doc: FizzDocument }) {
  return (
    <ReactFlowProvider>
      <CanvasInner doc={doc} />
    </ReactFlowProvider>
  );
}
