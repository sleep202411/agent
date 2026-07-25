"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ViewportPortal,
  useReactFlow,
  useViewport,
  type Node,
  type NodeChange,
  type OnNodeDrag,
} from "@xyflow/react";
import { IconBoxMultiple, IconBoxOff, IconCheck, IconGripHorizontal } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { GlassRim } from "@/components/ui/glass-rim";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CANVAS_GROUP_COLORS,
  DEFAULT_CANVAS_GROUP_COLOR,
  type CanvasGroup,
  type CanvasGroupColor,
} from "@/lib/canvas-core/types";
import { cn } from "@/lib/utils";
import {
  canvasGroupAtPoint,
  canvasGroupBounds,
  canvasGroupDropTarget,
  canvasGroupingAction,
  canvasGroupPositionChanges,
  type CanvasGroupingAction,
} from "./canvas-groups";

gsap.registerPlugin(useGSAP);

const GROUP_TOOLBAR_MIN_BOTTOM_Y = 62;
const GROUP_LABEL_OFFSET_X = 8;
const GROUP_LABEL_OFFSET_Y = 30;

const GROUP_COLOR_TOKENS = {
  slate: {
    swatch: "#94A3B8",
    surface: "rgb(148 163 184 / 0.04)",
    surfaceActive: "rgb(148 163 184 / 0.07)",
    boundary: "rgb(148 163 184 / 0.40)",
    boundaryActive: "rgb(203 213 225 / 0.72)",
  },
  red: {
    swatch: "#EF4444",
    surface: "rgb(239 68 68 / 0.04)",
    surfaceActive: "rgb(239 68 68 / 0.07)",
    boundary: "rgb(248 113 113 / 0.42)",
    boundaryActive: "rgb(252 165 165 / 0.76)",
  },
  orange: {
    swatch: "#F97316",
    surface: "rgb(249 115 22 / 0.04)",
    surfaceActive: "rgb(249 115 22 / 0.07)",
    boundary: "rgb(251 146 60 / 0.42)",
    boundaryActive: "rgb(253 186 116 / 0.76)",
  },
  amber: {
    swatch: "#F59E0B",
    surface: "rgb(245 158 11 / 0.04)",
    surfaceActive: "rgb(245 158 11 / 0.07)",
    boundary: "rgb(251 191 36 / 0.42)",
    boundaryActive: "rgb(253 230 138 / 0.76)",
  },
  green: {
    swatch: "#22C55E",
    surface: "rgb(34 197 94 / 0.04)",
    surfaceActive: "rgb(34 197 94 / 0.07)",
    boundary: "rgb(74 222 128 / 0.42)",
    boundaryActive: "rgb(134 239 172 / 0.76)",
  },
  cyan: {
    swatch: "#06B6D4",
    surface: "rgb(6 182 212 / 0.04)",
    surfaceActive: "rgb(6 182 212 / 0.07)",
    boundary: "rgb(34 211 238 / 0.42)",
    boundaryActive: "rgb(103 232 249 / 0.76)",
  },
  blue: {
    swatch: "#3B82F6",
    surface: "rgb(59 130 246 / 0.04)",
    surfaceActive: "rgb(59 130 246 / 0.07)",
    boundary: "rgb(96 165 250 / 0.42)",
    boundaryActive: "rgb(147 197 253 / 0.76)",
  },
  indigo: {
    swatch: "#6366F1",
    surface: "rgb(99 102 241 / 0.04)",
    surfaceActive: "rgb(99 102 241 / 0.07)",
    boundary: "rgb(129 140 248 / 0.42)",
    boundaryActive: "rgb(165 180 252 / 0.76)",
  },
  pink: {
    swatch: "#EC4899",
    surface: "rgb(236 72 153 / 0.04)",
    surfaceActive: "rgb(236 72 153 / 0.07)",
    boundary: "rgb(244 114 182 / 0.42)",
    boundaryActive: "rgb(249 168 212 / 0.76)",
  },
} as const satisfies Record<
  CanvasGroupColor,
  {
    swatch: string;
    surface: string;
    surfaceActive: string;
    boundary: string;
    boundaryActive: string;
  }
>;

export interface CanvasGroupingController {
  groups: readonly CanvasGroup[];
  toggleGroup: (nodeIds: string[]) => string | null;
  addNodesToGroup: (groupId: string, nodeIds: string[]) => boolean;
  removeNodesFromGroups: (nodeIds: string[]) => boolean;
  setGroupColor: (groupId: string, color: CanvasGroupColor) => void;
  isNodeGroupable?: (nodeId: string) => boolean;
}

interface CanvasNodeGroupingAction {
  groupId: string;
  remove: () => boolean;
}

const CanvasGroupingActionsContext = createContext<CanvasGroupingController | null>(null);

export function CanvasGroupingActionsProvider({
  controller,
  canEdit,
  children,
}: {
  controller?: CanvasGroupingController;
  canEdit: boolean;
  children: ReactNode;
}) {
  return (
    <CanvasGroupingActionsContext.Provider value={canEdit ? (controller ?? null) : null}>
      {children}
    </CanvasGroupingActionsContext.Provider>
  );
}

export function useCanvasNodeGroupingAction(nodeId: string): CanvasNodeGroupingAction | null {
  const controller = useContext(CanvasGroupingActionsContext);
  return useMemo(() => {
    const group = controller?.groups.find((candidate) => candidate.nodeIds.includes(nodeId));
    if (!controller || !group) return null;
    return {
      groupId: group.id,
      remove: () => controller.removeNodesFromGroups([nodeId]),
    };
  }, [controller, nodeId]);
}

function draggedCanvasNodeIds(node: Node, draggedNodes: Node[]) {
  return [...new Set([node.id, ...draggedNodes.map((draggedNode) => draggedNode.id)])];
}

function useCanvasNodeGroupDrop({
  controller,
  groups,
  nodes,
  canEdit,
}: {
  controller?: CanvasGroupingController;
  groups: readonly CanvasGroup[];
  nodes: readonly Node[];
  canEdit: boolean;
}) {
  const draggedNodeIdsRef = useRef<string[] | null>(null);
  const dropTargetGroupIdRef = useRef<string | null>(null);
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);

  const updateTarget = useCallback((groupId: string | null) => {
    dropTargetGroupIdRef.current = groupId;
    setDropTargetGroupId((current) => (current === groupId ? current : groupId));
  }, []);

  const beginNodeDrag = useCallback<OnNodeDrag>(
    (_event, node, draggedNodes) => {
      if (!canEdit || !controller) return;
      const nodeIds = draggedCanvasNodeIds(node, draggedNodes);
      const canGroup = controller.isNodeGroupable ?? (() => true);
      draggedNodeIdsRef.current = nodeIds.every(canGroup) ? nodeIds : [];
      updateTarget(null);
    },
    [canEdit, controller, updateTarget]
  );

  const moveNode = useCallback<OnNodeDrag>(
    (_event, node, draggedNodes) => {
      if (!canEdit || !controller) return;
      const nodeIds = draggedNodeIdsRef.current ?? draggedCanvasNodeIds(node, draggedNodes);
      if (nodeIds.length === 0) {
        updateTarget(null);
        return;
      }
      const target = canvasGroupDropTarget(groups, nodes, node, nodeIds);
      updateTarget(target?.id ?? null);
    },
    [canEdit, controller, groups, nodes, updateTarget]
  );

  const endNodeDrag = useCallback<OnNodeDrag>(() => {
    const nodeIds = draggedNodeIdsRef.current ?? [];
    const targetGroupId = dropTargetGroupIdRef.current;
    draggedNodeIdsRef.current = null;
    updateTarget(null);
    if (!canEdit || !controller || !targetGroupId || nodeIds.length === 0) return;
    controller.addNodesToGroup(targetGroupId, nodeIds);
  }, [canEdit, controller, updateTarget]);

  useEffect(
    () => () => {
      draggedNodeIdsRef.current = null;
      dropTargetGroupIdRef.current = null;
    },
    []
  );

  return {
    dropTargetGroupId,
    nodeHandlers: {
      onNodeDragStart: beginNodeDrag,
      onNodeDrag: moveNode,
      onNodeDragStop: endNodeDrag,
    },
  };
}

function useCanvasGroupDrag({
  groups,
  nodes,
  canEdit,
  onNodesChange,
  selectNodes,
  onSelectGroup,
}: {
  groups: readonly CanvasGroup[];
  nodes: readonly Node[];
  canEdit: boolean;
  onNodesChange: (changes: NodeChange[]) => void;
  selectNodes: (nodeIds: string[]) => void;
  onSelectGroup: (groupId: string | null) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const dragRef = useRef<{
    pointerId: number;
    start: { x: number; y: number };
    nodes: Node[];
    nodeIds: string[];
    moved: boolean;
  } | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);

  const beginGroupDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, group: CanvasGroup) => {
      if (!canEdit || event.button !== 0) return;
      const members = new Set(group.nodeIds);
      const memberNodes = nodes.filter((node) => members.has(node.id));
      if (memberNodes.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      selectNodes([]);
      onSelectGroup(group.id);
      dragRef.current = {
        pointerId: event.pointerId,
        start: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        nodes: memberNodes,
        nodeIds: [...group.nodeIds],
        moved: false,
      };
      setDraggingGroupId(group.id);
      setHoveredGroupId(group.id);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [canEdit, nodes, onSelectGroup, screenToFlowPosition, selectNodes]
  );

  const moveGroup = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        if (!canEdit || !(event.target instanceof Element)) {
          setHoveredGroupId(null);
          return;
        }
        if (
          event.target.closest(
            ".react-flow__node, .react-flow__edge, button, input, textarea, select, [data-canvas-native-pointer]"
          )
        ) {
          setHoveredGroupId(null);
          return;
        }
        const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const hit = canvasGroupAtPoint(groups, nodes, point);
        setHoveredGroupId((current) => (current === hit?.id ? current : (hit?.id ?? null)));
        return;
      }

      const current = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const delta = {
        x: current.x - drag.start.x,
        y: current.y - drag.start.y,
      };
      if (!drag.moved && Math.abs(delta.x) < 0.5 && Math.abs(delta.y) < 0.5) return;
      drag.moved = true;
      event.preventDefault();
      event.stopPropagation();
      onNodesChange(canvasGroupPositionChanges(drag.nodes, drag.nodeIds, delta, true));
    },
    [canEdit, groups, nodes, onNodesChange, screenToFlowPosition]
  );

  const endGroupDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDraggingGroupId(null);
      event.preventDefault();
      event.stopPropagation();
      if (drag.moved) {
        const current = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        onNodesChange(
          canvasGroupPositionChanges(
            drag.nodes,
            drag.nodeIds,
            {
              x: current.x - drag.start.x,
              y: current.y - drag.start.y,
            },
            false
          )
        );
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [onNodesChange, screenToFlowPosition]
  );

  const beginGroupDragFromCanvas = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!canEdit || event.button !== 0 || !(event.target instanceof Element)) return;
      if (event.target.closest(".react-flow__node")) {
        onSelectGroup(null);
        return;
      }
      if (
        event.target.closest(
          ".react-flow__edge, button, input, textarea, select, [data-canvas-native-pointer]"
        )
      ) {
        return;
      }
      const canvas = event.target.closest<HTMLElement>("[data-canvas-tool]");
      if (canvas?.dataset.canvasTool !== "select") return;
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const hit = canvasGroupAtPoint(groups, nodes, point);
      if (hit) {
        beginGroupDrag(event, hit);
        return;
      }
      onSelectGroup(null);
    },
    [beginGroupDrag, canEdit, groups, nodes, onSelectGroup, screenToFlowPosition]
  );

  const leaveCanvas = useCallback(() => {
    if (!dragRef.current) setHoveredGroupId(null);
  }, []);

  return {
    draggingGroupId,
    hoveredGroupId,
    beginGroupDrag,
    beginGroupDragFromCanvas,
    moveGroup,
    endGroupDrag,
    leaveCanvas,
  };
}

function CanvasGroupVisual({
  group,
  nodes,
  activeGroupId,
  canEdit,
  draggingGroupId,
  dropTargetGroupId,
  onBeginGroupDrag,
}: {
  group: CanvasGroup;
  nodes: readonly Node[];
  activeGroupId: string | null;
  canEdit: boolean;
  draggingGroupId: string | null;
  dropTargetGroupId: string | null;
  onBeginGroupDrag: (event: ReactPointerEvent<HTMLElement>, group: CanvasGroup) => void;
}) {
  const t = useTranslations("canvas.groups");
  const { zoom } = useViewport();
  const feedbackScopeRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const bounds = canvasGroupBounds(nodes, group.nodeIds);
  const active = group.id === activeGroupId;
  const dragging = draggingGroupId === group.id;
  const dropTarget = dropTargetGroupId === group.id;
  const color = group.color ?? DEFAULT_CANVAS_GROUP_COLOR;
  const token = GROUP_COLOR_TOKENS[color];
  const boundary = active || dragging || dropTarget ? token.boundaryActive : token.boundary;

  useGSAP(
    () => {
      const feedback = feedbackRef.current;
      if (!feedback) return;
      if (!dropTarget) {
        gsap.set(feedback, { x: 0, scale: 1 });
        return;
      }
      const media = gsap.matchMedia();
      media.add({ reduceMotion: "(prefers-reduced-motion: reduce)" }, (context) => {
        if (context.conditions?.reduceMotion) {
          gsap.set(feedback, { x: 0, scale: 1 });
          return;
        }
        gsap.fromTo(
          feedback,
          { x: -3, scale: 0.998 },
          {
            x: 0,
            scale: 1,
            duration: 0.42,
            ease: "elastic.out(1, 0.34)",
            overwrite: true,
          }
        );
      });
      return () => media.revert();
    },
    {
      dependencies: [dropTarget],
      scope: feedbackScopeRef,
      revertOnUpdate: true,
    }
  );

  if (!bounds) return null;
  return (
    <div>
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 -z-10 rounded-[24px] transition-colors duration-150"
        style={{
          width: bounds.width,
          height: bounds.height,
          transform: `translate(${bounds.x}px, ${bounds.y}px)`,
          backgroundColor: active || dragging || dropTarget ? token.surfaceActive : token.surface,
        }}
      />
      <div
        ref={feedbackScopeRef}
        className="pointer-events-none absolute top-0 left-0"
        style={{
          width: bounds.width,
          height: bounds.height,
          transform: `translate(${bounds.x}px, ${bounds.y}px)`,
        }}
      >
        <div
          ref={feedbackRef}
          data-testid={
            dropTarget
              ? "canvas-group-drop-target"
              : active
                ? "selected-canvas-group"
                : "canvas-group"
          }
          data-group-drop-target={dropTarget || undefined}
          className={cn(
            "relative size-full rounded-[24px] transition-[box-shadow] duration-150",
            dropTarget && "will-change-transform"
          )}
          style={{
            boxShadow: dropTarget
              ? `inset 0 0 0 1.5px ${boundary}, 0 0 34px ${token.swatch}38`
              : active || dragging
                ? `inset 0 0 0 1px ${boundary}, 0 18px 48px rgb(0 0 0 / 0.18)`
                : `inset 0 0 0 1px ${boundary}`,
          }}
        >
          <button
            type="button"
            data-testid="canvas-group-drag-handle"
            aria-label={t("dragLabel", { count: group.nodeIds.length })}
            aria-pressed={active}
            tabIndex={active ? -1 : 0}
            disabled={!canEdit}
            onPointerDown={(event) => onBeginGroupDrag(event, group)}
            className={cn(
              "nodrag nopan nowheel pointer-events-auto absolute flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[10px] font-medium tracking-[0.02em] text-white/48 transition focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none disabled:cursor-default",
              canEdit && "cursor-grab hover:bg-white/[0.06] hover:text-white/82",
              dragging && "cursor-grabbing bg-white/[0.08] text-white/90",
              dropTarget && "bg-white/[0.1] text-white/92",
              active && "pointer-events-none opacity-0"
            )}
            style={{
              left: GROUP_LABEL_OFFSET_X / zoom,
              top: -GROUP_LABEL_OFFSET_Y / zoom,
              transform: `scale(${1 / zoom})`,
              transformOrigin: "top left",
            }}
          >
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ backgroundColor: token.swatch }}
            />
            <IconGripHorizontal className="size-3.5" stroke={1.8} />
            <span>{t("label")}</span>
            <span className="tabular-nums text-white/34">{group.nodeIds.length}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function CanvasGroupLayer({
  groups,
  nodes,
  activeGroupId,
  canEdit,
  draggingGroupId,
  dropTargetGroupId,
  onBeginGroupDrag,
}: {
  groups: readonly CanvasGroup[];
  nodes: readonly Node[];
  activeGroupId: string | null;
  canEdit: boolean;
  draggingGroupId: string | null;
  dropTargetGroupId: string | null;
  onBeginGroupDrag: (event: ReactPointerEvent<HTMLElement>, group: CanvasGroup) => void;
}) {
  return (
    <ViewportPortal>
      {groups.map((group) => (
        <CanvasGroupVisual
          key={group.id}
          group={group}
          nodes={nodes}
          activeGroupId={activeGroupId}
          canEdit={canEdit}
          draggingGroupId={draggingGroupId}
          dropTargetGroupId={dropTargetGroupId}
          onBeginGroupDrag={onBeginGroupDrag}
        />
      ))}
    </ViewportPortal>
  );
}

function CanvasGroupingToolbar({
  action,
  nodes,
  onToggle,
  onSetColor,
}: {
  action: CanvasGroupingAction | null;
  nodes: readonly Node[];
  onToggle: () => void;
  onSetColor: (groupId: string, color: CanvasGroupColor) => void;
}) {
  const t = useTranslations("canvas.groups");
  const [colorOpen, setColorOpen] = useState(false);
  const viewport = useViewport();
  if (!action) return null;
  const bounds = canvasGroupBounds(nodes, action.nodeIds);
  if (!bounds) return null;
  const ungroup = action.type === "ungroup";
  const label = t(ungroup ? "ungroup" : "group");
  const Icon = ungroup ? IconBoxOff : IconBoxMultiple;
  const color =
    action.type === "ungroup"
      ? (action.color ?? DEFAULT_CANVAS_GROUP_COLOR)
      : DEFAULT_CANVAS_GROUP_COLOR;

  return (
    <div
      className="absolute z-[85] -translate-x-1/2 -translate-y-full"
      style={{
        left: viewport.x + (bounds.x + bounds.width / 2) * viewport.zoom,
        top: Math.max(GROUP_TOOLBAR_MIN_BOTTOM_Y, viewport.y + bounds.y * viewport.zoom - 14),
      }}
    >
      <div
        data-testid="canvas-group-toolbar"
        className="relative flex items-center rounded-2xl bg-[oklch(0.205_0_0)]/94 p-1.5 shadow-xl shadow-black/45 backdrop-blur-2xl"
      >
        <GlassRim className="opacity-70" />
        {action.type === "ungroup" ? (
          <>
            <Popover open={colorOpen} onOpenChange={setColorOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="canvas-group-color-trigger"
                  className="nodrag nopan nowheel relative grid size-10 place-items-center rounded-xl transition hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-white/55 focus-visible:outline-none"
                  aria-label={t("color")}
                >
                  <span
                    className="size-5 rounded-full shadow-[0_0_0_1px_rgb(255_255_255/0.14)]"
                    style={{ backgroundColor: GROUP_COLOR_TOKENS[color].swatch }}
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="start"
                sideOffset={10}
                className="nodrag nopan nowheel !z-[180] w-[248px] gap-2 rounded-2xl bg-[oklch(0.205_0_0)]/98 p-3 shadow-2xl shadow-black/60 backdrop-blur-2xl"
              >
                <p className="px-1 text-[11px] font-medium text-white/52">{t("color")}</p>
                <div role="radiogroup" aria-label={t("color")} className="grid grid-cols-5 gap-2">
                  {CANVAS_GROUP_COLORS.map((candidate) => {
                    const selected = candidate === color;
                    return (
                      <button
                        key={candidate}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={t(`colors.${candidate}`)}
                        onClick={() => {
                          onSetColor(action.groupId, candidate);
                          setColorOpen(false);
                        }}
                        className="relative grid size-10 place-items-center rounded-xl transition hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/55 focus-visible:outline-none"
                      >
                        <span
                          className="grid size-7 place-items-center rounded-full shadow-[0_0_0_1px_rgb(255_255_255/0.12)]"
                          style={{ backgroundColor: GROUP_COLOR_TOKENS[candidate].swatch }}
                        >
                          {selected ? (
                            <IconCheck className="size-4 text-white drop-shadow-sm" stroke={2.2} />
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
            <span aria-hidden className="relative mx-1 h-6 w-px bg-white/[0.08]" />
          </>
        ) : null}
        <button
          type="button"
          data-testid="canvas-group-toggle"
          onClick={onToggle}
          className="nodrag nopan nowheel relative flex h-10 items-center gap-2.5 rounded-xl px-3 text-[13px] font-medium text-white/78 transition hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-white/55 focus-visible:outline-none"
          aria-label={`${label}, ${t("shortcut")}`}
        >
          <Icon className="size-[18px]" stroke={1.7} />
          <span>{label}</span>
          <kbd className="ml-1 rounded-md bg-black/22 px-1.5 py-0.5 font-sans text-[10px] font-medium tracking-wide text-white/38">
            {t("shortcut")}
          </kbd>
        </button>
      </div>
    </div>
  );
}

export function useCanvasGrouping({
  controller,
  nodes,
  canEdit,
  onNodesChange,
  selectNodes,
}: {
  controller?: CanvasGroupingController;
  nodes: readonly Node[];
  canEdit: boolean;
  onNodesChange: (changes: NodeChange[]) => void;
  selectNodes: (nodeIds: string[]) => void;
}) {
  const emptyGroups = useMemo<readonly CanvasGroup[]>(() => [], []);
  const groups = controller?.groups ?? emptyGroups;
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const selectedNodeIds = useMemo(
    () => nodes.filter((node) => node.selected).map((node) => node.id),
    [nodes]
  );
  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId]
  );
  const action = useMemo<CanvasGroupingAction | null>(() => {
    if (!controller) return null;
    if (selectedGroup) {
      return {
        type: "ungroup",
        groupId: selectedGroup.id,
        nodeIds: [...selectedGroup.nodeIds],
        color: selectedGroup.color,
      };
    }
    const canGroup = controller.isNodeGroupable ?? (() => true);
    return selectedNodeIds.every(canGroup) ? canvasGroupingAction(groups, selectedNodeIds) : null;
  }, [controller, groups, selectedGroup, selectedNodeIds]);
  const activeGroupId = action?.type === "ungroup" ? action.groupId : null;
  const drag = useCanvasGroupDrag({
    groups,
    nodes,
    canEdit: canEdit && Boolean(controller),
    onNodesChange,
    selectNodes,
    onSelectGroup: setSelectedGroupId,
  });
  const nodeDrop = useCanvasNodeGroupDrop({
    controller,
    groups,
    nodes,
    canEdit: canEdit && Boolean(controller),
  });
  const toggleSelectedGroup = useCallback(() => {
    if (!action || !canEdit || !controller) return;
    setSelectedGroupId(controller.toggleGroup(action.nodeIds));
  }, [action, canEdit, controller]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !canEdit ||
        !controller ||
        !action ||
        event.altKey ||
        event.shiftKey ||
        (!event.ctrlKey && !event.metaKey) ||
        event.key.toLowerCase() !== "g" ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, [contenteditable="true"], [role="textbox"]'
          ) != null)
      ) {
        return;
      }
      event.preventDefault();
      toggleSelectedGroup();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [action, canEdit, controller, toggleSelectedGroup]);

  return {
    action,
    dropTargetGroup: groups.find((group) => group.id === nodeDrop.dropTargetGroupId) ?? null,
    draggingGroupId: drag.draggingGroupId,
    hoveredGroupId: drag.hoveredGroupId,
    nodeHandlers: nodeDrop.nodeHandlers,
    containerHandlers: {
      onPointerDownCapture: drag.beginGroupDragFromCanvas,
      onPointerMoveCapture: drag.moveGroup,
      onPointerUpCapture: drag.endGroupDrag,
      onPointerCancelCapture: drag.endGroupDrag,
      onLostPointerCapture: drag.endGroupDrag,
      onPointerLeave: drag.leaveCanvas,
    },
    viewportLayer: controller ? (
      <CanvasGroupLayer
        groups={groups}
        nodes={nodes}
        activeGroupId={activeGroupId}
        canEdit={canEdit}
        draggingGroupId={drag.draggingGroupId}
        dropTargetGroupId={nodeDrop.dropTargetGroupId}
        onBeginGroupDrag={drag.beginGroupDrag}
      />
    ) : null,
    toolbar: controller ? (
      <CanvasGroupingToolbar
        action={action}
        nodes={nodes}
        onToggle={toggleSelectedGroup}
        onSetColor={controller.setGroupColor}
      />
    ) : null,
  };
}
