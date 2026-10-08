"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  size,
  useDismiss,
  useFloating,
  useHover,
  useInteractions,
} from "@floating-ui/react";
import {
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import {
  IconCheck,
  IconCurrentLocation,
  IconLock,
  IconMapRoute,
  IconPhotoOff,
  IconPlayerPlay,
  IconX,
} from "@tabler/icons-react";
import type {
  ExperienceJourneyMapGraph,
  ExperienceJourneyMapNode,
} from "./experience-journey-model";
import type { ExperienceJourneyMapCopy } from "./experience-player-copy";
import { classNames } from "./class-names";

export interface ExperienceJourneyMapProps {
  graph: ExperienceJourneyMapGraph;
  currentSceneId: string;
  /** Details are read only for explored nodes; unreached footage is never requested. */
  nodeDetails?: Readonly<Record<string, { title?: string; thumbnailUrl?: string }>>;
  copy: ExperienceJourneyMapCopy;
  onClose: () => void;
  onReplay: (sceneId: string) => void;
  replayPending?: boolean;
  error?: string;
}

const NODE_WIDTH = 208;
const NODE_HEIGHT = 120;
const COLUMN_GAP = 88;
const ROW_GAP = 44;
const CONTROL =
  "min-h-11 rounded-full outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none";
type JourneyNodeData = {
  node: ExperienceJourneyMapNode;
  title: string;
  thumbnailUrl?: string;
  current: boolean;
  replayPending: boolean;
  copy: ExperienceJourneyMapCopy;
  onReplay: (sceneId: string) => void;
  hintId: string;
  onMysteryHint: (
    sceneId: string,
    trigger: HTMLElement,
    action: MysteryHintAction,
    event: Event
  ) => void;
};
type MysteryHintAction = "hover" | "focus" | "press" | "leave" | "blur";
type MysteryHint = {
  sceneId: string;
  trigger: HTMLElement;
  mode: "hover" | "focus" | "press";
};
type JourneyFlowNode = Node<JourneyNodeData, "story">;
const NODE_TYPES = { story: StoryNode };

/** The existing canvas library owns navigation and edge routing, not automatic graph layout. */
function initialPositions(graph: ExperienceJourneyMapGraph) {
  const ids = new Set(graph.nodes.map((node) => node.sceneId));
  const outgoing = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const edge of graph.edges) {
    if (!ids.has(edge.fromSceneId) || !ids.has(edge.toSceneId)) continue;
    const destinations = outgoing.get(edge.fromSceneId) ?? [];
    destinations.push(edge.toSceneId);
    outgoing.set(edge.fromSceneId, destinations);
    incoming.add(edge.toSceneId);
  }
  const depths = new Map<string, number>();
  const queue: string[] = [];
  const addRoot = (sceneId: string) => {
    depths.set(sceneId, 0);
    queue.push(sceneId);
  };
  for (const node of graph.nodes) if (!incoming.has(node.sceneId)) addRoot(node.sceneId);
  let nextIndex = 0;
  const traverse = () => {
    while (nextIndex < queue.length) {
      const id = queue[nextIndex++]!;
      for (const target of outgoing.get(id) ?? []) {
        if (depths.has(target)) continue;
        depths.set(target, depths.get(id)! + 1);
        queue.push(target);
      }
    }
  };
  traverse();
  // Cyclic or disconnected components need a root too; every node is enqueued once.
  for (const node of graph.nodes) {
    if (depths.has(node.sceneId)) continue;
    addRoot(node.sceneId);
    traverse();
  }
  const rows = new Map<number, number>();
  for (const depth of depths.values()) rows.set(depth, (rows.get(depth) ?? 0) + 1);
  const largestColumn = Math.max(
    1,
    [...rows.values()].reduce((largest, count) => Math.max(largest, count), 0)
  );
  const nextRow = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of graph.nodes) {
    const depth = depths.get(node.sceneId) ?? 0;
    const row = nextRow.get(depth) ?? 0;
    nextRow.set(depth, row + 1);
    positions.set(node.sceneId, {
      x: depth * (NODE_WIDTH + COLUMN_GAP),
      y: (row + (largestColumn - (rows.get(depth) ?? 1)) / 2) * (NODE_HEIGHT + ROW_GAP),
    });
  }
  return positions;
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return [
    ...dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
    ),
  ]
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true")
    .sort((left, right) =>
      left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );
}

/** Each opening has an independent viewport. The player owns pausing and entry-anchor restoration. */
export function ExperienceJourneyMap(props: ExperienceJourneyMapProps) {
  const portalRoot = useSyncExternalStore(subscribeFullscreen, mapPortalRoot, () => null);
  if (!portalRoot) return null;
  return createPortal(
    <ReactFlowProvider>
      <JourneyMapDialog {...props} />
    </ReactFlowProvider>,
    portalRoot
  );
}

function mapPortalRoot() {
  return document.fullscreenElement ?? document.body;
}
function subscribeFullscreen(listener: () => void) {
  document.addEventListener("fullscreenchange", listener);
  return () => document.removeEventListener("fullscreenchange", listener);
}

function JourneyMapDialog({
  graph,
  currentSceneId,
  nodeDetails,
  copy,
  onClose,
  onReplay,
  replayPending = false,
  error,
}: ExperienceJourneyMapProps) {
  const titleId = useId();
  const descriptionId = useId();
  const hintId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  const [hint, setHint] = useState<MysteryHint | null>(null);
  const hintRef = useRef<MysteryHint | null>(null);
  const navigatingRef = useRef(false);
  const dismissedHintTriggerRef = useRef<HTMLElement | null>(null);
  const hideHint = useCallback(() => {
    hintRef.current = null;
    setHint(null);
  }, []);
  const {
    refs: hintRefs,
    floatingStyles,
    context: hintContext,
    isPositioned,
  } = useFloating({
    open: hint !== null,
    onOpenChange: (open, _event, reason) => {
      if (
        !open &&
        (!(reason === "hover" || reason === "safe-polygon") || hintRef.current?.mode === "hover")
      )
        hideHint();
    },
    elements: { reference: hint?.trigger ?? null },
    placement: "top",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(12),
      flip({ padding: 12 }),
      shift({ padding: 12, crossAxis: true }),
      size({
        padding: 12,
        apply({ availableWidth, availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxWidth: `${Math.max(0, availableWidth)}px`,
            maxHeight: `${Math.max(0, availableHeight)}px`,
          });
        },
      }),
    ],
  });
  const { getFloatingProps } = useInteractions([
    useHover(hintContext, {
      enabled: hint?.mode === "hover",
      mouseOnly: true,
      move: false,
      handleClose: safePolygon({ blockPointerEvents: false }),
    }),
    useDismiss(hintContext, {
      escapeKey: false,
      outsidePressEvent: "pointerdown",
      capture: { outsidePress: true },
    }),
  ]);
  const hintOpenChange = hintContext.onOpenChange;
  const onMysteryHint = useCallback(
    (sceneId: string, trigger: HTMLElement, action: MysteryHintAction, event: Event) => {
      const previous = hintRef.current;
      if (action === "leave") {
        if (dismissedHintTriggerRef.current === trigger) dismissedHintTriggerRef.current = null;
        return;
      }
      if (action === "blur") {
        if (dismissedHintTriggerRef.current === trigger) dismissedHintTriggerRef.current = null;
        if (previous?.sceneId === sceneId) hideHint();
        return;
      }
      // React Flow ends a mouse press on its next event turn. A native click is
      // already a completed gesture; real drags suppress that click themselves.
      if (navigatingRef.current && action !== "press") return;
      if (action === "press") dismissedHintTriggerRef.current = null;
      else if (dismissedHintTriggerRef.current === trigger) return;
      if (action === "hover" && previous?.sceneId === sceneId && previous.mode !== "hover") return;
      hintOpenChange(true, event, action === "press" ? "click" : action);
      const next = { sceneId, trigger, mode: action };
      hintRef.current = next;
      setHint(next);
    },
    [hideHint, hintOpenChange]
  );
  const positions = useMemo(() => initialPositions(graph), [graph]);
  const { setCenter, fitView, getViewport, setViewport, zoomIn, zoomOut, viewportInitialized } =
    useReactFlow<JourneyFlowNode>();
  // Read actual measured handle internals: readonly controlled nodes do not echo
  // dimension changes through onNodesChange into React Flow's cached ready flag.
  const nodesInitialized = useNodesInitialized({ includeHiddenNodes: true });
  const fittedRef = useRef(false);
  const replayScene = useCallback(
    (sceneId: string) => {
      hideHint();
      onReplay(sceneId);
    },
    [hideHint, onReplay]
  );
  const nodes = useMemo<JourneyFlowNode[]>(
    () =>
      graph.nodes.map((node, index) => {
        const details = node.visited ? nodeDetails?.[node.sceneId] : undefined;
        const title = node.visited
          ? details?.title ||
            (node.kind === "ending" ? copy.endingLabel : copy.sceneLabel(index + 1))
          : copy.unexplored;
        return {
          id: node.sceneId,
          type: "story",
          position: positions.get(node.sceneId)!,
          initialWidth: NODE_WIDTH,
          initialHeight: NODE_HEIGHT,
          style: { width: NODE_WIDTH, height: NODE_HEIGHT, pointerEvents: "auto" },
          draggable: false,
          connectable: false,
          selectable: false,
          focusable: false,
          deletable: false,
          data: {
            node,
            title,
            ...(details?.thumbnailUrl ? { thumbnailUrl: details.thumbnailUrl } : {}),
            current: node.sceneId === currentSceneId,
            replayPending,
            copy,
            onReplay: replayScene,
            hintId,
            onMysteryHint,
          },
        };
      }),
    [
      graph.nodes,
      nodeDetails,
      copy,
      positions,
      currentSceneId,
      replayPending,
      replayScene,
      hintId,
      onMysteryHint,
    ]
  );
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges
        .filter((edge) => positions.has(edge.fromSceneId) && positions.has(edge.toSceneId))
        .map((edge) => {
          const color = edge.traversed ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.2)";
          return {
            id: edge.edgeId,
            source: edge.fromSceneId,
            target: edge.toSceneId,
            type: "default",
            ariaRole: "presentation",
            domAttributes: { "aria-hidden": true },
            selectable: false,
            focusable: false,
            deletable: false,
            reconnectable: false,
            style: {
              stroke: color,
              strokeWidth: edge.traversed ? 2 : 1.5,
              ...(edge.traversed ? {} : { strokeDasharray: "4 5" }),
            },
            markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
            data: { traversed: edge.traversed },
          };
        }),
    [graph.edges, positions]
  );

  useLayoutEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    closeRef.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (hintRef.current) {
          dismissedHintTriggerRef.current = hintRef.current.trigger;
          hideHint();
          return;
        }
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements(dialog);
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof globalThis.Node && !dialog.contains(event.target))
        closeRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", containFocus);
    };
  }, [hideHint]);

  // Start with the current scene and its adjacent branches readable, even for very large maps.
  useEffect(() => {
    if (!nodesInitialized || !viewportInitialized || fittedRef.current) return;
    fittedRef.current = true;
    const context = new Set([currentSceneId]);
    for (const edge of graph.edges) {
      if (edge.fromSceneId === currentSceneId) context.add(edge.toSceneId);
      if (edge.toSceneId === currentSceneId) context.add(edge.fromSceneId);
    }
    const visibleContext = graph.nodes
      .filter((node) => context.has(node.sceneId))
      .map((node) => ({ id: node.sceneId }));
    void fitView({
      nodes: visibleContext.length ? visibleContext : undefined,
      padding: 0.25,
      minZoom: 0.55,
      maxZoom: 1,
    });
  }, [nodesInitialized, viewportInitialized, currentSceneId, graph, fitView]);
  const centerCurrent = useCallback(() => {
    const position = positions.get(currentSceneId);
    if (!position || !viewportInitialized) return;
    hideHint();
    void setCenter(position.x + NODE_WIDTH / 2, position.y + NODE_HEIGHT / 2, {
      zoom: Math.max(0.65, getViewport().zoom),
      duration: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 180,
    });
  }, [currentSceneId, positions, setCenter, getViewport, viewportInitialized, hideHint]);

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[10030] bg-black/55 text-white backdrop-blur-[4px]"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="relative h-full w-full overflow-hidden outline-none"
      >
        <header
          className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 p-3 sm:p-5"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <h2
            id={titleId}
            className="flex min-h-11 items-center gap-2 rounded-full bg-black/45 px-4 text-sm font-semibold backdrop-blur-sm"
          >
            <IconMapRoute className="size-4 shrink-0 text-white/75" aria-hidden="true" />
            {copy.title}
          </h2>
          <p id={descriptionId} className="sr-only">
            {copy.description}
          </p>
          <div className="flex-1" />
          <button
            type="button"
            aria-label={copy.centerCurrent}
            title={copy.centerCurrent}
            onClick={centerCurrent}
            disabled={!positions.has(currentSceneId) || !viewportInitialized}
            className={classNames(
              CONTROL,
              "pointer-events-auto grid size-11 shrink-0 place-items-center bg-black/45 text-white/85 backdrop-blur-sm"
            )}
          >
            <IconCurrentLocation className="size-5" aria-hidden="true" />
          </button>
          <button
            ref={closeRef}
            type="button"
            aria-label={copy.close}
            title={copy.close}
            onClick={onClose}
            className={classNames(
              CONTROL,
              "pointer-events-auto grid size-11 shrink-0 place-items-center bg-black/45 text-white/85 backdrop-blur-sm"
            )}
          >
            <IconX className="size-5" aria-hidden="true" />
          </button>
        </header>
        {error ? (
          <p
            role="alert"
            className="absolute inset-x-3 top-16 z-30 mx-auto max-h-24 max-w-lg overflow-auto whitespace-pre-wrap rounded-lg bg-black/80 px-3 py-2 text-sm leading-5 text-white/90 ring-1 ring-white/20 sm:inset-x-5 sm:top-20"
          >
            {error}
          </p>
        ) : null}
        {graph.nodes.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-sm text-white/75">
            <p className="rounded-lg bg-black/60 px-4 py-3">{copy.empty}</p>
          </div>
        ) : (
          <ReactFlow<JourneyFlowNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            aria-label={copy.canvasLabel}
            tabIndex={0}
            style={{ backgroundColor: "transparent" }}
            className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50"
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            edgesReconnectable={false}
            deleteKeyCode={null}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            panOnDrag
            zoomOnPinch
            zoomOnScroll
            zoomOnDoubleClick={false}
            selectionOnDrag={false}
            panActivationKeyCode={null}
            disableKeyboardA11y
            preventScrolling
            minZoom={0.35}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            onMoveStart={() => {
              navigatingRef.current = true;
              hideHint();
            }}
            onMoveEnd={() => {
              navigatingRef.current = false;
            }}
            onPaneClick={hideHint}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              const viewport = getViewport();
              const moves: Record<string, { x: number; y: number }> = {
                ArrowLeft: { x: 48, y: 0 },
                ArrowRight: { x: -48, y: 0 },
                ArrowUp: { x: 0, y: 48 },
                ArrowDown: { x: 0, y: -48 },
              };
              const move = moves[event.key];
              if (move) {
                event.preventDefault();
                hideHint();
                void setViewport({ ...viewport, x: viewport.x + move.x, y: viewport.y + move.y });
              } else if (event.key === "+" || event.key === "=") {
                event.preventDefault();
                hideHint();
                void zoomIn();
              } else if (event.key === "-") {
                event.preventDefault();
                hideHint();
                void zoomOut();
              }
            }}
          />
        )}
        <div
          {...getFloatingProps()}
          ref={hintRefs.setFloating}
          id={hintId}
          role="tooltip"
          hidden={!hint}
          className="pointer-events-auto z-40 overflow-auto rounded-lg bg-neutral-950 px-3 py-2.5 text-sm leading-5 text-white/85 shadow-xl ring-1 ring-white/15"
          style={{
            ...floatingStyles,
            width: "min(20rem, calc(100vw - 24px))",
            visibility: hint && isPositioned ? "visible" : "hidden",
          }}
        >
          {copy.unexploredHint}
        </div>
        <footer
          className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-start sm:inset-x-5 sm:bottom-5"
          style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="max-w-md rounded-xl bg-black/60 px-3 py-2 backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-white/75">
              <span className="flex items-center gap-1.5 text-[#E52227]">
                <span className="size-2 rounded-full bg-[#E52227] ring-1 ring-[#E52227]" />
                {copy.current}
              </span>
              <span className="flex items-center gap-1.5">
                <IconCheck className="size-3" aria-hidden="true" />
                {copy.explored}
              </span>
              <span className="flex items-center gap-1.5">
                <IconLock className="size-3" aria-hidden="true" />
                {copy.unexplored}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-white/60">
              {replayPending ? (
                <span role="status">{copy.replaying}</span>
              ) : graph.nodes.some((node) => node.replayable) ? (
                copy.replayHint
              ) : (
                copy.unexploredHint
              )}
            </p>
            {graph.truncated ? (
              <p role="status" className="mt-1 text-[11px] leading-4 text-white/75">
                {copy.truncated}
              </p>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

function StoryNode({ data, positionAbsoluteX, positionAbsoluteY }: NodeProps<JourneyFlowNode>) {
  const {
    node,
    title,
    thumbnailUrl,
    current,
    replayPending,
    copy,
    onReplay,
    hintId,
    onMysteryHint,
  } = data;
  const { setCenter, getViewport } = useReactFlow<JourneyFlowNode>();
  const replayable = node.visited && node.replayable && node.kind === "scene";
  const content = (
    <>
      <div className="absolute inset-0 grid place-items-center">
        {node.visited && thumbnailUrl ? (
          <SceneThumbnail
            key={thumbnailUrl}
            src={thumbnailUrl}
            unavailable={copy.thumbnailUnavailable}
          />
        ) : node.visited ? (
          <IconMapRoute className="size-6 text-white/35" aria-hidden="true" />
        ) : (
          <MysteryNodeFace />
        )}
      </div>
      <span
        className={classNames(
          "absolute right-2 top-2 grid size-6 place-items-center rounded-md bg-black/65 ring-1 ring-white/10",
          node.visited ? "text-white/90" : "text-[#E52227]/85"
        )}
        aria-hidden="true"
      >
        {node.visited ? (
          <IconCheck className="size-3.5" />
        ) : (
          <IconLock className="size-3.5" stroke={1.6} />
        )}
      </span>
      {replayable ? (
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-[42%] grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/40 transition-colors group-hover:bg-black/75 motion-reduce:transition-none"
        >
          <IconPlayerPlay className="ml-0.5 size-4 fill-current" />
        </span>
      ) : null}
      {node.visited ? (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/65 to-transparent px-3 pb-2 pt-5 text-left">
          <span className="line-clamp-1 block text-sm font-medium leading-5">{title}</span>
          <span
            className={classNames(
              "block text-[10px] leading-4",
              current ? "font-medium text-[#E52227]" : "text-white/65"
            )}
          >
            {current ? copy.current : copy.explored}
          </span>
        </div>
      ) : null}
    </>
  );
  const cardClass = classNames(
    "relative block h-full w-full overflow-hidden rounded-xl bg-black/75 shadow-lg",
    current
      ? "ring-2 ring-[#E52227]"
      : node.visited
        ? "ring-1 ring-white/25"
        : "ring-1 ring-white/20"
  );
  return (
    <div
      data-journey-node={node.sceneId}
      data-current={current || undefined}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={{ visibility: "hidden", pointerEvents: "none" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ visibility: "hidden", pointerEvents: "none" }}
      />
      {replayable ? (
        <button
          type="button"
          aria-label={copy.replay + ": " + title}
          aria-current={current ? "step" : undefined}
          disabled={replayPending}
          title={copy.replay + ". " + copy.replayHint}
          onFocus={(event) => {
            // A keyboard move to an offscreen scene should reveal it; pointer presses keep their target still.
            if (event.currentTarget.matches(":focus-visible")) {
              void setCenter(
                positionAbsoluteX + NODE_WIDTH / 2,
                positionAbsoluteY + NODE_HEIGHT / 2,
                { zoom: getViewport().zoom }
              );
            }
          }}
          onClick={() => {
            if (!replayPending) onReplay(node.sceneId);
          }}
          className={classNames(
            cardClass,
            "nodrag nopan group outline-none transition-shadow focus-visible:ring-2 disabled:cursor-wait disabled:opacity-50 motion-reduce:transition-none",
            current
              ? "hover:ring-[#E52227] focus-visible:ring-[#E52227] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/70"
              : "hover:ring-white/70 focus-visible:ring-white"
          )}
        >
          {content}
        </button>
      ) : !node.visited ? (
        <button
          type="button"
          aria-label={copy.unexplored}
          aria-describedby={hintId}
          onMouseEnter={(event) =>
            onMysteryHint(node.sceneId, event.currentTarget, "hover", event.nativeEvent)
          }
          onMouseLeave={(event) =>
            onMysteryHint(node.sceneId, event.currentTarget, "leave", event.nativeEvent)
          }
          onFocus={(event) =>
            onMysteryHint(node.sceneId, event.currentTarget, "focus", event.nativeEvent)
          }
          onBlur={(event) =>
            onMysteryHint(node.sceneId, event.currentTarget, "blur", event.nativeEvent)
          }
          onClick={(event) => {
            event.stopPropagation();
            onMysteryHint(node.sceneId, event.currentTarget, "press", event.nativeEvent);
          }}
          className={classNames(
            cardClass,
            "nodrag cursor-help outline-none focus-visible:ring-2 focus-visible:ring-white"
          )}
        >
          {content}
        </button>
      ) : (
        <div
          role="group"
          aria-label={title}
          aria-current={current ? "step" : undefined}
          title={node.visited && node.kind === "scene" ? copy.replayUnavailable : undefined}
          className={cardClass}
        >
          {content}
        </div>
      )}
    </div>
  );
}

/** Purely decorative: an opaque, static face never reveals unreached footage. */
function MysteryNodeFace() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 overflow-hidden"
      style={{
        backgroundColor: "#211528",
        boxShadow: "inset 0 1px 0 rgba(209,179,224,0.16), inset 0 -1px 0 rgba(0,0,0,0.65)",
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(145deg, transparent 8%, rgba(137,97,160,0.38) 29%, rgba(93,59,112,0.16) 47%, transparent 64%), linear-gradient(24deg, rgba(7,5,12,0.85), transparent 51%, rgba(168,129,183,0.12) 70%, transparent 95%), linear-gradient(160deg, transparent 36%, rgba(94,59,122,0.28) 65%, transparent 88%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(rgba(223,198,237,0.18) 0.5px, transparent 0.75px), radial-gradient(rgba(9,5,14,0.6) 0.5px, transparent 0.75px)",
          backgroundSize: "5px 7px, 7px 5px",
          backgroundPosition: "0 0, 3px 2px",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgba(9,7,13,0.45), transparent 28% 72%, rgba(9,7,13,0.45)), linear-gradient(0deg, rgba(9,7,13,0.55), transparent 32% 70%, rgba(9,7,13,0.22))",
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center gap-3 font-medium">
        <span className="translate-y-2 -rotate-12 text-[32px] leading-none text-[#d3b9e0]/25 blur-[0.4px]">
          ?
        </span>
        <span
          className="text-[52px] leading-none text-[#dac3e6]/85"
          style={{ textShadow: "0 2px 20px rgba(190,142,218,0.25), 0 2px 4px rgba(0,0,0,0.65)" }}
        >
          ?
        </span>
        <span className="-translate-y-1 rotate-12 text-[36px] leading-none text-[#d3b9e0]/40 blur-[0.4px]">
          ?
        </span>
      </div>
    </div>
  );
}

function SceneThumbnail({ src, unavailable }: { src: string; unavailable: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span role="img" aria-label={unavailable} title={unavailable}>
      <IconPhotoOff className="size-6 text-white/35" aria-hidden="true" />
    </span>
  ) : (
    <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
  );
}
