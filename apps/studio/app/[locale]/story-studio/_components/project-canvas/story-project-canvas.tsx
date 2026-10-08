"use client";

import { STORY_AUTHORING_TEXT_MAX } from "@repo/shared/story-production";

import type { StoryPlotMediaBinding } from "@/lib/story-plot-media";

import { useAuth } from "@/app/_components/auth-provider";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  applyNodeChanges,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MiniMap,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type EdgeProps,
  type FinalConnectionState,
  type NodeChange,
  type NodeProps,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconDownload,
  IconFocusCentered,
  IconGitBranch,
  IconLoader2,
  IconMovie,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useStoryProjectUiStore } from "../../_stores/story-project-ui-store";
import { storyChapterWorkbenchQueryKey } from "../../_lib/use-story-chapter-workbench";
import { useStoryPreviewNavigation } from "../../_lib/use-story-preview-navigation";
import { StoryProjectSidePanelShell } from "../story-project-side-panel";
import { StoryProjectWorkState } from "../story-project-work-state";
import {
  StoryboardCoverageStore,
  StoryCanvasStoryboardCoverageContext,
  storyboardCoverageByNode,
  storyboardStillUrl,
  useStoryboardNodeCoverage,
} from "./story-canvas-storyboard-coverage";
import { getStoryStoryboard, storyProductionKeys } from "@/lib/story-production-api";
import { Button } from "@/components/ui/button";
import { CanvasControls } from "@/components/canvas/canvas-controls";
import { CanvasHistoryControls } from "@/components/canvas/canvas-history-controls";
import { canvasNodeGeometry } from "@/lib/canvas-core/node-geometry";
import { useCanvasHistoryShortcuts } from "@/components/canvas/canvas-history";
import { CanvasNativePointerOwner } from "@/components/canvas/canvas-native-pointer-owner";
import { CanvasReactFlow, type CanvasReactFlowProps } from "@/components/canvas/canvas-react-flow";
import { CanvasBackdrop } from "@/components/canvas/canvas-backdrop";
import { CANVAS_DELETE_KEY_CODES } from "@/components/canvas/canvas-interaction-policy";
import {
  canActivateCanvasMediaPreview,
  canClaimCanvasManualPlayback,
} from "@/components/canvas/canvas-media-preview-policy";
import {
  MediaHoverPreviewProvider,
  useMediaHoverPreview,
  useMediaHoverPreviewInterruption,
} from "@/components/media/media-hover-preview";
import type { MediaManualPlaybackLease } from "@/components/media/media-preview-coordinator";
import { StudioVideoPlayer, type StudioVideoSource } from "@/components/media/studio-video-player";
import { resolveCanvasVideoControlDensity } from "@/components/media/studio-video-player-model";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { Link } from "@/i18n/navigation";
import { canonicalJsonString } from "@/lib/canonical-json";
import { cn } from "@/lib/utils";
import {
  canvasLayoutRevisionConflict,
  draftRevisionConflict,
  getStoryCanvasLayout,
  getStoryWorkbench,
  putStoryCanvasLayout,
  putStoryDraft,
  importStoryPlot,
  storyApiErrorMessage,
  storyPlotImportError,
  type CanvasLayoutRevisionConflict,
  type DraftRevisionConflict,
  type InteractiveStoryDraftContent,
  type StoryBibleEnding,
  type StoryBibleWriterPatch,
  type StoryCanvasLayout,
  type StoryCanvasPosition,
  type StoryClipGraphNode,
  type StoryGraphNode,
  type StoryInteractionAction,
  type StoryInteractionOutcomes,
  type StoryInteractionTrigger,
  type StoryWorkbench,
} from "@/lib/story-projects-api";
import {
  buildStoryCanvasModel,
  reuseStoryCanvasNodes,
  storyDecisionCanvasNodeId,
  type StoryCanvasEdge,
  type StoryCanvasNode,
  type StoryCanvasNodeData,
} from "./story-project-canvas-model";
import { resolveStoryCanvasNodeClick } from "./story-project-canvas-selection";
import {
  CLOSED_STORY_CANVAS_INSPECTOR,
  reconcileStoryCanvasInspectorTarget,
  storyCanvasInspectorNodeId,
  storyNodeInspectorTarget,
} from "./story-canvas-inspector-target";
import {
  resolveStoryCanvasCamera,
  storyCanvasHydrationSelection,
  storyCanvasInspectorToRestore,
  storyCanvasViewKey,
} from "./story-canvas-view-state";
import {
  confirmsOwnCanvasLayoutWrite,
  layoutPayloadSignature,
  layoutPositionSignature,
  layoutRetryDelay,
  shouldAdoptAuthoritativeCanvasLayout,
  unsavedDesiredLayout,
  type StoryCanvasLayoutPayload,
} from "./story-canvas-layout-retry";
import { createConnectedSceneForBlankDrop } from "./story-project-canvas-drop";
import { deleteStoryCanvasElements } from "./story-project-canvas-deletion";
import { shouldAdoptAuthoritativeStoryDraft } from "./story-canvas-draft-reconcile";
import {
  createStoryCanvasMutationBarrier,
  isStoryChapterProjectionPairReady,
  resolveStoryCanvasEditPolicy,
  resolveStoryCanvasProjectionSurface,
  resolveStoryProjectionReadiness,
  storyProjectionQueryKey,
  storyProjectionQueryOptions,
} from "./story-canvas-edit-policy";
import { useLastDefinedData } from "./use-last-defined-data";
import {
  addChoiceOption,
  applyStoryBiblePatch,
  connectSceneContinuation,
  createDecisionNode,
  duplicateStoryNodes,
  materializeStoryDecisionNodes,
  type StoryDuplicateSource,
  connectChoiceTarget,
  createStoryEndingForAutoRoute,
  createStoryEndingForChoice,
  endingsInUse,
  createClipNode,
  moveChoiceOption,
  putStoryEnding,
  removeChoiceOption,
  removeStoryEnding,
  replaceIncomingStoryLinks,
  replaceStoryNodeInteractions,
  setAutoRoutes,
  setEntryNode,
  setNodeOnEnterEffects,
  updateChoiceStats,
  updateStoryClipMeta,
  updateChoiceExitPrompt,
  updateChoiceOptionLabel,
} from "./story-project-canvas-mutations";
import type { StoryCondition, StoryRouteTarget, StoryStateEffect } from "@repo/shared/story-stats";
import {
  StoryChoiceAttachmentBar,
  storyGraphNodePickerItems,
  storyGraphNodePickerTitles,
} from "./story-stats-editors";

import {
  canConnectStoryChoice,
  canConnectStoryCompletion,
  choiceIdFromHandle,
  isValidStoryFlowConnection,
  storyExistingTargetAvailability,
} from "./story-project-canvas-connections";
import { StoryCanvasTextInput } from "./story-canvas-text-input";
import { StoryCanvasHistory, type StoryCanvasHistorySnapshot } from "./story-canvas-history";
import { cacheStoryWorkbenchDraft } from "./story-workbench-cache";
import {
  StoryConnectionCreator,
  type StoryConnectionCreationKind,
  type StoryConnectionExistingTarget,
} from "./story-connection-creator";
import { StoryNodeCreator, StoryNodeDock, type StoryNodeCreationKind } from "./story-node-creator";
import {
  offsetStoryNodeDockCreationPosition,
  resolveStoryNodeCreationMenuPlacement,
  type StoryNodeCreationMenuPlacement,
} from "./story-node-creator-model";
import { StoryNodeInspector } from "./story-node-inspector";
import {
  StoryCommunityPriceButton,
  StoryCommunityPriceLabel,
} from "./story-community-price-dialog";
import { updateStoryCommunityPointPrice } from "./story-community-price";
import { StoryInteractionEditor } from "./story-interaction-editor";
import { migrateLegacyStoryHotspotIds } from "./story-interaction-ids";
import type {
  StoryInteractionActionDraft,
  StoryInteractionDraft,
  StoryInteractionOutcomesDraft,
  StoryInteractionTriggerDraft,
} from "./story-interaction-types";
import { stripRetiredStoryWorldNodes } from "@repo/shared/strip-retired-story-world-nodes";
import { StoryDraftSnapshotCoordinator } from "./story-draft-snapshot-coordinator";
import { StoryPlotImportDialog } from "./story-plot-import-dialog";
import {
  MAX_PLOT_IMPORT_CHAPTER_NODES,
  StoryPlotImportError,
  type StoryPlotImport,
  type StoryPlotImportMode,
} from "@/lib/story-plot-import";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
type PersistDraftOptions = {
  bypassSnapshotBarrier?: boolean;
  propagateError?: boolean;
};
type PersistLayoutOptions = {
  preserveDesired?: boolean;
  propagateError?: boolean;
};
type CommitContentOptions = {
  mergeKey?: string;
};
type PendingCompletionDrop = {
  sourceCanvasNodeId: string;
  sourceHandleId: string;
  clientPosition: { x: number; y: number };
  flowPosition: StoryCanvasPosition;
};
type StoryCanvasChoiceContextValue = {
  setCommunityPointPrice: (nodeId: string, price: number) => Promise<void>;
  canEditContent: boolean;
  canCreateOption: boolean;
  start: (sourceNodeId: string) => void;
  updatePrompt: (sourceNodeId: string, prompt: string) => void;
  updateChoice: (sourceNodeId: string, choiceId: string, label: string) => void;
  moveChoice: (sourceNodeId: string, choiceId: string, direction: "up" | "down") => void;
  removeChoice: (sourceNodeId: string, choiceId: string) => void;
  stateVariables: InteractiveStoryDraftContent["storyBible"]["stateVariables"];
  endings: StoryBibleEnding[];
  nodes: Array<{ nodeId: string; title: string }>;
  locale: string;
  patchChoice: (
    sourceNodeId: string,
    choiceId: string,
    patch: {
      effects?: StoryStateEffect[] | null;
      visibleWhen?: StoryCondition | null;
      target?: StoryRouteTarget | null;
    }
  ) => void;
  createEndingForChoice: (sourceNodeId: string, choiceId: string) => void;
  updateEnding: (endingId: string, patch: Pick<StoryBibleEnding, "title">) => void;
  deleteEnding: (endingId: string) => void;
};

const NODE_TYPES = { storyCanvas: memo(StoryGraphNodeCard) };

/**
 * HTML labels instead of React Flow's SVG `EdgeText`. That path measures
 * every label with `getBBox` when edges mount during a pan.
 */
function StoryCanvasFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
  markerEnd,
  markerStart,
  interactionWidth,
}: EdgeProps<StoryCanvasEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const text = typeof label === "string" && label.trim() ? label : null;
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={interactionWidth}
      />
      {text ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded-md bg-[oklch(0.24_0_0)] px-1.5 py-0.5 text-[10px] font-semibold text-white/70"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const EDGE_TYPES = { storyCanvas: StoryCanvasFlowEdge };
const DEFAULT_EDGE_OPTIONS = {
  type: "storyCanvas",
  interactionWidth: 28,
  style: { stroke: "rgba(255,255,255,0.25)", strokeWidth: 1.5 },
};
const STORY_PORT_COLORS = {
  entry: "#8f65ff",
  flow: "rgba(255,255,255,0.72)",
  choice: "#5b9dff",
  ending: "#E52227",
} as const;
const MAX_PLAYER_CHOICES = 6;
const NO_STORY_VARIABLES: StoryCanvasChoiceContextValue["stateVariables"] = [];
const NO_STORY_ENDINGS: StoryBibleEnding[] = [];

const StoryCanvasFocusContext = createContext<string | null>(null);
/** Scene-card play buttons call back into the canvas's preview navigation. */
const StoryCanvasPreviewContext = createContext<((nodeId: string) => void) | null>(null);
const StoryCanvasChoiceContext = createContext<StoryCanvasChoiceContextValue | null>(null);

function StoryCanvasReactFlow({
  onInteractionStart,
  ...props
}: CanvasReactFlowProps<StoryCanvasNode, StoryCanvasEdge>) {
  const interruptHoverPreview = useMediaHoverPreviewInterruption();
  const handleInteractionStart = useCallback(() => {
    interruptHoverPreview();
    onInteractionStart?.();
  }, [interruptHoverPreview, onInteractionStart]);

  return <CanvasReactFlow {...props} onInteractionStart={handleInteractionStart} />;
}

export function StoryProjectCanvas({
  projectId,
  requestedChapterId,
  requestedFocusNodeId,
}: {
  projectId: string;
  requestedChapterId?: string;
  requestedFocusNodeId?: string;
}) {
  // The XYFlow store belongs to the project shell, not to an individual
  // chapter. Chapter projections are swapped inside the mounted shell so a
  // query-param navigation cannot tear down the viewport and flash the cold
  // loading surface.
  const { user } = useAuth();
  const scopeKey = JSON.stringify([projectId, user?.id ?? null]);

  return (
    <ReactFlowProvider key={scopeKey}>
      <StoryProjectCanvasInner
        projectId={projectId}
        requestedChapterId={requestedChapterId}
        requestedFocusNodeId={requestedFocusNodeId}
      />
    </ReactFlowProvider>
  );
}

function StoryProjectCanvasInner({
  projectId,
  requestedChapterId,
  requestedFocusNodeId,
}: {
  projectId: string;
  requestedChapterId?: string;
  requestedFocusNodeId?: string;
}) {
  const { user } = useAuth();
  const interfaceLocale = useLocale();
  const t = useTranslations("storyStudio.canvas");
  const commonT = useTranslations("storyStudio");
  const canvasT = useTranslations("canvas");
  const { fitView, getViewport, screenToFlowPosition, setViewport } = useReactFlow<
    StoryCanvasNode,
    StoryCanvasEdge
  >();
  const nodesInitialized = useNodesInitialized();
  const queryClient = useQueryClient();
  const { openPreviewFromScene } = useStoryPreviewNavigation(projectId);
  const previewFromScene = useCallback(
    (nodeId: string) => void openPreviewFromScene(nodeId),
    [openPreviewFromScene]
  );
  const [content, setContent] = useState<InteractiveStoryDraftContent | null>(null);
  const [cameraTick, setCameraTick] = useState(0);
  const [contentChapterId, setContentChapterId] = useState<string | null>(null);
  // Inspector + share live in the shared store so the layout rail's World and
  // Share buttons can drive them; the canvas stays the only writer otherwise.
  const inspectorTarget = useStoryProjectUiStore((state) => state.inspectorTarget);
  const setInspectorTarget = useStoryProjectUiStore((state) => state.setInspectorTarget);
  const sidePanel = useStoryProjectUiStore((state) => state.sidePanel);
  // The inspector and the rail-toggled tenants share one dock slot: opening a
  // side panel from the rail dismisses the inspector (node clicks do the
  // reverse by clearing sidePanel before opening the inspector).
  useEffect(() => {
    if (sidePanel) setInspectorTarget(CLOSED_STORY_CANVAS_INSPECTOR);
  }, [sidePanel, setInspectorTarget]);
  const setSidePanel = useStoryProjectUiStore((state) => state.setSidePanel);
  const setDraftBarrier = useStoryProjectUiStore((state) => state.setDraftBarrier);
  const setFoundationWriter = useStoryProjectUiStore((state) => state.setFoundationWriter);
  const [interactionEditorNodeId, setInteractionEditorNodeId] = useState<string | null>(null);
  const [mutationBarrier] = useState(() => createStoryCanvasMutationBarrier());
  const focusedNodeId = storyCanvasInspectorNodeId(inspectorTarget);
  const [creatorMenu, setCreatorMenu] = useState<StoryNodeCreationMenuPlacement | null>(null);
  const [pendingCompletionDrop, setPendingCompletionDrop] = useState<PendingCompletionDrop | null>(
    null
  );
  const [graphError, setGraphError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<DraftRevisionConflict | null>(null);
  const [layoutConflict, setLayoutConflict] = useState<CanvasLayoutRevisionConflict | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const [draftSnapshotCoordinator] = useState(() => new StoryDraftSnapshotCoordinator());
  const [canvasNodes, setCanvasNodes] = useNodesState<StoryCanvasNode>([]);
  const [canvasEdges, setCanvasEdges, onCanvasEdgesChange] = useEdgesState<StoryCanvasEdge>([]);
  const [sessionId] = useState(() => globalThis.crypto.randomUUID());
  const [history] = useState(() => new StoryCanvasHistory());
  const [, setHistoryVersion] = useState(0);
  const hydratedRef = useRef(false);
  const hydratedChapterIdRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const savedSignatureRef = useRef("");
  const latestContentRef = useRef<InteractiveStoryDraftContent | null>(null);
  const conflictRef = useRef<DraftRevisionConflict | null>(null);
  const disposedRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const inFlightSignatureRef = useRef<string | null>(null);
  const inFlightContentRef = useRef<InteractiveStoryDraftContent | null>(null);
  const queuedContentRef = useRef<InteractiveStoryDraftContent | null>(null);
  const recoveryContentRef = useRef<InteractiveStoryDraftContent | null>(null);
  const saveDebounceTimerRef = useRef<number | null>(null);
  const saveRetryTimerRef = useRef<number | null>(null);
  const saveRetryAttemptRef = useRef(0);
  const finalFlushActiveRef = useRef(false);
  const finalFlushGenerationRef = useRef(0);
  const finalLayoutFlushActiveRef = useRef(false);
  const finalLayoutFlushGenerationRef = useRef(0);
  const persistRef = useRef<
    (next: InteractiveStoryDraftContent, options?: PersistDraftOptions) => Promise<void>
  >(async () => {});
  const saveSettledWaitersRef = useRef(new Set<() => void>());
  const draftSnapshotBarrierRef = useRef(false);
  const layoutHydratedRef = useRef(false);
  const layoutHydratedChapterIdRef = useRef<string | null>(null);
  const layoutRevisionRef = useRef(0);
  const layoutSavedSignatureRef = useRef("");
  const layoutConflictRef = useRef<CanvasLayoutRevisionConflict | null>(null);
  const layoutSaveInFlightRef = useRef(false);
  const latestDesiredLayoutRef = useRef<StoryCanvasLayoutPayload | null>(null);
  const recoveryLayoutRef = useRef<StoryCanvasLayoutPayload | null>(null);
  const layoutRetryTimerRef = useRef<number | null>(null);
  const layoutRetryAttemptRef = useRef(0);
  const persistLayoutRef = useRef<
    (next: StoryCanvasLayoutPayload, options?: PersistLayoutOptions) => Promise<void>
  >(async () => {});
  const canvasNodesRef = useRef<StoryCanvasNode[]>([]);
  const canvasSectionRef = useRef<HTMLElement>(null);
  const hasFittedInitialCanvasRef = useRef(false);
  const activeCanvasViewKeyRef = useRef<string | null>(null);
  const pendingFitRef = useRef(false);
  const appliedFocusRef = useRef<string | null>(null);
  const pendingCanvasSelectionRef = useRef<string | null>(null);
  const pendingCopiedNodeIdsRef = useRef<string[] | null>(null);
  const requestedCanvasFocusRef = useRef<string | null>(null);
  const marqueeSelectionActiveRef = useRef(false);
  const latestCanvasSelectionRef = useRef<string[]>([]);
  const pendingNodePositionsRef = useRef(new Map<string, StoryCanvasPosition>());
  const dragStartHistorySnapshotRef = useRef<StoryCanvasHistorySnapshot | null>(null);
  // Set true once a node actually moves during a drag; consumed by onNodeClick
  // so the pointer-up that ends a drag can never open the inspector.
  const didDragNodeRef = useRef(false);

  const onCanvasNodesChange = useCallback(
    (changes: NodeChange<StoryCanvasNode>[]) => {
      setCanvasNodes((current) => {
        // Canonical Story content owns structural deletion. Applying XYFlow's
        // transient remove change first would hide a node when the domain
        // mutation fails and leave the projection out of sync.
        const next = applyNodeChanges(
          changes.filter(
            (change) =>
              change.type !== "remove" &&
              !(change.type === "position" && !mutationBarrier.permits("layout"))
          ),
          current
        );
        canvasNodesRef.current = next;
        return next;
      });
    },
    [mutationBarrier, setCanvasNodes]
  );

  const selectCanvasNodeExclusively = useCallback(
    (nodeId: string | null) => {
      pendingCanvasSelectionRef.current = nodeId;
      requestedCanvasFocusRef.current = null;
      setInspectorTarget(nodeId ? storyNodeInspectorTarget(nodeId) : CLOSED_STORY_CANVAS_INSPECTOR);
      setCanvasNodes((current) => {
        const nodeExists = nodeId !== null && current.some((node) => node.id === nodeId);
        if (nodeId !== null && !nodeExists) return current;

        const selectedNodeIds = nodeId ? new Set([nodeId]) : new Set<string>();
        const next = current.map((node) => ({
          ...node,
          selected: selectedNodeIds.has(node.id),
        }));
        pendingCanvasSelectionRef.current = null;
        latestCanvasSelectionRef.current = [...selectedNodeIds];
        canvasNodesRef.current = next;
        return next;
      });
    },
    [setCanvasNodes, setInspectorTarget]
  );

  const reconcileCanvasFocus = useCallback(
    (selectedNodeIds: readonly string[]) => {
      const preferredNodeId = requestedCanvasFocusRef.current;
      requestedCanvasFocusRef.current = null;
      setInspectorTarget((current) =>
        reconcileStoryCanvasInspectorTarget(current, selectedNodeIds, preferredNodeId)
      );
    },
    [setInspectorTarget]
  );

  const writeCanvasView = useCallback(
    (key: string, viewport = getViewport()) => {
      if (!hasFittedInitialCanvasRef.current) return;
      const state = useStoryProjectUiStore.getState();
      state.saveCanvasView(key, {
        viewport,
        selectedNodeIds: [...latestCanvasSelectionRef.current],
        inspectorTarget: state.inspectorTarget,
      });
    },
    [getViewport]
  );
  const writeCanvasViewRef = useRef(writeCanvasView);
  useEffect(() => {
    writeCanvasViewRef.current = writeCanvasView;
  }, [writeCanvasView]);

  const onCanvasSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams<StoryCanvasNode, StoryCanvasEdge>) => {
      const selectedNodeIds = selectedNodes.map((node) => node.id);
      latestCanvasSelectionRef.current = selectedNodeIds;
      const pendingSelection = pendingCanvasSelectionRef.current;
      if (!pendingSelection || selectedNodeIds.includes(pendingSelection)) {
        pendingCanvasSelectionRef.current = null;
      }
      if (!marqueeSelectionActiveRef.current) reconcileCanvasFocus(selectedNodeIds);
      const viewKey = activeCanvasViewKeyRef.current;
      if (viewKey) writeCanvasView(viewKey);
    },
    [reconcileCanvasFocus, writeCanvasView]
  );

  const onCanvasSelectionStart = useCallback(() => {
    marqueeSelectionActiveRef.current = true;
  }, []);

  const onCanvasSelectionEnd = useCallback(() => {
    marqueeSelectionActiveRef.current = false;
    reconcileCanvasFocus(latestCanvasSelectionRef.current);
  }, [reconcileCanvasFocus]);

  const workbenchQueryKey = useMemo(
    () =>
      storyProjectionQueryKey("workbench", projectId, requestedChapterId ?? null, user?.id ?? null),
    [projectId, requestedChapterId, user?.id]
  );
  const workbenchQuery = useQuery({
    ...storyProjectionQueryOptions({
      kind: "workbench",
      projectId,
      chapterId: requestedChapterId ?? null,
      viewerId: user?.id ?? null,
      queryFn: ({ signal }) => getStoryWorkbench(projectId, requestedChapterId, signal),
    }),
  });
  // Prefer the URL target over kept-previous workbench data. Otherwise the
  // layout query remains pinned to the old chapter until the workbench read
  // finishes, extending the transition and allowing mismatched projections.
  const resolvedChapterId = requestedChapterId ?? workbenchQuery.data?.chapter.id ?? null;
  const canvasViewKey = resolvedChapterId ? storyCanvasViewKey(projectId, resolvedChapterId) : null;
  // Workspace ownership is legacy metadata used only by media APIs that have
  // not migrated yet. It comes from the authorized project, never ambient UI.
  const workspaceId = workbenchQuery.data?.project.workspaceId ?? null;
  useLayoutEffect(() => {
    const previous = activeCanvasViewKeyRef.current;
    if (previous && previous !== canvasViewKey) writeCanvasView(previous);
    activeCanvasViewKeyRef.current = canvasViewKey;
  }, [canvasViewKey, writeCanvasView]);
  const layoutQueryKey = useMemo(
    () => storyProjectionQueryKey("canvas-layout", projectId, resolvedChapterId, user?.id ?? null),
    [projectId, resolvedChapterId, user?.id]
  );
  const layoutQuery = useQuery(
    storyProjectionQueryOptions({
      kind: "canvas-layout",
      projectId,
      chapterId: resolvedChapterId,
      viewerId: user?.id ?? null,
      queryFn: ({ signal }) => getStoryCanvasLayout(projectId, resolvedChapterId as string, signal),
    })
  );
  /**
   * The two canonical projections are chapter-scoped and may resolve at
   * different times. Keep the previous pair mounted during navigation, but do
   * not authorize mutations until both reads name the requested chapter.
   */
  const projectionPairReady = isStoryChapterProjectionPairReady({
    targetChapterId: resolvedChapterId,
    workbenchChapterId: workbenchQuery.data?.chapter.id ?? null,
    layoutChapterId: layoutQuery.data?.chapterId ?? null,
    workbenchPlaceholder: workbenchQuery.isPlaceholderData,
    layoutPlaceholder: layoutQuery.isPlaceholderData,
  });
  const rawProjectionReadiness = resolveStoryProjectionReadiness({
    workbenchFetchedAfterMount: workbenchQuery.isFetchedAfterMount,
    workbenchError: workbenchQuery.isError,
    layoutFetchedAfterMount: layoutQuery.isFetchedAfterMount,
    layoutError: layoutQuery.isError,
  });
  // `isFetchedAfterMount` is observer-level state and can remain true while a
  // chapter key changes. The pair check is the stricter write fence: the old
  // chapter may keep rendering, but no mutation can cross the transition.
  const projectionReadiness =
    rawProjectionReadiness === "ready" && !projectionPairReady
      ? ("loading" as const)
      : rawProjectionReadiness;
  // `keepPreviousData` carries the previous snapshot through the PENDING window
  // of a rotated key, but a failed fresh read drops `data` to undefined. The
  // canvas must keep rendering its last snapshot through that failure too
  // (writes stay latched via `projectionReadiness` "unavailable"), so retain
  // the last defined projections for every render-side consumer.
  const projectionPairCandidate = useMemo(
    () =>
      projectionPairReady && workbenchQuery.data && layoutQuery.data
        ? {
            chapterId: resolvedChapterId as string,
            workbench: workbenchQuery.data,
            layout: layoutQuery.data,
          }
        : undefined,
    [layoutQuery.data, projectionPairReady, resolvedChapterId, workbenchQuery.data]
  );
  const projectionPair = useLastDefinedData(projectionPairCandidate);
  const workbenchProjection = projectionPair?.workbench;
  const layoutProjection = projectionPair?.layout;
  // The project layout owns active-chapter identity for every production
  // surface, including the agent. The canvas consumes that route scope; it
  // must never publish transient query state back into the global store.
  const project = workbenchProjection?.project ?? null;
  const video = workbenchProjection?.video ?? null;
  // Publish the live authoring head while mounted so the layout header's
  // preview/publish actions track unsaved edits, conflicts and video swaps.
  const setLiveDraft = useStoryProjectUiStore((state) => state.setLiveDraft);
  const liveDraftReady = Boolean(workbenchProjection);
  const videoSnapshotHash = video?.snapshotHash ?? null;
  useEffect(() => {
    if (!liveDraftReady) {
      setLiveDraft(null);
      return;
    }
    setLiveDraft({
      revision: draftRevision,
      settled: saveState === "idle" || saveState === "saved",
      conflicted: Boolean(conflict),
      videoSnapshotHash,
    });
  }, [liveDraftReady, draftRevision, saveState, conflict, videoSnapshotHash, setLiveDraft]);
  useEffect(() => () => setLiveDraft(null), [setLiveDraft]);
  const authoringLocale = project?.defaultLocale ?? "en-US";

  const cacheSavedDraft = useCallback(
    (saved: StoryWorkbench["draft"]) => {
      const queryKeys: QueryKey[] = [workbenchQueryKey];
      if (resolvedChapterId) {
        queryKeys.push(
          storyChapterWorkbenchQueryKey(projectId, resolvedChapterId, user?.id ?? null)
        );
        void queryClient.invalidateQueries({
          queryKey: storyProductionKeys.storyboard(projectId, resolvedChapterId),
        });
      }
      cacheStoryWorkbenchDraft(queryClient, queryKeys, saved);
    },
    [projectId, queryClient, resolvedChapterId, user?.id, workbenchQueryKey]
  );

  useLayoutEffect(() => {
    if (!workbenchProjection) return;
    const workbench = workbenchProjection;
    const chapterChanged = hydratedChapterIdRef.current !== workbench.chapter.id;
    // Every canonical read arrives here. Adoption keeps a newer server draft
    // from replacing unsaved work held by this canvas.
    const adopt = shouldAdoptAuthoritativeStoryDraft({
      hydrated: hydratedRef.current,
      chapterChanged,
      authoritativeRevision: workbench.draft.revision,
      currentRevision: revisionRef.current,
      hasConflict: Boolean(conflictRef.current),
      hasLocalChanges: () => {
        const latest = latestContentRef.current;
        return Boolean(
          recoveryContentRef.current ||
          saveInFlightRef.current ||
          (latest && canonicalJsonString(latest) !== savedSignatureRef.current)
        );
      },
    });
    if (!adopt) return;
    if (chapterChanged) {
      // Navigation is leave-guarded, so these queues should already be clean.
      // Reset them defensively because revisions are chapter-local and two
      // chapters may legitimately both be at revision zero.
      if (saveDebounceTimerRef.current !== null) {
        window.clearTimeout(saveDebounceTimerRef.current);
        saveDebounceTimerRef.current = null;
      }
      if (saveRetryTimerRef.current !== null) {
        window.clearTimeout(saveRetryTimerRef.current);
        saveRetryTimerRef.current = null;
      }
      finalFlushGenerationRef.current += 1;
      finalFlushActiveRef.current = false;
      saveRetryAttemptRef.current = 0;
      inFlightSignatureRef.current = null;
      inFlightContentRef.current = null;
      queuedContentRef.current = null;
      recoveryContentRef.current = null;
      conflictRef.current = null;
      setConflict(null);
      setSaveError(null);
      setInspectorTarget(CLOSED_STORY_CANVAS_INSPECTOR);
      setCreatorMenu(null);
      setPendingCompletionDrop(null);
    }
    hydratedRef.current = true;
    hydratedChapterIdRef.current = workbench.chapter.id;
    revisionRef.current = workbench.draft.revision;
    setDraftRevision(workbench.draft.revision);
    const adoptedContent = stripRetiredStoryWorldNodes(
      materializeStoryDecisionNodes(migrateLegacyStoryHotspotIds(workbench.draft.content))
    );
    savedSignatureRef.current = canonicalJsonString(workbench.draft.content);
    latestContentRef.current = adoptedContent;
    history.clear();
    setHistoryVersion((current) => current + 1);
    setContentChapterId(workbench.chapter.id);
    setContent(adoptedContent);
    setSaveState("idle");
  }, [history, setInspectorTarget, workbenchProjection]);

  const clearSaveRetry = useCallback((resetAttempts = false) => {
    if (saveRetryTimerRef.current !== null) {
      window.clearTimeout(saveRetryTimerRef.current);
      saveRetryTimerRef.current = null;
    }
    if (resetAttempts) saveRetryAttemptRef.current = 0;
  }, []);

  const notifySaveSettled = useCallback(() => {
    const waiters = [...saveSettledWaitersRef.current];
    saveSettledWaitersRef.current.clear();
    waiters.forEach((resolve) => resolve());
  }, []);

  const waitForSaveToSettle = useCallback(() => {
    if (!saveInFlightRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => saveSettledWaitersRef.current.add(resolve));
  }, []);

  const scheduleSaveRetry = useCallback(() => {
    if (
      disposedRef.current ||
      saveRetryTimerRef.current !== null ||
      conflictRef.current ||
      !recoveryContentRef.current
    ) {
      return;
    }
    const delay = Math.min(1_000 * 2 ** saveRetryAttemptRef.current, 30_000);
    saveRetryAttemptRef.current += 1;
    saveRetryTimerRef.current = window.setTimeout(() => {
      saveRetryTimerRef.current = null;
      const recovery = recoveryContentRef.current;
      if (recovery && !disposedRef.current && !conflictRef.current) {
        void persistRef.current(recovery);
      }
    }, delay);
  }, []);

  const persist = useCallback(
    async (next: InteractiveStoryDraftContent, options: PersistDraftOptions = {}) => {
      if (!workspaceId || !resolvedChapterId || conflictRef.current || disposedRef.current) return;
      const signature = canonicalJsonString(next);
      if (draftSnapshotBarrierRef.current && !options.bypassSnapshotBarrier) {
        queuedContentRef.current = next;
        return;
      }
      if (saveInFlightRef.current) {
        queuedContentRef.current = signature === inFlightSignatureRef.current ? null : next;
        return;
      }
      if (signature === savedSignatureRef.current) {
        recoveryContentRef.current = null;
        clearSaveRetry(true);
        if (!disposedRef.current) {
          setSaveError(null);
          setSaveState((current) => (current === "idle" ? "idle" : "saved"));
        }
        return;
      }

      saveInFlightRef.current = true;
      inFlightSignatureRef.current = signature;
      inFlightContentRef.current = next;
      if (!disposedRef.current) {
        setSaveState("saving");
        setSaveError(null);
      }
      let shouldRetry = false;
      let requestFailed = false;
      let failure: unknown = null;
      try {
        const saved = await putStoryDraft(projectId, resolvedChapterId, {
          expectedRevision: revisionRef.current,
          content: next,
          sessionId,
        });
        if (saved.revision >= revisionRef.current) {
          revisionRef.current = saved.revision;
          savedSignatureRef.current = canonicalJsonString(saved.content);
          recoveryContentRef.current = null;
          clearSaveRetry(true);
          if (!disposedRef.current) {
            setDraftRevision(saved.revision);
            setSaveState("saved");
          }
          cacheSavedDraft(saved);
        }
      } catch (error) {
        const nextConflict = draftRevisionConflict(error);
        const confirmsOwnWrite = Boolean(
          nextConflict?.current.updatedBySessionId === sessionId &&
          canonicalJsonString(nextConflict.current.content) === signature
        );
        if (nextConflict && confirmsOwnWrite) {
          if (nextConflict.current.revision >= revisionRef.current) {
            revisionRef.current = nextConflict.current.revision;
            savedSignatureRef.current = canonicalJsonString(nextConflict.current.content);
            recoveryContentRef.current = null;
            clearSaveRetry(true);
            if (!disposedRef.current) {
              setDraftRevision(nextConflict.current.revision);
              setSaveError(null);
              setSaveState("saved");
            }
            cacheSavedDraft(nextConflict.current);
          }
        } else if (nextConflict) {
          failure = error;
          recoveryContentRef.current = next;
          conflictRef.current = nextConflict;
          queuedContentRef.current = null;
          clearSaveRetry(true);
          if (!disposedRef.current) {
            setConflict(nextConflict);
            setSaveState("conflict");
          }
        } else {
          failure = error;
          requestFailed = true;
          if (!disposedRef.current) {
            recoveryContentRef.current = next;
            shouldRetry = true;
            setSaveState("error");
            setSaveError(storyApiErrorMessage(error, commonT("errors.generic")));
          }
        }
      } finally {
        saveInFlightRef.current = false;
        inFlightSignatureRef.current = null;
        inFlightContentRef.current = null;
        if (requestFailed) {
          if (shouldRetry && !conflictRef.current) scheduleSaveRetry();
        } else {
          const queued = queuedContentRef.current;
          queuedContentRef.current = null;
          if (queued && !conflictRef.current) {
            void persistRef.current(queued);
          }
        }
        notifySaveSettled();
      }

      if (failure && options.propagateError) throw failure;
    },
    [
      cacheSavedDraft,
      clearSaveRetry,
      commonT,
      notifySaveSettled,
      projectId,
      resolvedChapterId,
      scheduleSaveRetry,
      sessionId,
      workspaceId,
    ]
  );

  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  /**
   * Save one exact authoring head and keep later local edits queued until the
   * Take endpoint has atomically captured that revision. This closes the race
   * where ordinary autosave could advance the Draft between PUT and POST.
   */
  const withSavedDraftSnapshot = useCallback(
    <T,>(submit: (draftRevision: number) => Promise<T>): Promise<T> =>
      draftSnapshotCoordinator.run({
        setBarrier: (active) => {
          draftSnapshotBarrierRef.current = active;
        },
        captureSnapshot: () => {
          if (!workspaceId || conflictRef.current || !latestContentRef.current) {
            throw new Error(saveError || commonT("errors.generic"));
          }
          if (saveDebounceTimerRef.current !== null) {
            window.clearTimeout(saveDebounceTimerRef.current);
            saveDebounceTimerRef.current = null;
          }
          clearSaveRetry();
          return latestContentRef.current;
        },
        waitForIdleSave: async () => {
          while (saveInFlightRef.current) await waitForSaveToSettle();
        },
        saveSnapshot: (snapshot) =>
          persistRef.current(snapshot, {
            bypassSnapshotBarrier: true,
            propagateError: true,
          }),
        savedRevision: (snapshot) => {
          if (
            conflictRef.current ||
            savedSignatureRef.current !== canonicalJsonString(snapshot) ||
            revisionRef.current < 1
          ) {
            throw new Error(saveError || commonT("errors.generic"));
          }
          return revisionRef.current;
        },
        submit,
        flushAfterRelease: () => {
          const latest = latestContentRef.current;
          const queued = queuedContentRef.current;
          queuedContentRef.current = null;
          const next = queued ?? latest;
          if (
            next &&
            !conflictRef.current &&
            canonicalJsonString(next) !== savedSignatureRef.current
          ) {
            void persistRef.current(next);
          }
        },
      }),
    [clearSaveRetry, commonT, draftSnapshotCoordinator, saveError, waitForSaveToSettle, workspaceId]
  );

  useEffect(() => {
    latestContentRef.current = content;
    if (!content || !hydratedRef.current || conflict) return;
    const signature = canonicalJsonString(content);
    if (saveInFlightRef.current) {
      const matchesInFlight = signature === inFlightSignatureRef.current;
      setSaveState(matchesInFlight ? "saving" : "dirty");
      void persistRef.current(content);
      return;
    }
    if (recoveryContentRef.current) {
      const matchesRecovery = signature === canonicalJsonString(recoveryContentRef.current);
      queuedContentRef.current = matchesRecovery ? null : content;
      if (!matchesRecovery) setSaveState("dirty");
      scheduleSaveRetry();
      return;
    }
    if (signature === savedSignatureRef.current) {
      clearSaveRetry(true);
      setSaveError(null);
      setSaveState((current) => (current === "idle" ? "idle" : "saved"));
      return;
    }
    setSaveState("dirty");
    saveDebounceTimerRef.current = window.setTimeout(() => {
      saveDebounceTimerRef.current = null;
      void persistRef.current(content);
    }, 700);
    return () => {
      if (saveDebounceTimerRef.current !== null) {
        window.clearTimeout(saveDebounceTimerRef.current);
        saveDebounceTimerRef.current = null;
      }
    };
  }, [clearSaveRetry, conflict, content, scheduleSaveRetry]);

  const flushDraftBeforeLeaving = useCallback(
    (keepalive: boolean) => {
      if (
        !workspaceId ||
        !resolvedChapterId ||
        conflictRef.current ||
        finalFlushActiveRef.current ||
        !latestContentRef.current
      ) {
        return;
      }

      const latest = latestContentRef.current;
      const hasUnsavedContent = Boolean(
        recoveryContentRef.current ||
        inFlightContentRef.current ||
        canonicalJsonString(latest) !== savedSignatureRef.current
      );
      if (!hasUnsavedContent) return;
      const baseline =
        recoveryContentRef.current ?? inFlightContentRef.current ?? latestContentRef.current;
      const expectedRevision = revisionRef.current;
      queuedContentRef.current = null;
      finalFlushActiveRef.current = true;
      const generation = finalFlushGenerationRef.current + 1;
      finalFlushGenerationRef.current = generation;

      const saveOnce = async (next: InteractiveStoryDraftContent, expected: number) => {
        try {
          return await putStoryDraft(
            projectId,
            resolvedChapterId,
            { expectedRevision: expected, content: next, sessionId },
            keepalive ? { keepalive: true } : undefined
          );
        } catch (error) {
          const nextConflict = draftRevisionConflict(error);
          if (
            nextConflict?.current.updatedBySessionId === sessionId &&
            canonicalJsonString(nextConflict.current.content) === canonicalJsonString(next)
          ) {
            return nextConflict.current;
          }
          throw error;
        }
      };
      const saveWithResponseRecovery = async (
        next: InteractiveStoryDraftContent,
        expected: number
      ) => {
        try {
          return await saveOnce(next, expected);
        } catch (error) {
          if (draftRevisionConflict(error)) throw error;
          return saveOnce(next, expected);
        }
      };
      const acceptSavedDraft = (saved: StoryWorkbench["draft"]): boolean => {
        if (generation !== finalFlushGenerationRef.current) return false;
        if (saved.revision < revisionRef.current) return false;
        revisionRef.current = saved.revision;
        savedSignatureRef.current = canonicalJsonString(saved.content);
        recoveryContentRef.current = null;
        clearSaveRetry(true);
        cacheSavedDraft(saved);
        if (!disposedRef.current) {
          setDraftRevision(saved.revision);
          setSaveError(null);
          setSaveState("saved");
        }
        return true;
      };

      void (async () => {
        let pending = baseline;
        try {
          let saved = await saveWithResponseRecovery(baseline, expectedRevision);
          if (!acceptSavedDraft(saved)) return;
          if (canonicalJsonString(latest) !== canonicalJsonString(saved.content)) {
            pending = latest;
            saved = await saveWithResponseRecovery(latest, saved.revision);
            acceptSavedDraft(saved);
          }
        } catch (error) {
          if (generation !== finalFlushGenerationRef.current) return;
          if (disposedRef.current) return;
          const nextConflict = draftRevisionConflict(error);
          if (nextConflict) {
            recoveryContentRef.current = pending;
            conflictRef.current = nextConflict;
            queuedContentRef.current = null;
            clearSaveRetry(true);
            setConflict(nextConflict);
            setSaveState("conflict");
            return;
          }
          recoveryContentRef.current = pending;
          queuedContentRef.current =
            canonicalJsonString(latest) === canonicalJsonString(pending) ? null : latest;
          setSaveState("error");
          setSaveError(storyApiErrorMessage(error, commonT("errors.generic")));
          scheduleSaveRetry();
        } finally {
          if (generation === finalFlushGenerationRef.current) {
            finalFlushActiveRef.current = false;
          }
        }
      })();
    },
    [
      cacheSavedDraft,
      clearSaveRetry,
      commonT,
      projectId,
      resolvedChapterId,
      scheduleSaveRetry,
      sessionId,
      workspaceId,
    ]
  );

  const projectionCopy = {
    clip: t("projection.clip"),
    decision: t("projection.decision"),
  };
  // The storyboard is the node's production truth: the same query the board
  // uses paints per-node coverage on the canvas cards.
  const storyboardQuery = useQuery({
    queryKey: storyProductionKeys.storyboard(projectId, workbenchProjection?.chapter.id ?? null),
    queryFn: ({ signal }) =>
      getStoryStoryboard(projectId, workbenchProjection?.chapter.id as string, signal),
    enabled: Boolean(workbenchProjection?.chapter.id),
    retry: false,
  });
  const storyboardCoverage = useMemo(
    () => storyboardCoverageByNode(storyboardQuery.data ?? []),
    [storyboardQuery.data]
  );
  const [coverageStore] = useState(() => new StoryboardCoverageStore());
  useLayoutEffect(() => {
    coverageStore.replace(storyboardCoverage);
  }, [coverageStore, storyboardCoverage]);

  const model = useMemo(
    () =>
      content
        ? buildStoryCanvasModel(
            content,
            project?.defaultLocale ?? "en-US",
            projectionCopy,
            project?.frameProfile,
            interfaceLocale
          )
        : null,
    // Translation values are primitives. Depending on them keeps the model
    // stable across ordinary renders while still refreshing after a locale change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      content,
      project?.defaultLocale,
      interfaceLocale,
      project?.frameProfile,
      projectionCopy.clip,
      projectionCopy.decision,
    ]
  );
  const editPolicy = resolveStoryCanvasEditPolicy({
    basePermissions: {
      canEditContent: Boolean(
        project?.status === "active" && project.capabilities.includes("story.edit")
      ),
      canEditLayout: Boolean(
        project?.status === "active" && project.capabilities.includes("story.edit")
      ),
      canManageProduction: Boolean(
        project?.status === "active" && project.capabilities.includes("story.generate")
      ),
      canPreview: true,
      canPublish: Boolean(
        project?.status === "active" && project.capabilities.includes("story.release")
      ),
    },
    projectionReadiness,
    hasDraftConflict: Boolean(conflict),
    hasLayoutConflict: Boolean(layoutConflict),
  });
  const canEdit = Boolean(editPolicy.canEditContent);
  const canMutateCanvasLayout = Boolean(editPolicy.canEditLayout);
  const choicePickerNodes = useMemo(
    () =>
      content
        ? storyGraphNodePickerItems(
            content.graph.nodes,
            "",
            storyGraphNodePickerTitles(
              content.graph.nodes,
              t("nodeKinds.clip"),
              t("nodeKinds.decision")
            )
          )
        : [],
    [content, t]
  );
  const choiceStateVariables = content?.storyBible.stateVariables ?? NO_STORY_VARIABLES;
  const choiceEndings = content ? endingsInUse(content) : NO_STORY_ENDINGS;
  const choiceRuntimeRef = useRef<StoryCanvasChoiceContextValue>(null!);
  // The facade stays stable across storyboard refetches. Methods read the ref,
  // so an upload does not rebuild every visible card.
  const choiceContext = useMemo<StoryCanvasChoiceContextValue>(
    () => ({
      setCommunityPointPrice: (nodeId, price) =>
        choiceRuntimeRef.current.setCommunityPointPrice(nodeId, price),
      canEditContent: canEdit,
      canCreateOption: canMutateCanvasLayout,
      start: (sourceNodeId) => choiceRuntimeRef.current.start(sourceNodeId),
      updatePrompt: (sourceNodeId, prompt) =>
        choiceRuntimeRef.current.updatePrompt(sourceNodeId, prompt),
      updateChoice: (sourceNodeId, choiceId, label) =>
        choiceRuntimeRef.current.updateChoice(sourceNodeId, choiceId, label),
      moveChoice: (sourceNodeId, choiceId, direction) =>
        choiceRuntimeRef.current.moveChoice(sourceNodeId, choiceId, direction),
      removeChoice: (sourceNodeId, choiceId) =>
        choiceRuntimeRef.current.removeChoice(sourceNodeId, choiceId),
      stateVariables: choiceStateVariables,
      endings: choiceEndings,
      nodes: choicePickerNodes,
      locale: authoringLocale,
      patchChoice: (sourceNodeId, choiceId, patch) =>
        choiceRuntimeRef.current.patchChoice(sourceNodeId, choiceId, patch),
      createEndingForChoice: (sourceNodeId, choiceId) =>
        choiceRuntimeRef.current.createEndingForChoice(sourceNodeId, choiceId),
      updateEnding: (endingId, patch) => choiceRuntimeRef.current.updateEnding(endingId, patch),
      deleteEnding: (endingId) => choiceRuntimeRef.current.deleteEnding(endingId),
    }),
    [
      authoringLocale,
      canEdit,
      canMutateCanvasLayout,
      choiceEndings,
      choicePickerNodes,
      choiceStateVariables,
    ]
  );

  useLayoutEffect(() => {
    mutationBarrier.update({
      canEditContent: canEdit,
      canEditLayout: canMutateCanvasLayout,
      canManageProduction: editPolicy.canManageProduction,
    });
  }, [canEdit, canMutateCanvasLayout, editPolicy.canManageProduction, mutationBarrier]);

  useEffect(() => {
    canvasNodesRef.current = canvasNodes;
  }, [canvasNodes]);

  useLayoutEffect(() => {
    if (
      !model ||
      !layoutProjection ||
      !workbenchProjection ||
      contentChapterId !== workbenchProjection.chapter.id ||
      layoutProjection.chapterId !== workbenchProjection.chapter.id
    ) {
      return;
    }
    const chapterChanged = layoutHydratedChapterIdRef.current !== workbenchProjection.chapter.id;
    if (chapterChanged) {
      if (layoutRetryTimerRef.current !== null) {
        window.clearTimeout(layoutRetryTimerRef.current);
        layoutRetryTimerRef.current = null;
      }
      finalLayoutFlushGenerationRef.current += 1;
      finalLayoutFlushActiveRef.current = false;
      layoutRetryAttemptRef.current = 0;
      layoutHydratedRef.current = false;
      layoutConflictRef.current = null;
      latestDesiredLayoutRef.current = null;
      recoveryLayoutRef.current = null;
      pendingNodePositionsRef.current.clear();
      pendingCanvasSelectionRef.current = null;
      requestedCanvasFocusRef.current = null;
      latestCanvasSelectionRef.current = [];
      hasFittedInitialCanvasRef.current = false;
      pendingFitRef.current = false;
      setLayoutConflict(null);
      layoutHydratedChapterIdRef.current = workbenchProjection.chapter.id;
    }
    const latestDesiredLayout = latestDesiredLayoutRef.current;
    const hasLocalLayoutChanges = Boolean(
      recoveryLayoutRef.current ||
      layoutSaveInFlightRef.current ||
      pendingNodePositionsRef.current.size > 0 ||
      (latestDesiredLayout &&
        layoutPayloadSignature(latestDesiredLayout) !== layoutSavedSignatureRef.current)
    );
    const shouldAdoptAuthoritativeLayout = shouldAdoptAuthoritativeCanvasLayout({
      authoritativeRevision: layoutProjection.revision,
      currentRevision: layoutRevisionRef.current,
      hasConflict: Boolean(layoutConflictRef.current),
      hasLocalChanges: hasLocalLayoutChanges,
      hydrated: layoutHydratedRef.current,
    });
    const storedPosition = (node: StoryCanvasNode) => {
      const position = layoutProjection.nodePositions[node.id];
      if (position || node.data.kind !== "decision") return position;
      const oldSource = workbenchProjection.draft.content.graph.nodes.find(
        (candidate) =>
          candidate.kind === "clip" &&
          candidate.exit.kind === "choice" &&
          candidate.exit.decisionId === node.data.decisionId
      );
      const sourceId =
        oldSource?.nodeId ??
        (node.id.startsWith("decision:") ? node.id.slice("decision:".length) : null);
      return sourceId
        ? layoutProjection.nodePositions[storyDecisionCanvasNodeId(sourceId)]
        : undefined;
    };
    const currentById = new Map(canvasNodesRef.current.map((node) => [node.id, node]));
    const pendingSelection = pendingCanvasSelectionRef.current;
    const hydrating = !layoutHydratedRef.current;
    const rememberedView =
      useStoryProjectUiStore.getState().canvasViews[
        storyCanvasViewKey(projectId, workbenchProjection.chapter.id)
      ];
    const selectedNodeIds = storyCanvasHydrationSelection(
      model.nodes.map((node) => node.id),
      canvasNodesRef.current.filter((node) => node.selected).map((node) => node.id),
      rememberedView?.selectedNodeIds ?? [],
      pendingSelection,
      !hydrating
    );
    const pendingCopies = pendingCopiedNodeIdsRef.current;
    if (
      pendingCopies &&
      pendingCopies.every((nodeId) => model.nodes.some((node) => node.id === nodeId))
    ) {
      selectedNodeIds.clear();
      pendingCopies.forEach((nodeId) => selectedNodeIds.add(nodeId));
      pendingCopiedNodeIdsRef.current = null;
    }
    if (pendingSelection && selectedNodeIds.has(pendingSelection)) {
      pendingCanvasSelectionRef.current = null;
    }

    const reconcileFocusAfterModel = (nodes: StoryCanvasNode[]) => {
      const nextSelectedNodeIds = nodes.filter((node) => node.selected).map((node) => node.id);
      latestCanvasSelectionRef.current = nextSelectedNodeIds;
      if (pendingSelection && !selectedNodeIds.has(pendingSelection)) return;
      setInspectorTarget((current) =>
        reconcileStoryCanvasInspectorTarget(current, nextSelectedNodeIds)
      );
    };

    if (!layoutHydratedRef.current) {
      const initialNodes = model.nodes.map((node) => ({
        ...node,
        position: storedPosition(node) ?? node.position,
        selected: selectedNodeIds.has(node.id),
      }));
      const initialLayout = canvasLayoutPayload(initialNodes);
      layoutHydratedRef.current = true;
      layoutRevisionRef.current = layoutProjection.revision;
      latestDesiredLayoutRef.current = initialLayout;
      layoutSavedSignatureRef.current = layoutPayloadSignature(initialLayout);
      canvasNodesRef.current = initialNodes;
      setCanvasNodes(initialNodes);
      setInspectorTarget(
        storyCanvasInspectorToRestore(rememberedView?.inspectorTarget, selectedNodeIds)
      );
      reconcileFocusAfterModel(initialNodes);
      return;
    }
    if (shouldAdoptAuthoritativeLayout) {
      layoutRevisionRef.current = layoutProjection.revision;
      history.clear();
      setHistoryVersion((current) => current + 1);
    }
    const placedNodeIds: string[] = [];
    const projectedNodes = model.nodes.map((node) => {
      const pendingPosition = pendingNodePositionsRef.current.get(node.id);
      if (pendingPosition) placedNodeIds.push(node.id);
      return {
        ...node,
        selected: selectedNodeIds.has(node.id),
        position:
          pendingPosition ??
          (shouldAdoptAuthoritativeLayout
            ? storedPosition(node)
            : (currentById.get(node.id)?.position ?? storedPosition(node))) ??
          node.position,
      };
    });
    const nextNodes = reuseStoryCanvasNodes(canvasNodesRef.current, projectedNodes);
    placedNodeIds.forEach((nodeId) => pendingNodePositionsRef.current.delete(nodeId));
    if (nextNodes !== canvasNodesRef.current) {
      canvasNodesRef.current = [...nextNodes];
      setCanvasNodes([...nextNodes]);
    }
    reconcileFocusAfterModel(canvasNodesRef.current);
    if (shouldAdoptAuthoritativeLayout) {
      const adoptedLayout = canvasLayoutPayload(nextNodes);
      latestDesiredLayoutRef.current = adoptedLayout;
      layoutSavedSignatureRef.current = layoutPayloadSignature(adoptedLayout);
    }
    if (placedNodeIds.length > 0) {
      const nextLayout = canvasLayoutPayload(nextNodes);
      void persistLayoutRef.current(nextLayout);
    }
  }, [
    contentChapterId,
    history,
    layoutProjection,
    model,
    projectId,
    setCanvasNodes,
    setInspectorTarget,
    workbenchProjection,
  ]);

  const clearLayoutSaveRetry = useCallback((resetAttempts = false) => {
    if (layoutRetryTimerRef.current !== null) {
      window.clearTimeout(layoutRetryTimerRef.current);
      layoutRetryTimerRef.current = null;
    }
    if (resetAttempts) layoutRetryAttemptRef.current = 0;
  }, []);

  const scheduleLayoutSaveRetry = useCallback(() => {
    if (
      disposedRef.current ||
      layoutRetryTimerRef.current !== null ||
      layoutConflictRef.current ||
      !recoveryLayoutRef.current
    ) {
      return;
    }
    const delay = layoutRetryDelay(layoutRetryAttemptRef.current);
    layoutRetryAttemptRef.current += 1;
    layoutRetryTimerRef.current = window.setTimeout(() => {
      layoutRetryTimerRef.current = null;
      const recovery = recoveryLayoutRef.current;
      if (recovery && !disposedRef.current && !layoutConflictRef.current) {
        void persistLayoutRef.current(recovery, { preserveDesired: true });
      }
    }, delay);
  }, []);

  const persistLayout = useCallback(
    async (next: StoryCanvasLayoutPayload, options: PersistLayoutOptions = {}) => {
      if (!workspaceId || !resolvedChapterId || layoutConflictRef.current) return;
      const signature = layoutPayloadSignature(next);
      if (!options.preserveDesired) latestDesiredLayoutRef.current = next;
      if (layoutSaveInFlightRef.current) {
        return;
      }
      const recovery = recoveryLayoutRef.current;
      if (recovery && signature !== layoutPayloadSignature(recovery)) {
        scheduleLayoutSaveRetry();
        return;
      }
      if (signature === layoutSavedSignatureRef.current) {
        recoveryLayoutRef.current = null;
        clearLayoutSaveRetry(true);
        return;
      }

      clearLayoutSaveRetry();
      recoveryLayoutRef.current = next;
      layoutSaveInFlightRef.current = true;
      let requestFailed = false;
      let requestConflicted = false;
      let failure: unknown = null;
      try {
        const saved = await putStoryCanvasLayout(projectId, resolvedChapterId, {
          expectedRevision: layoutRevisionRef.current,
          nodePositions: next.nodePositions,
          sessionId,
        });
        layoutRevisionRef.current = saved.revision;
        layoutSavedSignatureRef.current = signature;
        recoveryLayoutRef.current = null;
        clearLayoutSaveRetry(true);
      } catch (error) {
        const nextConflict = canvasLayoutRevisionConflict(error);
        const confirmsOwnWrite = Boolean(
          nextConflict && confirmsOwnCanvasLayoutWrite(nextConflict.current, sessionId, signature)
        );
        if (nextConflict && confirmsOwnWrite) {
          layoutRevisionRef.current = nextConflict.current.revision;
          layoutSavedSignatureRef.current = signature;
          recoveryLayoutRef.current = null;
          clearLayoutSaveRetry(true);
        } else if (nextConflict) {
          failure = error;
          requestConflicted = true;
          layoutConflictRef.current = nextConflict;
          recoveryLayoutRef.current = next;
          clearLayoutSaveRetry(true);
          setCreatorMenu(null);
          setPendingCompletionDrop(null);
          setLayoutConflict(nextConflict);
        } else {
          failure = error;
          requestFailed = true;
          recoveryLayoutRef.current = next;
        }
      } finally {
        layoutSaveInFlightRef.current = false;
        if (!requestConflicted) {
          if (requestFailed) {
            scheduleLayoutSaveRetry();
          } else {
            const desired = unsavedDesiredLayout(
              latestDesiredLayoutRef.current,
              layoutSavedSignatureRef.current
            );
            if (desired) {
              void persistLayoutRef.current(desired, { preserveDesired: true });
            }
          }
        }
      }

      if (failure && options.propagateError) throw failure;
    },
    [
      clearLayoutSaveRetry,
      projectId,
      resolvedChapterId,
      scheduleLayoutSaveRetry,
      sessionId,
      workspaceId,
    ]
  );

  useEffect(() => {
    persistLayoutRef.current = persistLayout;
  }, [persistLayout]);

  useEffect(() => {
    if (layoutConflictRef.current) return;
    const desired = unsavedDesiredLayout(
      latestDesiredLayoutRef.current,
      layoutSavedSignatureRef.current
    );
    if (!desired) return;
    recoveryLayoutRef.current = desired;
    scheduleLayoutSaveRetry();
  }, [scheduleLayoutSaveRetry]);

  useEffect(() => () => clearLayoutSaveRetry(), [clearLayoutSaveRetry]);

  const flushLayoutBeforeLeaving = useCallback(
    (keepalive: boolean) => {
      if (
        !workspaceId ||
        !resolvedChapterId ||
        layoutConflictRef.current ||
        layoutSaveInFlightRef.current ||
        finalLayoutFlushActiveRef.current
      ) {
        return;
      }

      const next = unsavedDesiredLayout(
        recoveryLayoutRef.current ?? latestDesiredLayoutRef.current,
        layoutSavedSignatureRef.current
      );
      if (!next) return;

      recoveryLayoutRef.current = next;
      finalLayoutFlushActiveRef.current = true;
      const generation = finalLayoutFlushGenerationRef.current + 1;
      finalLayoutFlushGenerationRef.current = generation;
      const expectedRevision = layoutRevisionRef.current;

      const acceptSavedLayout = (saved: StoryCanvasLayout): boolean => {
        if (generation !== finalLayoutFlushGenerationRef.current) return false;
        if (saved.revision < layoutRevisionRef.current) return false;
        layoutRevisionRef.current = saved.revision;
        layoutSavedSignatureRef.current = layoutPayloadSignature({
          nodePositions: saved.nodePositions,
        });
        recoveryLayoutRef.current = null;
        clearLayoutSaveRetry(true);
        queryClient.setQueryData(layoutQueryKey, saved);
        return true;
      };

      void putStoryCanvasLayout(
        projectId,
        resolvedChapterId,
        {
          expectedRevision,
          nodePositions: next.nodePositions,
          sessionId,
        },
        keepalive ? { keepalive: true } : undefined
      )
        .then(acceptSavedLayout)
        .catch((error: unknown) => {
          if (generation !== finalLayoutFlushGenerationRef.current) return;
          const nextConflict = canvasLayoutRevisionConflict(error);
          if (
            nextConflict &&
            confirmsOwnCanvasLayoutWrite(
              nextConflict.current,
              sessionId,
              layoutPayloadSignature(next)
            )
          ) {
            acceptSavedLayout(nextConflict.current);
            return;
          }
          recoveryLayoutRef.current = next;
          if (nextConflict) layoutConflictRef.current = nextConflict;
          if (disposedRef.current) return;
          if (nextConflict) {
            setLayoutConflict(nextConflict);
            return;
          }
          scheduleLayoutSaveRetry();
        })
        .finally(() => {
          if (generation === finalLayoutFlushGenerationRef.current) {
            finalLayoutFlushActiveRef.current = false;
          }
        });
    },
    [
      clearLayoutSaveRetry,
      layoutQueryKey,
      projectId,
      resolvedChapterId,
      queryClient,
      scheduleLayoutSaveRetry,
      sessionId,
      workspaceId,
    ]
  );

  useEffect(() => {
    disposedRef.current = false;
    let pageHiding = false;
    const flushBeforeLeaving = (keepalive: boolean) => {
      if (saveDebounceTimerRef.current !== null) {
        window.clearTimeout(saveDebounceTimerRef.current);
        saveDebounceTimerRef.current = null;
      }
      clearSaveRetry();
      clearLayoutSaveRetry();
      flushDraftBeforeLeaving(keepalive);
      flushLayoutBeforeLeaving(keepalive);
    };
    const flushOnPageHide = () => {
      pageHiding = true;
      flushBeforeLeaving(true);
    };
    const restoreAfterPageShow = () => {
      pageHiding = false;
      disposedRef.current = false;
      finalFlushGenerationRef.current += 1;
      finalFlushActiveRef.current = false;
      finalLayoutFlushGenerationRef.current += 1;
      finalLayoutFlushActiveRef.current = false;
      clearSaveRetry();
      clearLayoutSaveRetry();

      const draftRecovery = recoveryContentRef.current;
      const latestDraft = latestContentRef.current;
      if (draftRecovery) {
        queuedContentRef.current =
          latestDraft && canonicalJsonString(latestDraft) !== canonicalJsonString(draftRecovery)
            ? latestDraft
            : null;
        if (!saveInFlightRef.current) void persistRef.current(draftRecovery);
      } else if (latestDraft && canonicalJsonString(latestDraft) !== savedSignatureRef.current) {
        void persistRef.current(latestDraft);
      }

      const layoutRecovery = unsavedDesiredLayout(
        recoveryLayoutRef.current ?? latestDesiredLayoutRef.current,
        layoutSavedSignatureRef.current
      );
      if (layoutRecovery && !layoutSaveInFlightRef.current) {
        recoveryLayoutRef.current = layoutRecovery;
        void persistLayoutRef.current(layoutRecovery, { preserveDesired: true });
      }
    };

    window.addEventListener("pagehide", flushOnPageHide);
    window.addEventListener("pageshow", restoreAfterPageShow);
    return () => {
      window.removeEventListener("pagehide", flushOnPageHide);
      window.removeEventListener("pageshow", restoreAfterPageShow);
      disposedRef.current = true;
      flushBeforeLeaving(pageHiding);
    };
  }, [clearLayoutSaveRetry, clearSaveRetry, flushDraftBeforeLeaving, flushLayoutBeforeLeaving]);

  const focusedNode = useMemo(
    () => model?.nodes.find((node) => node.id === focusedNodeId) ?? null,
    [focusedNodeId, model?.nodes]
  );
  const inspectorOpen = focusedNode?.data.kind === "clip";
  const interactionEditorNode =
    content?.graph.nodes.find(
      (node): node is StoryClipGraphNode =>
        node.nodeId === interactionEditorNodeId && node.kind === "clip"
    ) ?? null;

  const layeredCanvasNodes = useMemo(
    () =>
      canvasNodes.map((node) => {
        // Keep ports above edge hit areas so an input can receive more connections.
        const zIndex = node.id === focusedNodeId ? 100 : 3;
        return node.zIndex === zIndex ? node : { ...node, zIndex };
      }),
    [canvasNodes, focusedNodeId]
  );
  const displayEdges = useMemo(
    () =>
      model?.edges.map((edge) => {
        const related =
          !focusedNodeId || edge.source === focusedNodeId || edge.target === focusedNodeId;
        return {
          ...edge,
          type: "storyCanvas" as const,
          zIndex: related ? 2 : 0,
          style: {
            ...DEFAULT_EDGE_OPTIONS.style,
            opacity: related ? 1 : 0.18,
            stroke:
              edge.data.kind === "choice" || edge.data.kind === "interaction"
                ? STORY_PORT_COLORS.choice
                : "rgba(255,255,255,0.34)",
          },
          labelStyle: { fill: "rgba(255,255,255,0.68)", fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: "rgba(24,24,24,0.88)", fillOpacity: 1 },
          labelBgPadding: [7, 4] as [number, number],
          labelBgBorderRadius: 8,
        };
      }) ?? [],
    [focusedNodeId, model]
  );

  useEffect(() => {
    setCanvasEdges((current) => {
      const selectedById = new Map(
        current.map((edge) => [edge.id, Boolean(edge.selected)] as const)
      );
      return displayEdges.map((edge) => ({
        ...edge,
        selected: selectedById.get(edge.id) ?? false,
      }));
    });
  }, [displayEdges, setCanvasEdges]);

  useEffect(() => {
    if (!canvasNodes.length || hasFittedInitialCanvasRef.current) return;
    const saved = canvasViewKey
      ? (useStoryProjectUiStore.getState().canvasViews[canvasViewKey] ?? null)
      : null;
    const restore = !pendingFitRef.current && saved !== null;
    if (restore && saved) {
      hasFittedInitialCanvasRef.current = true;
      pendingFitRef.current = false;
      void setViewport(saved.viewport, { duration: 0 });
      return;
    }
    const timer = window.setTimeout(() => {
      if (hasFittedInitialCanvasRef.current) return;
      hasFittedInitialCanvasRef.current = true;
      pendingFitRef.current = false;
      void fitView({ padding: 0.16, duration: 420, maxZoom: 0.78 });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [cameraTick, canvasNodes.length, canvasViewKey, fitView, setViewport]);

  useEffect(() => {
    if (
      !requestedFocusNodeId ||
      !resolvedChapterId ||
      contentChapterId !== resolvedChapterId ||
      !nodesInitialized
    ) {
      return;
    }
    const focusKey = `${resolvedChapterId}:${requestedFocusNodeId}`;
    if (appliedFocusRef.current === focusKey) return;
    if (!canvasNodes.some((node) => node.id === requestedFocusNodeId)) return;
    appliedFocusRef.current = focusKey;
    hasFittedInitialCanvasRef.current = true;
    selectCanvasNodeExclusively(requestedFocusNodeId);
    void fitView({
      nodes: [{ id: requestedFocusNodeId }],
      padding: 0.45,
      duration: 450,
      maxZoom: 0.85,
    });
  }, [
    canvasNodes,
    contentChapterId,
    fitView,
    nodesInitialized,
    requestedFocusNodeId,
    resolvedChapterId,
    selectCanvasNodeExclusively,
  ]);

  const closeCreatorMenu = useCallback(() => setCreatorMenu(null), []);

  const refreshHistoryState = useCallback(() => {
    setHistoryVersion((current) => current + 1);
  }, []);

  const readHistorySnapshot = useCallback(
    (snapshotContent = latestContentRef.current): StoryCanvasHistorySnapshot | null => {
      if (!snapshotContent) return null;
      return {
        content: snapshotContent,
        nodePositions: historyNodePositions(
          snapshotContent,
          canvasNodesRef.current,
          pendingNodePositionsRef.current
        ),
      };
    },
    []
  );

  /**
   * The single persistence path for a layout move, so the edit barrier, the
   * undo snapshot and the no-op signature check stay on one path.
   */
  const commitCanvasLayout = useCallback(
    (nextNodes: StoryCanvasNode[], beforeMove: StoryCanvasHistorySnapshot | null) => {
      if (!mutationBarrier.permits("layout")) return;
      const nextLayout = canvasLayoutPayload(nextNodes);
      if (
        beforeMove &&
        layoutPositionSignature(beforeMove.nodePositions) !==
          layoutPositionSignature(nextLayout.nodePositions)
      ) {
        history.capture(beforeMove);
        refreshHistoryState();
      }
      if (layoutPayloadSignature(nextLayout) === layoutSavedSignatureRef.current) return;
      void persistLayoutRef.current(nextLayout);
    },
    [history, mutationBarrier, refreshHistoryState]
  );

  const restoreHistorySnapshot = useCallback(
    (snapshot: StoryCanvasHistorySnapshot) => {
      if (!mutationBarrier.permits("layout")) return;
      const currentSnapshot = readHistorySnapshot();
      const nextLayout: StoryCanvasLayoutPayload = {
        nodePositions: snapshot.nodePositions,
      };
      const layoutChanged =
        !currentSnapshot ||
        layoutPayloadSignature({
          nodePositions: currentSnapshot.nodePositions,
        }) !== layoutPayloadSignature(nextLayout);

      const restoredContent = stripRetiredStoryWorldNodes(
        materializeStoryDecisionNodes(migrateLegacyStoryHotspotIds(snapshot.content))
      );
      latestContentRef.current = restoredContent;
      setPendingCompletionDrop(null);
      closeCreatorMenu();
      setGraphError(null);
      setContent(restoredContent);

      if (!layoutChanged) return;
      pendingNodePositionsRef.current.clear();
      Object.entries(snapshot.nodePositions).forEach(([nodeId, position]) => {
        pendingNodePositionsRef.current.set(nodeId, { ...position });
      });
      setCanvasNodes((current) => {
        const next = current.map((node) => ({
          ...node,
          position: snapshot.nodePositions[node.id] ?? node.position,
        }));
        current.forEach((node) => pendingNodePositionsRef.current.delete(node.id));
        canvasNodesRef.current = next;
        return next;
      });
      void persistLayoutRef.current(nextLayout);
    },
    [closeCreatorMenu, mutationBarrier, readHistorySnapshot, setCanvasNodes]
  );

  const undoStoryCanvas = useCallback(() => {
    if (!mutationBarrier.permits("layout")) return;
    const current = readHistorySnapshot();
    if (!current) return;
    const previous = history.undo(current);
    if (!previous) return;
    refreshHistoryState();
    restoreHistorySnapshot(previous);
  }, [history, mutationBarrier, readHistorySnapshot, refreshHistoryState, restoreHistorySnapshot]);

  const redoStoryCanvas = useCallback(() => {
    if (!mutationBarrier.permits("layout")) return;
    const current = readHistorySnapshot();
    if (!current) return;
    const next = history.redo(current);
    if (!next) return;
    refreshHistoryState();
    restoreHistorySnapshot(next);
  }, [history, mutationBarrier, readHistorySnapshot, refreshHistoryState, restoreHistorySnapshot]);

  useCanvasHistoryShortcuts({
    enabled: canMutateCanvasLayout,
    undo: undoStoryCanvas,
    redo: redoStoryCanvas,
  });

  const storyClipboardRef = useRef<{
    sources: StoryDuplicateSource[];
    positions: Map<string, StoryCanvasPosition>;
    pastes: number;
  } | null>(null);
  const pasteStorySelectionRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!canMutateCanvasLayout) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="textbox"], .nokey'
        )
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      if (!event.metaKey && !event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key !== "c" && key !== "v") return;
      if (event.shiftKey || event.altKey) return;
      if (key === "c") {
        const sources = storyDuplicateSources(canvasNodesRef.current);
        if (sources.length === 0) return;
        event.preventDefault();
        storyClipboardRef.current = {
          sources,
          positions: new Map(
            canvasNodesRef.current
              .filter((node) => sources.some((source) => source.canvasId === node.id))
              .map((node) => [node.id, { ...node.position }])
          ),
          pastes: 0,
        };
        return;
      }
      if (!storyClipboardRef.current) return;
      event.preventDefault();
      pasteStorySelectionRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canMutateCanvasLayout]);

  const commitContent = (
    next: InteractiveStoryDraftContent,
    options: CommitContentOptions = {}
  ): boolean => {
    // This is the final write barrier. Event handlers also gate eagerly for
    // UX, but a stale callback must never bypass a newly acquired Agent lock,
    // conflict, or permission change.
    if (!mutationBarrier.permits("content")) return false;
    const current = latestContentRef.current;
    if (!current) return false;
    const normalizedNext = stripRetiredStoryWorldNodes(
      materializeStoryDecisionNodes(migrateLegacyStoryHotspotIds(next))
    );
    if (normalizedNext === current) return false;
    const snapshot = readHistorySnapshot(current);
    if (!snapshot) return false;
    history.capture(snapshot, { mergeKey: options.mergeKey });
    refreshHistoryState();
    latestContentRef.current = normalizedNext;
    setContent(normalizedNext);
    return true;
  };

  // Story-bible edits arrive from the overview dock through the registered
  // foundationWriter while this canvas is mounted, keeping the canvas the
  // draft's only writer (autosave, undo history).
  const updateFoundation = (patch: StoryBibleWriterPatch) => {
    const current = latestContentRef.current;
    if (!current || !mutationBarrier.permits("content")) return;
    commitContent(applyStoryBiblePatch(current, patch), {
      mergeKey: `foundation:${Object.keys(patch).sort().join(":")}`,
    });
  };
  const updateFoundationRef = useRef(updateFoundation);
  useLayoutEffect(() => {
    updateFoundationRef.current = updateFoundation;
  });

  const applyGraphMutation = (
    mutation: (current: InteractiveStoryDraftContent) => InteractiveStoryDraftContent,
    options: CommitContentOptions = {}
  ): boolean => {
    const current = latestContentRef.current;
    if (!current || !mutationBarrier.permits("content")) {
      return false;
    }
    try {
      const next = mutation(current);
      setGraphError(null);
      return commitContent(next, options);
    } catch {
      setGraphError(t("graphError.generic"));
      return false;
    }
  };

  const updateEnding = (endingId: string, patch: Pick<StoryBibleEnding, "title">) => {
    applyGraphMutation(
      (current) => {
        const ending = (current.storyBible.endings ?? []).find(
          (candidate) => candidate.endingId === endingId
        );
        return ending ? putStoryEnding(current, { ...ending, ...patch }) : current;
      },
      { mergeKey: `ending:${endingId}:${Object.keys(patch).join(",")}:${authoringLocale}` }
    );
  };
  const deleteEnding = (endingId: string) => {
    applyGraphMutation((current) => removeStoryEnding(current, endingId));
  };

  useLayoutEffect(() => {
    choiceRuntimeRef.current = {
      setCommunityPointPrice: async (nodeId, price) => {
        if (!mutationBarrier.permits("content")) throw new Error(t("communityPrice.unavailable"));
        const current = latestContentRef.current;
        if (!current) throw new Error(t("communityPrice.unavailable"));
        const next = updateStoryCommunityPointPrice(current, nodeId, price);
        if (next !== current) {
          const applied = applyGraphMutation(() => next, {
            mergeKey: `community-price:${nodeId}`,
          });
          if (!applied) throw new Error(t("communityPrice.unavailable"));
        }
        await withSavedDraftSnapshot(async () => undefined);
      },
      canEditContent: canEdit,
      canCreateOption: canMutateCanvasLayout,
      start: (sourceNodeId) => {
        applyGraphMutation((current) => {
          const source = current.graph.nodes.find((node) => node.nodeId === sourceNodeId);
          const number = source?.exit.kind === "choice" ? source.exit.choices.length + 1 : 1;
          return addChoiceOption(current, sourceNodeId, null, authoringLocale, {
            label: t("interactionCard.defaultOption", { number }),
          }).content;
        });
      },
      updatePrompt: (sourceNodeId, prompt) => {
        applyGraphMutation(
          (current) => updateChoiceExitPrompt(current, sourceNodeId, authoringLocale, prompt),
          { mergeKey: `choice-prompt:${sourceNodeId}:${authoringLocale}` }
        );
      },
      updateChoice: (sourceNodeId, choiceId, label) => {
        applyGraphMutation(
          (current) =>
            updateChoiceOptionLabel(current, sourceNodeId, choiceId, authoringLocale, label),
          { mergeKey: `choice:${sourceNodeId}:${choiceId}:label:${authoringLocale}` }
        );
      },
      moveChoice: (sourceNodeId, choiceId, direction) => {
        applyGraphMutation((current) =>
          moveChoiceOption(current, sourceNodeId, choiceId, direction)
        );
      },
      removeChoice: (sourceNodeId, choiceId) => {
        applyGraphMutation((current) => removeChoiceOption(current, sourceNodeId, choiceId));
      },
      stateVariables: choiceStateVariables,
      endings: choiceEndings,
      nodes: choicePickerNodes,
      locale: authoringLocale,
      patchChoice: (sourceNodeId, choiceId, patch) => {
        applyGraphMutation((current) => updateChoiceStats(current, sourceNodeId, choiceId, patch), {
          mergeKey: `choice-stats:${sourceNodeId}:${choiceId}`,
        });
      },
      createEndingForChoice: (sourceNodeId, choiceId) => {
        applyGraphMutation((current) =>
          createStoryEndingForChoice(
            current,
            sourceNodeId,
            choiceId,
            authoringLocale,
            t("stats.untitledEnding")
          )
        );
      },
      updateEnding,
      deleteEnding,
    };
  });

  // Newborn cards live only in pendingNodePositionsRef until some later drag
  // persists the layout; an authoritative layout echo arriving before that
  // (realtime, revision adoption) doesn't know the node and snaps it back to
  // its model-default slot. Persist immediately so the placement sticks.
  const persistLayoutWithPendingPositions = (nextContent: InteractiveStoryDraftContent) => {
    const nextLayout: StoryCanvasLayoutPayload = {
      nodePositions: historyNodePositions(
        nextContent,
        canvasNodesRef.current,
        pendingNodePositionsRef.current
      ),
    };
    void persistLayoutRef.current(nextLayout);
  };

  useLayoutEffect(() => {
    pasteStorySelectionRef.current = () => {
      const clipboard = storyClipboardRef.current;
      const current = latestContentRef.current;
      if (!clipboard || clipboard.sources.length === 0 || !current) return;
      if (!mutationBarrier.permits("content")) return;
      const offset = 48 * (clipboard.pastes + 1);
      try {
        const duplicated = duplicateStoryNodes(current, clipboard.sources);
        if (duplicated.created.length === 0) return;
        for (const created of duplicated.created) {
          const position = clipboard.positions.get(created.canvasId);
          if (!position) continue;
          pendingNodePositionsRef.current.set(created.nodeId, {
            x: position.x + offset,
            y: position.y + offset,
          });
        }
        pendingCopiedNodeIdsRef.current = duplicated.created.map((created) => created.nodeId);
        if (!commitContent(duplicated.content)) {
          pendingCopiedNodeIdsRef.current = null;
          for (const created of duplicated.created) {
            pendingNodePositionsRef.current.delete(created.nodeId);
          }
          return;
        }
        clipboard.pastes += 1;
        persistLayoutWithPendingPositions(duplicated.content);
        setGraphError(null);
      } catch {
        setGraphError(t("graphError.generic"));
      }
    };
  });

  const createStoryElement = (kind: StoryNodeCreationKind, position: StoryCanvasPosition) => {
    if (!content || !mutationBarrier.permits("layout")) return;
    try {
      const result =
        kind === "decision"
          ? createDecisionNode(content, authoringLocale, {
              labels: [1, 2].map((number) => t("interactionCard.defaultOption", { number })),
            })
          : createClipNode(content);
      const nextContent = result.content;
      const createdCanvasNodeId = result.created.nodeId;

      pendingNodePositionsRef.current.set(createdCanvasNodeId, { ...position });
      if (commitContent(nextContent)) persistLayoutWithPendingPositions(nextContent);
      selectCanvasNodeExclusively(createdCanvasNodeId);
      setGraphError(null);
    } catch {
      setGraphError(t("graphError.generic"));
    } finally {
      closeCreatorMenu();
    }
  };

  const openCreatorMenuAtClientPosition = (clientPosition: StoryCanvasPosition) => {
    if (!mutationBarrier.permits("layout")) return;
    const container = canvasSectionRef.current?.getBoundingClientRect();
    if (!container) return;

    setPendingCompletionDrop(null);
    setCreatorMenu(
      resolveStoryNodeCreationMenuPlacement({
        clientPosition,
        container,
        flowPosition: screenToFlowPosition(clientPosition),
      })
    );
  };

  const createStoryElementFromDock = (kind: StoryNodeCreationKind) => {
    const container = canvasSectionRef.current?.getBoundingClientRect();
    if (!container) return;
    const flowCenter = screenToFlowPosition({
      x: container.left + container.width / 2,
      y: container.top + container.height / 2,
    });
    createStoryElement(
      kind,
      offsetStoryNodeDockCreationPosition(flowCenter, canvasNodesRef.current.length)
    );
  };

  const importPlot = async (
    plot: StoryPlotImport,
    mode: StoryPlotImportMode,
    media?: StoryPlotMediaBinding[]
  ) => {
    const isCurrentImport = () =>
      !disposedRef.current && activeCanvasViewKeyRef.current === canvasViewKey;
    const current = latestContentRef.current;
    if (
      !current ||
      !resolvedChapterId ||
      !isCurrentImport() ||
      !mutationBarrier.permits("content")
    ) {
      throw new Error(t("plotImport.errors.locked"));
    }
    if (saveDebounceTimerRef.current !== null) {
      window.clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = null;
    }
    queuedContentRef.current = null;
    while (saveInFlightRef.current) await waitForSaveToSettle();
    const latest = latestContentRef.current;
    if (
      !latest ||
      conflictRef.current ||
      !isCurrentImport() ||
      !mutationBarrier.permits("content")
    ) {
      throw new Error(t("plotImport.errors.locked"));
    }
    clearSaveRetry(true);
    const retained = mode === "replace" ? 0 : latest.graph.nodes.length;
    if (retained + plot.nodes.length > MAX_PLOT_IMPORT_CHAPTER_NODES) {
      throw new StoryPlotImportError("capacity", "$.nodes");
    }
    setSaveState("saving");
    setSaveError(null);
    try {
      const saved = await importStoryPlot(projectId, resolvedChapterId, {
        expectedRevision: revisionRef.current,
        content: latest,
        sessionId,
        locale: authoringLocale,
        mode,
        plot,
        ...(media?.length ? { media } : {}),
      });
      if (!isCurrentImport()) {
        cacheSavedDraft(saved.draft);
        return;
      }
      const snapshot = readHistorySnapshot(latest);
      if (snapshot) {
        history.capture(snapshot);
        refreshHistoryState();
      }
      const adopted = stripRetiredStoryWorldNodes(
        materializeStoryDecisionNodes(migrateLegacyStoryHotspotIds(saved.draft.content))
      );
      const importedNodes = adopted.graph.nodes.filter((node) =>
        saved.importedNodeIds.includes(node.nodeId)
      );
      const importedModel = buildStoryCanvasModel(
        {
          ...adopted,
          graph: {
            entryNodeId: importedNodes[0]?.nodeId ?? adopted.graph.entryNodeId,
            nodes: importedNodes,
          },
        },
        authoringLocale
      );
      if (importedModel.nodes.length > 0) {
        const top = Math.min(...importedModel.nodes.map((node) => node.position.y));
        const bottom =
          mode === "append" && canvasNodesRef.current.length
            ? Math.max(
                ...canvasNodesRef.current.map(
                  (node) => node.position.y + canvasNodeGeometry(node).estimatedHeight
                )
              ) + 160
            : top;
        importedModel.nodes.forEach((node) => {
          pendingNodePositionsRef.current.set(node.id, {
            x: node.position.x,
            y: node.position.y - top + bottom,
          });
        });
      }
      revisionRef.current = saved.draft.revision;
      savedSignatureRef.current = canonicalJsonString(adopted);
      latestContentRef.current = adopted;
      recoveryContentRef.current = null;
      setDraftRevision(saved.draft.revision);
      setContent(adopted);
      setSaveState("saved");
      cacheSavedDraft(saved.draft);
      void queryClient.invalidateQueries({
        queryKey: storyProductionKeys.assets(projectId, resolvedChapterId),
      });
      persistLayoutWithPendingPositions(adopted);
      hasFittedInitialCanvasRef.current = false;
      pendingFitRef.current = true;
      setCameraTick((tick) => tick + 1);
      setGraphError(null);
      toast.success(t(mode === "replace" ? "plotImport.replaced" : "plotImport.added"));
    } catch (error) {
      if (!isCurrentImport()) throw error;
      const importError = storyPlotImportError(error);
      const nextConflict = draftRevisionConflict(error);
      if (nextConflict) {
        conflictRef.current = nextConflict;
        queuedContentRef.current = null;
        setConflict(nextConflict);
        setSaveState("conflict");
        throw new Error(t("plotImport.errors.locked"));
      }
      const latestAfterFailure = latestContentRef.current;
      setSaveState(
        latestAfterFailure && canonicalJsonString(latestAfterFailure) !== savedSignatureRef.current
          ? "dirty"
          : "saved"
      );
      if (importError) throw importError;
      throw new Error(storyApiErrorMessage(error, t("plotImport.errors.locked")));
    }
  };

  const connectStoryNodes = (connection: Connection) => {
    if (
      !mutationBarrier.permits("content") ||
      !connection.source ||
      !connection.target ||
      !content ||
      !model ||
      !isValidStoryFlowConnection(connection, model.nodes)
    ) {
      return;
    }
    const source = model.nodes.find((node) => node.id === connection.source);
    const target = model.nodes.find((node) => node.id === connection.target);
    if (!source || !target) {
      return;
    }
    const choiceSourceNodeId =
      source.data.kind === "decision" ? source.data.sourceNodeId : undefined;
    const choiceId = choiceSourceNodeId ? choiceIdFromHandle(connection.sourceHandle) : null;
    applyGraphMutation((current) => {
      if (
        !isValidStoryFlowConnection(
          connection,
          buildStoryCanvasModel(current, authoringLocale).nodes
        )
      ) {
        return current;
      }
      if (choiceSourceNodeId && choiceId) {
        return connectChoiceTarget(current, choiceSourceNodeId, choiceId, target.data.nodeId);
      }
      if (source.data.exitKind === "auto" && connection.sourceHandle === "completion") {
        return connectSceneContinuation(current, source.data.nodeId, target.data.nodeId);
      }
      // Only completion and choice handles author story-flow connections.
      return current;
    });
  };

  const finishConnectionOnBlankCanvas = (
    event: MouseEvent | TouchEvent,
    connectionState: FinalConnectionState
  ) => {
    if (
      connectionState.isValid === true ||
      connectionState.fromHandle?.type !== "source" ||
      connectionState.toNode ||
      !isCanvasPaneTarget(event.target) ||
      !content ||
      !model ||
      !project ||
      !mutationBarrier.permits("layout")
    ) {
      return;
    }

    const source = model.nodes.find((node) => node.id === connectionState.fromNode?.id);
    const clientPosition = connectionDropClientPosition(event);
    if (!source || !clientPosition) return;
    const choiceSourceNodeId =
      source.data.kind === "decision" ? source.data.sourceNodeId : undefined;
    if (source.data.kind !== "clip" && !choiceSourceNodeId) return;
    const sourceHandleId = connectionState.fromHandle.id ?? "";
    if (
      source.data.kind === "decision"
        ? !canConnectStoryChoice(source.data, sourceHandleId)
        : !canConnectStoryCompletion(source.data)
    ) {
      return;
    }
    const dropPosition = screenToFlowPosition(clientPosition);

    if (
      source.data.kind === "clip" &&
      source.data.exitKind === "auto" &&
      sourceHandleId === "completion"
    ) {
      closeCreatorMenu();
      setPendingCompletionDrop({
        sourceCanvasNodeId: source.id,
        sourceHandleId,
        clientPosition,
        flowPosition: dropPosition,
      });
      return;
    }

    try {
      const created = createConnectedSceneForBlankDrop(content, source.data, sourceHandleId);
      if (!created) return;

      pendingNodePositionsRef.current.set(created.createdNodeId, {
        // The newly-created scene's input handle lands beside the release
        // point instead of placing the whole card underneath the pointer.
        x: dropPosition.x + 18,
        y: dropPosition.y - 108,
      });
      setGraphError(null);
      if (commitContent(created.content)) {
        persistLayoutWithPendingPositions(created.content);
      }
      closeCreatorMenu();
    } catch {
      setGraphError(t("graphError.generic"));
    }
  };

  const createCompletionStep = (kind: StoryConnectionCreationKind) => {
    const pending = pendingCompletionDrop;
    if (!mutationBarrier.permits("layout") || !pending || !content || !model) {
      return;
    }
    const source = model.nodes.find((node) => node.id === pending.sourceCanvasNodeId);
    if (!source || source.data.kind !== "clip" || !canConnectStoryCompletion(source.data)) {
      setPendingCompletionDrop(null);
      return;
    }

    try {
      if (kind === "choice") {
        const created = createDecisionNode(content, authoringLocale, {
          labels: [1, 2].map((number) => t("interactionCard.defaultOption", { number })),
        });
        const next = connectSceneContinuation(
          created.content,
          source.data.nodeId,
          created.created.nodeId
        );
        pendingNodePositionsRef.current.set(created.created.nodeId, pending.flowPosition);
        if (commitContent(next)) persistLayoutWithPendingPositions(next);
        selectCanvasNodeExclusively(created.created.nodeId);
      } else {
        const created = createConnectedSceneForBlankDrop(
          content,
          source.data,
          pending.sourceHandleId
        );
        if (!created) return;
        pendingNodePositionsRef.current.set(created.createdNodeId, {
          x: pending.flowPosition.x + 18,
          y: pending.flowPosition.y - 108,
        });
        commitContent(created.content);
      }
      setGraphError(null);
    } catch {
      setGraphError(t("graphError.generic"));
    } finally {
      setPendingCompletionDrop(null);
    }
  };

  const connectExistingCompletion = (targetNodeId: string) => {
    const pending = pendingCompletionDrop;
    if (!mutationBarrier.permits("content") || !pending || !content || !model) {
      setPendingCompletionDrop(null);
      return;
    }
    const source = model.nodes.find((node) => node.id === pending.sourceCanvasNodeId);
    if (!source || source.data.kind !== "clip" || !canConnectStoryCompletion(source.data)) {
      setPendingCompletionDrop(null);
      return;
    }
    try {
      const next = connectSceneContinuation(
        replaceIncomingStoryLinks(content, targetNodeId),
        source.data.nodeId,
        targetNodeId
      );
      setGraphError(null);
      commitContent(next);
    } catch {
      setGraphError(t("graphError.generic"));
    } finally {
      setPendingCompletionDrop(null);
    }
  };

  const isValidStoryConnection = (connection: Connection | Edge): boolean => {
    return (
      mutationBarrier.permits("content") &&
      isValidStoryFlowConnection(connection, model?.nodes ?? [])
    );
  };

  const deleteStoryElements = ({
    nodes,
    edges,
  }: {
    nodes: StoryCanvasNode[];
    edges: StoryCanvasEdge[];
  }) => {
    // Nodes and edges are canonical story content. Their screen coordinates
    // live in the separate layout document, but deleting graph structure must
    // never be blocked by an unrelated layout-revision conflict.
    if (!mutationBarrier.permits("content")) return;
    const currentSnapshot = readHistorySnapshot();
    const current = latestContentRef.current;
    if (!currentSnapshot || !current) return;
    try {
      const next = deleteStoryCanvasElements(current, { nodes, edges });
      const contentChanged = next !== current;
      if (!contentChanged) return;

      history.capture(currentSnapshot);
      refreshHistoryState();
      if (contentChanged) {
        latestContentRef.current = next;
        setContent(next);
      }
      const nextNodeIds = storyCanvasContentNodeIds(next);
      const deletedNodeIds = new Set(
        [...storyCanvasContentNodeIds(current)].filter((nodeId) => !nextNodeIds.has(nodeId))
      );
      const removedLayoutNodeIds = deletedNodeIds;

      if (removedLayoutNodeIds.size > 0) {
        const remainingPositions = Object.fromEntries(
          Object.entries(currentSnapshot.nodePositions).filter(
            ([nodeId]) => !removedLayoutNodeIds.has(nodeId)
          )
        );
        removedLayoutNodeIds.forEach((nodeId) => pendingNodePositionsRef.current.delete(nodeId));
        const nextLayout: StoryCanvasLayoutPayload = {
          nodePositions: remainingPositions,
        };
        void persistLayoutRef.current(nextLayout);
      }
      const remainingSelectedNodeIds = latestCanvasSelectionRef.current.filter(
        (nodeId) => !removedLayoutNodeIds.has(nodeId)
      );
      pendingCanvasSelectionRef.current = null;
      requestedCanvasFocusRef.current = null;
      latestCanvasSelectionRef.current = remainingSelectedNodeIds;
      setInspectorTarget((current) =>
        reconcileStoryCanvasInspectorTarget(current, remainingSelectedNodeIds)
      );
      setGraphError(null);
    } catch {
      setGraphError(t("graphError.generic"));
    }
  };

  const connectChapterTarget = (nodeId: string, targetNodeId: string, title: string) => {
    applyGraphMutation((current) => {
      const source = current.graph.nodes.find((node) => node.nodeId === nodeId);
      if (!source) return current;
      if (source.exit.kind === "choice") {
        return addChoiceOption(current, nodeId, targetNodeId, authoringLocale, {
          label: title,
          allowExternalTarget: true,
        }).content;
      }
      if (source.exit.kind === "auto") {
        return connectSceneContinuation(current, nodeId, targetNodeId, {
          allowExternalTarget: true,
        });
      }
      return current;
    });
  };

  const loadLatestAfterConflict = () => {
    if (!conflict) return;
    conflictRef.current = null;
    clearSaveRetry(true);
    revisionRef.current = conflict.current.revision;
    setDraftRevision(conflict.current.revision);
    savedSignatureRef.current = canonicalJsonString(conflict.current.content);
    const activeContent = stripRetiredStoryWorldNodes(
      materializeStoryDecisionNodes(migrateLegacyStoryHotspotIds(conflict.current.content))
    );
    latestContentRef.current = activeContent;
    queuedContentRef.current = null;
    recoveryContentRef.current = null;
    history.clear();
    refreshHistoryState();
    setContent(activeContent);
    setConflict(null);
    setSaveError(null);
    setSaveState("idle");
  };

  const exportLocalDraftAfterConflict = () => {
    if (!conflict) return;
    const localContent = recoveryContentRef.current ?? latestContentRef.current;
    if (!localContent) return;
    downloadJsonArtifact(`fizzdragon-story-draft-recovery-${projectId}.json`, {
      artifactType: "fizzdragon.story-draft-recovery",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      workspaceId,
      projectId,
      localBaseRevision: revisionRef.current,
      canonicalRevision: conflict.current.revision,
      content: localContent,
    });
  };

  const loadLatestLayoutAfterConflict = () => {
    if (!layoutConflict || !model) return;
    const latestLayout: StoryCanvasLayoutPayload = {
      nodePositions: layoutConflict.current.nodePositions,
    };
    layoutConflictRef.current = null;
    recoveryLayoutRef.current = null;
    latestDesiredLayoutRef.current = latestLayout;
    clearLayoutSaveRetry(true);
    layoutRevisionRef.current = layoutConflict.current.revision;
    layoutSavedSignatureRef.current = layoutPayloadSignature(latestLayout);
    queryClient.setQueryData(layoutQueryKey, layoutConflict.current);
    pendingNodePositionsRef.current.clear();
    Object.entries(layoutConflict.current.nodePositions).forEach(([nodeId, position]) => {
      pendingNodePositionsRef.current.set(nodeId, { ...position });
    });
    history.clear();
    refreshHistoryState();
    const latestNodes = canvasNodesRef.current.map((node) => ({
      ...node,
      position: layoutConflict.current.nodePositions[node.id] ?? node.position,
    }));
    canvasNodesRef.current = latestNodes;
    const selectedNodeIds = latestNodes.filter((node) => node.selected).map((node) => node.id);
    latestCanvasSelectionRef.current = selectedNodeIds;
    setInspectorTarget((current) => reconcileStoryCanvasInspectorTarget(current, selectedNodeIds));
    setCanvasNodes(latestNodes);
    setLayoutConflict(null);
  };

  const exportLocalLayoutAfterConflict = () => {
    if (!layoutConflict) return;
    const localLayout = recoveryLayoutRef.current ?? latestDesiredLayoutRef.current;
    if (!localLayout) return;
    downloadJsonArtifact(`fizzdragon-story-layout-recovery-${projectId}.json`, {
      artifactType: "fizzdragon.story-layout-recovery",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      workspaceId,
      projectId,
      localBaseRevision: layoutRevisionRef.current,
      canonicalRevision: layoutConflict.current.revision,
      layout: localLayout,
    });
  };

  // Hand the canvas-owned save and story-bible bridges to the shared chrome
  // while mounted, then reset them on unmount. Snapshot the camera first: the
  // reset closes the inspector, and that open inspector is part of the view.
  useEffect(() => {
    setDraftBarrier(withSavedDraftSnapshot);
    setFoundationWriter((patch) => updateFoundationRef.current(patch));
    return () => {
      const key = activeCanvasViewKeyRef.current;
      if (key) writeCanvasViewRef.current(key);
      setDraftBarrier(null);
      setFoundationWriter(null);
      setInspectorTarget(CLOSED_STORY_CANVAS_INSPECTOR);
    };
  }, [withSavedDraftSnapshot, setDraftBarrier, setFoundationWriter, setInspectorTarget]);

  // Full-screen surfaces are reserved for a true cold start. Canonical
  // projection refetches keep the previous snapshot mounted so the XYFlow
  // viewport and any in-flight assistant stream survive, while readiness
  // latches writes through the edit policy above.
  const projectionSurface = resolveStoryCanvasProjectionSurface(
    projectionReadiness,
    workbenchProjection !== undefined && layoutProjection !== undefined
  );
  if (projectionSurface === "loading") return <CanvasLoading />;
  if (
    projectionSurface === "error" ||
    !workspaceId ||
    !workbenchProjection ||
    !layoutProjection ||
    !project ||
    !content ||
    !model
  ) {
    return (
      <CanvasError
        message={storyApiErrorMessage(
          workbenchQuery.error ?? layoutQuery.error,
          commonT("errors.generic")
        )}
        onRetry={() => {
          void workbenchQuery.refetch();
          void layoutQuery.refetch();
        }}
      />
    );
  }

  const openingCamera = resolveStoryCanvasCamera(
    canvasViewKey ? (useStoryProjectUiStore.getState().canvasViews[canvasViewKey] ?? null) : null
  );
  return (
    <StoryCanvasStoryboardCoverageContext.Provider value={coverageStore}>
      <main className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--canvas-background)] text-white">
        {inspectorOpen ? (
          <StoryProjectSidePanelShell label={t("inspector.eyebrow")}>
            <StoryNodeInspector
              projectId={projectId}
              content={content}
              selectedNode={focusedNode}
              onUpdateClipMeta={(nodeId, patch) =>
                applyGraphMutation((current) => updateStoryClipMeta(current, nodeId, patch), {
                  mergeKey: `clip-meta:${nodeId}:${Object.keys(patch).sort().join(",")}`,
                })
              }
              onSetChapterStart={(nodeId) =>
                applyGraphMutation((current) => setEntryNode(current, nodeId), {
                  mergeKey: `chapter-start:${nodeId}`,
                })
              }
              canEdit={canMutateCanvasLayout}
              onCloseNode={() => selectCanvasNodeExclusively(null)}
              chapterTargets={workbenchProjection.chapters
                .map((chapter) => ({
                  id: chapter.id,
                  title: chapter.title,
                  entryNodeId: chapter.entryNodeId,
                }))
                .filter(
                  (chapter) =>
                    chapter.id !== workbenchProjection.chapter.id && chapter.entryNodeId !== null
                )}
              onConnectChapter={connectChapterTarget}
              onEditInteractions={setInteractionEditorNodeId}
              locale={authoringLocale}
              onSetOnEnterEffects={(nodeId, effects) =>
                applyGraphMutation((current) => setNodeOnEnterEffects(current, nodeId, effects), {
                  mergeKey: `on-enter:${nodeId}`,
                })
              }
              onSetAutoRoutes={(nodeId, routes) =>
                applyGraphMutation((current) => setAutoRoutes(current, nodeId, routes), {
                  mergeKey: `auto-routes:${nodeId}`,
                })
              }
              onCreateEndingForRoute={(nodeId, routeIndex) =>
                applyGraphMutation((current) =>
                  createStoryEndingForAutoRoute(
                    current,
                    nodeId,
                    routeIndex,
                    authoringLocale,
                    t("stats.untitledEnding")
                  )
                )
              }
              onUpdateEnding={updateEnding}
              onDeleteEnding={deleteEnding}
              onDeleteSelected={() => {
                if (focusedNode) deleteStoryElements({ nodes: [focusedNode], edges: [] });
              }}
            />
          </StoryProjectSidePanelShell>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-w-0 flex-1">
            <section
              ref={canvasSectionRef}
              // Inspectors are floating overlays over the canvas region.
              className="absolute inset-0"
              onDoubleClick={(event) => {
                if (!mutationBarrier.permits("layout") || !isCanvasPaneTarget(event.target)) {
                  return;
                }
                event.preventDefault();
                openCreatorMenuAtClientPosition({ x: event.clientX, y: event.clientY });
              }}
            >
              <CanvasBackdrop />
              <MediaHoverPreviewProvider>
                <StoryCanvasChoiceContext.Provider value={choiceContext}>
                  <StoryCanvasPreviewContext.Provider value={previewFromScene}>
                    <StoryCanvasFocusContext.Provider value={focusedNodeId}>
                      <StoryCanvasReactFlow
                        nodes={layeredCanvasNodes}
                        edges={canvasEdges.map((edge) =>
                          edge.selected
                            ? {
                                ...edge,
                                animated: true,
                                className: "story-flow-edge-selected",
                                style: {
                                  ...edge.style,
                                  opacity: 1,
                                  stroke: "var(--brand-blue)",
                                  strokeWidth: 2.5,
                                },
                              }
                            : edge
                        )}
                        onNodesChange={onCanvasNodesChange}
                        onEdgesChange={(changes) =>
                          onCanvasEdgesChange(changes.filter((change) => change.type === "select"))
                        }
                        onConnect={connectStoryNodes}
                        onConnectEnd={finishConnectionOnBlankCanvas}
                        onInteractionStart={closeCreatorMenu}
                        isValidConnection={isValidStoryConnection}
                        onDelete={deleteStoryElements}
                        onSelectionChange={onCanvasSelectionChange}
                        onSelectionStart={onCanvasSelectionStart}
                        onSelectionEnd={onCanvasSelectionEnd}
                        onNodeDragStart={() => {
                          didDragNodeRef.current = false;
                          dragStartHistorySnapshotRef.current = mutationBarrier.permits("layout")
                            ? readHistorySnapshot()
                            : null;
                        }}
                        onNodeDrag={() => {
                          // A real move occurred: the following pointer-up is a drag, not
                          // a click, so it must not open the inspector.
                          didDragNodeRef.current = true;
                        }}
                        onNodeDragStop={(_event, draggedNode, draggedNodes) => {
                          const beforeDrag = dragStartHistorySnapshotRef.current;
                          dragStartHistorySnapshotRef.current = null;
                          const movedNodes = new Map(
                            [...draggedNodes, draggedNode].map((node) => [node.id, node])
                          );
                          commitCanvasLayout(
                            canvasNodes.map((node) => movedNodes.get(node.id) ?? node),
                            beforeDrag
                          );
                        }}
                        onNodeClick={(event, node) => {
                          // Connecting ports must not open an inspector over the destination.
                          if (
                            event.target instanceof Element &&
                            event.target.closest(".react-flow__handle")
                          ) {
                            return;
                          }
                          closeCreatorMenu();
                          const outcome = resolveStoryCanvasNodeClick({
                            nodeId: node.id,
                            nodeSelected: Boolean(node.selected),
                            shiftKey: event.shiftKey,
                            didDrag: didDragNodeRef.current,
                            currentSelection: latestCanvasSelectionRef.current,
                          });
                          didDragNodeRef.current = false;
                          // A pointer-up that ended a drag never opens the inspector.
                          if (outcome.kind === "drag-suppressed") return;
                          if (outcome.kind === "toggle-off") {
                            requestedCanvasFocusRef.current = null;
                            latestCanvasSelectionRef.current = outcome.remainingNodeIds;
                            reconcileCanvasFocus(outcome.remainingNodeIds);
                            return;
                          }
                          // An explicit click is the only path that may open a node
                          // inspector. Player-choice projections deliberately resolve
                          // to "closed" because their editor lives on the card.
                          requestedCanvasFocusRef.current = outcome.nodeId;
                          setSidePanel(null);
                          setInspectorTarget(
                            node.data.kind === "decision"
                              ? CLOSED_STORY_CANVAS_INSPECTOR
                              : storyNodeInspectorTarget(outcome.nodeId)
                          );
                        }}
                        onPaneClick={() => {
                          selectCanvasNodeExclusively(null);
                          closeCreatorMenu();
                        }}
                        onPaneContextMenu={(event) => {
                          if (!mutationBarrier.permits("layout")) return;
                          event.preventDefault();
                          openCreatorMenuAtClientPosition({ x: event.clientX, y: event.clientY });
                        }}
                        onMoveStart={closeCreatorMenu}
                        onMoveEnd={(_event, viewport) => {
                          const viewKey = activeCanvasViewKeyRef.current;
                          if (viewKey) writeCanvasView(viewKey, viewport);
                        }}
                        nodeTypes={NODE_TYPES}
                        edgeTypes={EDGE_TYPES}
                        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
                        colorMode="dark"
                        proOptions={{ hideAttribution: true }}
                        minZoom={0.16}
                        maxZoom={1.4}
                        defaultViewport={openingCamera.defaultViewport}
                        nodesDraggable={canMutateCanvasLayout}
                        nodesConnectable={canMutateCanvasLayout}
                        edgesReconnectable={false}
                        edgesFocusable={canMutateCanvasLayout}
                        deleteKeyCode={canMutateCanvasLayout ? CANVAS_DELETE_KEY_CODES : null}
                        selectNodesOnDrag
                        zoomOnDoubleClick={false}
                        fitView={openingCamera.fitView && canvasNodes.length > 0}
                        fitViewOptions={{ padding: 0.16, maxZoom: 0.78 }}
                        onlyRenderVisibleElements
                        className="relative z-10"
                        style={{ backgroundColor: "transparent" }}
                      >
                        {model.nodes.length > 0 ? (
                          <MiniMap
                            pannable
                            position="bottom-left"
                            className={cn(
                              "canvas-wheel-zoom bottom-5! m-0! overflow-hidden rounded-[18px] bg-[oklch(0.24_0_0/0.92)]! shadow-[0_18px_60px_rgba(0,0,0,0.4)]",
                              // Clear the full-width canvas's left inspector overlay.
                              inspectorOpen ? "left-[452px]!" : "left-20!"
                            )}
                            bgColor="oklch(0.24 0 0 / 0.82)"
                            maskColor="rgba(0,0,0,0.46)"
                            nodeColor="rgba(255,255,255,0.42)"
                            nodeStrokeWidth={0}
                          />
                        ) : null}
                        <CanvasControls
                          position="bottom-left"
                          className={cn(
                            "bottom-5! overflow-hidden rounded-full bg-[oklch(0.24_0_0/0.82)]! p-1! shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-[30px]! backdrop-saturate-150! [&_button]:size-9!",
                            // Clear the full-width canvas's left inspector overlay.
                            inspectorOpen ? "left-[392px]!" : "left-5!"
                          )}
                        />
                      </StoryCanvasReactFlow>
                    </StoryCanvasFocusContext.Provider>
                  </StoryCanvasPreviewContext.Provider>
                </StoryCanvasChoiceContext.Provider>
              </MediaHoverPreviewProvider>

              {canMutateCanvasLayout ? (
                <StoryNodeDock onCreate={createStoryElementFromDock}>
                  <StoryPlotImportDialog
                    key={contentChapterId}
                    disabled={!canEdit}
                    hasNodes={content.graph.nodes.length > 0}
                    projectId={projectId}
                    onImport={importPlot}
                  />
                </StoryNodeDock>
              ) : null}

              {canMutateCanvasLayout ? (
                <CanvasHistoryControls
                  canUndo={history.canUndo}
                  canRedo={history.canRedo}
                  undo={undoStoryCanvas}
                  redo={redoStoryCanvas}
                  undoLabel={canvasT("undo")}
                  redoLabel={canvasT("redo")}
                  className="absolute right-5 bottom-5 z-20 bg-[oklch(0.24_0_0/0.82)] shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-[30px] backdrop-saturate-150"
                />
              ) : null}

              {canMutateCanvasLayout && creatorMenu ? (
                <StoryNodeCreator
                  position={{ left: creatorMenu.left, top: creatorMenu.top }}
                  onCreate={(kind) => createStoryElement(kind, creatorMenu.flowPosition)}
                  onCancel={closeCreatorMenu}
                />
              ) : null}
            </section>

            {canMutateCanvasLayout && pendingCompletionDrop ? (
              <StoryConnectionCreator
                position={pendingCompletionDrop.clientPosition}
                targets={storyConnectionExistingTargets(
                  model?.nodes ?? [],
                  model?.edges ?? [],
                  pendingCompletionDrop.sourceCanvasNodeId
                )}
                onCreate={createCompletionStep}
                onConnectExisting={connectExistingCompletion}
                onCancel={() => setPendingCompletionDrop(null)}
              />
            ) : null}

            {interactionEditorNode ? (
              <StoryInteractionEditor
                node={interactionEditorNode}
                nodes={content.graph.nodes}
                frameProfile={project.frameProfile}
                drafts={storyInteractionDrafts(interactionEditorNode, authoringLocale)}
                onDraftsChange={(drafts) =>
                  applyGraphMutation(
                    (current) =>
                      replaceStoryNodeInteractions(
                        current,
                        interactionEditorNode.nodeId,
                        drafts.map((draft) => ({
                          kind: "hotspot" as const,
                          interactionId: draft.id,
                          label: { [authoringLocale]: draft.label },
                          trigger: storyInteractionTriggerDocument(draft.trigger),
                          rect: draft.rect,
                          startMs: Math.round(draft.startSeconds * 1_000),
                          endMs: Math.round(draft.endSeconds * 1_000),
                          timing: draft.timing,
                          ...(draft.branchAtSeconds !== null
                            ? { branchAtMs: Math.round(draft.branchAtSeconds * 1_000) }
                            : {}),
                          outcomes: storyInteractionOutcomesDocument(draft.outcomes),
                        }))
                      ),
                    { mergeKey: `interactions:${interactionEditorNode.nodeId}` }
                  )
                }
                onClose={() => setInteractionEditorNodeId(null)}
              />
            ) : null}

            {graphError || saveError ? (
              <FrostedPanel className="absolute right-5 bottom-20 z-50 flex max-w-[520px] items-center gap-3 rounded-[16px] bg-[oklch(0.24_0_0/0.9)] px-4 py-3 shadow-[0_20px_70px_rgba(0,0,0,0.48)] backdrop-blur-[30px]">
                <IconAlertTriangle className="size-4 shrink-0 text-[#ff9b9e]" />
                <p className="min-w-0 flex-1 text-xs leading-5 text-white/68">
                  {graphError || saveError}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setGraphError(null);
                    setSaveError(null);
                  }}
                  className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-white/42 transition hover:bg-white/[0.1] hover:text-white"
                  aria-label={t("graphError.dismiss")}
                >
                  <IconX className="size-3.5" />
                </button>
              </FrostedPanel>
            ) : null}

            {conflict ? (
              <ConflictBanner
                onExportLocal={exportLocalDraftAfterConflict}
                onLoadLatest={loadLatestAfterConflict}
              />
            ) : null}
            {!conflict && layoutConflict ? (
              <ConflictBanner
                description={t("layoutConflict.description")}
                onExportLocal={exportLocalLayoutAfterConflict}
                onLoadLatest={loadLatestLayoutAfterConflict}
              />
            ) : null}
          </div>
        </div>
      </main>
    </StoryCanvasStoryboardCoverageContext.Provider>
  );
}

function storyInteractionDrafts(
  node: Extract<StoryGraphNode, { kind: "clip" }>,
  locale: string
): StoryInteractionDraft[] {
  return node.interactions.map((interaction) => ({
    id: interaction.interactionId,
    label:
      interaction.label[locale] ??
      Object.values(interaction.label).find((value) => value.trim()) ??
      interaction.interactionId,
    rect: interaction.rect,
    startSeconds: interaction.startMs / 1_000,
    endSeconds: interaction.endMs / 1_000,
    branchAtSeconds: interaction.branchAtMs !== undefined ? interaction.branchAtMs / 1_000 : null,
    timing: interaction.timing ?? "window",
    trigger: storyInteractionTriggerDraft(interaction.trigger),
    outcomes: storyInteractionOutcomesDraft(interaction.outcomes),
  }));
}

function storyInteractionTriggerDocument(
  trigger: StoryInteractionTriggerDraft
): StoryInteractionTrigger {
  return trigger.kind === "press-hold"
    ? {
        kind: "press-hold",
        durationMs: Math.round(trigger.durationSeconds * 1_000),
        controlTimeline: trigger.controlTimeline,
      }
    : trigger;
}

function storyInteractionTriggerDraft(
  trigger: StoryInteractionTrigger
): StoryInteractionTriggerDraft {
  return trigger.kind === "press-hold"
    ? {
        kind: "press-hold",
        durationSeconds: trigger.durationMs / 1_000,
        controlTimeline: trigger.controlTimeline ?? false,
      }
    : trigger;
}

function storyInteractionActionDocument(
  action: StoryInteractionActionDraft
): StoryInteractionAction {
  if (action.kind === "goto")
    return { kind: "goto", target: { kind: "node", nodeId: action.targetNodeId } };
  if (action.kind === "seek") {
    return { kind: "seek", timeMs: Math.round(action.timeSeconds * 1_000) };
  }
  if (action.kind === "pause") return { kind: "pause" };
  return { kind: "continue" };
}

function storyInteractionActionDraft(action: StoryInteractionAction): StoryInteractionActionDraft {
  if (action.kind === "goto") {
    return {
      kind: "goto",
      targetNodeId: action.target.kind === "node" ? action.target.nodeId : "",
    };
  }
  if (action.kind === "seek") return { kind: "seek", timeSeconds: action.timeMs / 1_000 };
  if (action.kind === "pause") return { kind: "pause" };
  return { kind: "continue" };
}

function storyInteractionOutcomesDocument(
  outcomes: StoryInteractionOutcomesDraft
): StoryInteractionOutcomes {
  return {
    success: storyInteractionActionDocument(outcomes.success),
    ...(outcomes.failure ? { failure: storyInteractionActionDocument(outcomes.failure) } : {}),
    ...(outcomes.timeout ? { timeout: storyInteractionActionDocument(outcomes.timeout) } : {}),
  };
}

function storyInteractionOutcomesDraft(
  outcomes: StoryInteractionOutcomes
): StoryInteractionOutcomesDraft {
  return {
    success: storyInteractionActionDraft(outcomes.success),
    ...(outcomes.failure ? { failure: storyInteractionActionDraft(outcomes.failure) } : {}),
    ...(outcomes.timeout ? { timeout: storyInteractionActionDraft(outcomes.timeout) } : {}),
  };
}

function formatInteractionTime(timeMs: number): string {
  const totalSeconds = Math.max(0, timeMs) / 1_000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function StoryPortHandle({
  id,
  type,
  position,
  color,
  label,
  isConnectable = true,
  emphasized = false,
  className,
  style,
}: {
  id: string;
  type: "source" | "target";
  position: Position;
  color: string;
  label: string;
  isConnectable?: boolean;
  emphasized?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Handle
      id={id}
      type={type}
      position={position}
      isConnectable={isConnectable}
      title={label}
      aria-label={label}
      className={cn("z-30!", emphasized ? "size-4.5!" : "size-3.5! border-0!", className)}
      style={{
        backgroundColor: color,
        border: emphasized ? "3px solid rgba(20,20,20,0.96)" : undefined,
        boxShadow: emphasized
          ? `0 0 0 3px rgba(91,157,255,0.2), 0 0 18px ${color}`
          : `0 0 0 3px rgba(17,17,17,0.92), 0 0 16px ${color}`,
        ...style,
      }}
    />
  );
}

function ChoiceOptionRow({
  choice,
  index,
  choiceCount,
  sourceNodeId,
  isConnectable,
}: {
  choice: NonNullable<StoryCanvasNodeData["choices"]>[number];
  index: number;
  choiceCount: number;
  sourceNodeId: string;
  isConnectable: boolean;
}) {
  const t = useTranslations("storyStudio.canvas");
  const tStats = useTranslations("storyStudio.canvas.stats");
  const choiceContext = useContext(StoryCanvasChoiceContext);
  const destination = choice.targetEndingTitle
    ? tStats("endingArrow", { title: choice.targetEndingTitle })
    : choice.targetNodeId
      ? `→ ${choice.targetTitle ?? t("interactionCard.linkedTarget")}`
      : t("interactionCard.unconnected");
  return (
    <div className="border-b border-white/[0.055] last:border-b-0">
      <div className="group/choice relative grid min-h-14 grid-cols-[32px_minmax(0,1fr)_auto_auto_26px] items-center gap-2 px-3 text-xs transition-colors hover:bg-white/[0.035] focus-within:bg-white/[0.045]">
        <span className="grid size-7 place-items-center rounded-lg bg-white/[0.055] text-[10px] font-semibold text-[#9bc4ff] tabular-nums">
          {String(index + 1).padStart(2, "0")}
        </span>
        <StoryCanvasTextInput
          value={choice.label}
          disabled={!choiceContext?.canEditContent}
          maxLength={STORY_AUTHORING_TEXT_MAX}
          placeholder={t("interactionCard.untitledOption")}
          aria-label={t("interactionCard.optionPlaceholder")}
          onValueChange={(value) =>
            choiceContext?.updateChoice(sourceNodeId, choice.choiceId, value)
          }
          className={cn(
            "nodrag nopan nowheel w-full min-w-0 bg-transparent py-2 text-[12px] font-medium outline-none placeholder:text-white/36 disabled:cursor-default",
            choice.label.trim() ? "text-white/78" : "text-white/36"
          )}
        />
        {choice.targetNodeId ? (
          <StoryCommunityPriceLabel price={choice.communityPointPrice} />
        ) : (
          <span />
        )}
        <span className="max-w-[118px] truncate rounded-lg bg-white/[0.055] px-2 py-1.5 text-xs text-white/42 group-hover/choice:hidden group-focus-within/choice:hidden">
          {destination}
        </span>
        {choiceContext?.canEditContent ? (
          <span className="nodrag nopan hidden items-center gap-1 group-hover/choice:flex group-focus-within/choice:flex">
            <button
              type="button"
              disabled={index === 0}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                choiceContext.moveChoice(sourceNodeId, choice.choiceId, "up");
              }}
              className="grid size-8 place-items-center rounded-lg text-white/70 transition hover:bg-white/[0.12] hover:text-white disabled:opacity-25"
              aria-label={t("inspector.moveChoiceUp")}
            >
              <IconArrowUp className="size-[18px]" stroke={1.9} />
            </button>
            <button
              type="button"
              disabled={index === choiceCount - 1}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                choiceContext.moveChoice(sourceNodeId, choice.choiceId, "down");
              }}
              className="grid size-8 place-items-center rounded-lg text-white/70 transition hover:bg-white/[0.12] hover:text-white disabled:opacity-25"
              aria-label={t("inspector.moveChoiceDown")}
            >
              <IconArrowDown className="size-[18px]" stroke={1.9} />
            </button>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                choiceContext.removeChoice(sourceNodeId, choice.choiceId);
              }}
              className="grid size-8 place-items-center rounded-lg text-white/70 transition hover:bg-white/[0.12] hover:text-[#ff9b9e]"
              aria-label={t("inspector.removeChoice")}
            >
              <IconTrash className="size-[18px]" stroke={1.9} />
            </button>
          </span>
        ) : null}
        <span
          className="pointer-events-none relative flex h-full items-center justify-end"
          aria-hidden="true"
        >
          <span className="h-px w-4 bg-[#5b9dff]/55" />
        </span>
        <StoryPortHandle
          id={`choice:${choice.choiceId}`}
          type="source"
          position={Position.Right}
          isConnectable={isConnectable && choice.targetNodeId === null}
          emphasized
          color={STORY_PORT_COLORS.choice}
          label={t("ports.choiceOption", {
            label: choice.label.trim() || t("interactionCard.untitledOption"),
          })}
          className="-right-2.25!"
        />
      </div>
      {choiceContext ? (
        <StoryChoiceAttachmentBar
          effects={choice.effects ?? []}
          visibleWhen={choice.visibleWhen}
          variables={choiceContext.stateVariables ?? []}
          locale={choiceContext.locale}
          canEdit={choiceContext.canEditContent}
          onEffectsChange={(effects) =>
            choiceContext.patchChoice(sourceNodeId, choice.choiceId, { effects })
          }
          onVisibleWhenChange={(visibleWhen) =>
            choiceContext.patchChoice(sourceNodeId, choice.choiceId, {
              visibleWhen: visibleWhen ?? null,
            })
          }
          target={choice.target}
          nodes={choiceContext.nodes.filter((node) => node.nodeId !== sourceNodeId)}
          endings={choiceContext.endings}
          onTargetChange={(target) =>
            choiceContext.patchChoice(sourceNodeId, choice.choiceId, { target })
          }
          onCreateEnding={() => choiceContext.createEndingForChoice(sourceNodeId, choice.choiceId)}
          onUpdateEnding={choiceContext.updateEnding}
          onDeleteEnding={choiceContext.deleteEnding}
        />
      ) : null}
    </div>
  );
}

function StoryGraphNodeCard({ id, data, selected, isConnectable }: NodeProps<StoryCanvasNode>) {
  const t = useTranslations("storyStudio.canvas");
  const focusedNodeId = useContext(StoryCanvasFocusContext);
  const previewFromScene = useContext(StoryCanvasPreviewContext);
  const choiceContext = useContext(StoryCanvasChoiceContext);
  const interactionSourceNodeId = data.kind === "decision" ? data.sourceNodeId : undefined;
  const interactionChoices = data.kind === "decision" ? (data.choices ?? []) : [];
  const interactionChoiceCount = interactionChoices.length;
  const hotspotInteractions = data.kind === "clip" ? (data.interactions ?? []) : [];
  const coverage = useStoryboardNodeCoverage(data.nodeId);
  const currentVideoSource: StudioVideoSource | undefined =
    data.kind === "clip" && coverage?.previewVideoUrl
      ? { src: coverage.previewVideoUrl, type: "video/mp4" }
      : undefined;
  const stillUrl = data.kind === "clip" ? storyboardStillUrl(coverage) : null;
  const mediaPreview = useMediaHoverPreview({
    ownerId: id,
    enabled: Boolean(currentVideoSource),
    canActivate: canActivateCanvasMediaPreview,
    canClaimManual: canClaimCanvasManualPlayback,
  });
  const previewFocused = focusedNodeId === id;
  const playVideo =
    Boolean(currentVideoSource) && (previewFocused || mediaPreview.isAutoPreviewActive);
  const geometry = canvasNodeGeometry({ type: "storyCanvas", data });
  return (
    <div className="relative pt-10" data-story-node-id={id}>
      <FrostedPanel
        rim={false}
        blur={false}
        className={cn(
          "pointer-events-auto absolute top-0 left-0 z-10 inline-flex h-8 items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-[13px] font-semibold text-white shadow-[0_8px_18px_rgba(0,0,0,0.28)]",
          data.chapterStart && "shadow-[0_8px_18px_rgba(143,101,255,0.38)]"
        )}
        style={{
          backgroundColor: data.chapterStart ? "#8f65ff" : "oklch(0.32 0 0)",
        }}
      >
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full",
            !data.chapterStart && data.kind === "decision" && "text-[#a9ceff]"
          )}
          style={{
            backgroundColor: data.chapterStart
              ? "rgba(255,255,255,0.22)"
              : data.kind === "decision"
                ? "rgba(91,157,255,0.2)"
                : "rgba(255,255,255,0.22)",
          }}
        >
          {data.kind === "clip" ? <IconMovie className="size-3.5" stroke={2} /> : null}
          {data.kind === "decision" ? <IconGitBranch className="size-3.5" stroke={2} /> : null}
        </span>
        {t(`nodeKinds.${data.kind}`)}
        {data.chapterStart ? (
          <span className="text-[11px] font-semibold text-white/88">{t("chapterStart.badge")}</span>
        ) : null}
      </FrostedPanel>
      {data.kind === "clip" || (choiceContext && data.kind !== "decision") ? (
        <div className="absolute top-0 right-0 z-10 flex items-start gap-1.5">
          {data.kind === "clip" && previewFromScene ? (
            <button
              type="button"
              aria-label={t("previewFromScene")}
              title={t("previewFromScene")}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                previewFromScene(data.nodeId);
              }}
              className="nodrag nopan grid size-7 cursor-default place-items-center rounded-full bg-[oklch(0.32_0_0)] text-white/85 shadow-[0_8px_18px_rgba(0,0,0,0.28)] transition hover:bg-[oklch(0.38_0_0)] hover:text-white disabled:opacity-50"
            >
              <IconPlayerPlay className="size-3.5" stroke={2} />
            </button>
          ) : null}
          {choiceContext ? (
            <StoryCommunityPriceButton
              title={data.title}
              price={data.communityPointPrice}
              disabled={!choiceContext.canEditContent}
              onSave={(price) => choiceContext.setCommunityPointPrice(data.nodeId, price)}
            />
          ) : null}
        </div>
      ) : null}
      <article
        {...mediaPreview.hoverProps}
        className={cn(
          "relative overflow-visible rounded-[22px] bg-[oklch(0.215_0_0)] shadow-[0_12px_28px_rgba(0,0,0,0.38)] [contain:layout_style]",
          selected ? "bg-accent" : "hover:bg-[oklch(0.235_0_0)]"
        )}
        style={{ width: geometry.width, minHeight: geometry.minHeight }}
      >
        <StoryPortHandle
          id="in"
          type="target"
          position={Position.Left}
          isConnectable={isConnectable}
          color={STORY_PORT_COLORS.flow}
          label={t("ports.input")}
          className="-left-1.75!"
        />
        {data.exitKind === "auto" ? (
          <StoryPortHandle
            id="completion"
            type="source"
            position={Position.Right}
            color={STORY_PORT_COLORS.flow}
            label={t("ports.completion")}
            isConnectable={isConnectable && canConnectStoryCompletion(data)}
            className="-right-1.75!"
          />
        ) : null}
        {data.kind === "clip" ? (
          playVideo ? (
            <StoryVideoPreview
              source={currentVideoSource}
              poster={stillUrl}
              interactive={previewFocused}
              frameAspectRatio={data.frameAspectRatio}
              ariaLabel={t("production.node.videoPreview")}
              emptyLabel={t(coverage ? "production.node.noMedia" : "production.node.noSequence")}
              autoPreviewActive={mediaPreview.isAutoPreviewActive}
              manualPlaybackOwned={mediaPreview.isManualPlaybackOwner}
              onManualPlaybackStart={mediaPreview.acquireManualPlayback}
              onManualPlaybackStop={mediaPreview.releaseManualPlayback}
              className="rounded-t-[22px]"
            />
          ) : stillUrl ? (
            <div
              className="relative overflow-hidden rounded-t-[22px] bg-black/15"
              style={{ aspectRatio: data.frameAspectRatio === "9:16" ? "9 / 16" : "16 / 9" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- storyboard media thumbnail */}
              <img
                src={stillUrl}
                alt=""
                draggable={false}
                decoding="async"
                fetchPriority="low"
                className="size-full select-none object-cover"
              />
            </div>
          ) : (
            <StoryVideoPreview
              interactive={false}
              frameAspectRatio={data.frameAspectRatio}
              ariaLabel={t("production.node.videoPreview")}
              emptyLabel={t(
                !coverage
                  ? "production.node.noSequence"
                  : currentVideoSource
                    ? "production.node.videoIdle"
                    : "production.node.noMedia"
              )}
              autoPreviewActive={false}
              manualPlaybackOwned={false}
              onManualPlaybackStart={mediaPreview.acquireManualPlayback}
              onManualPlaybackStop={mediaPreview.releaseManualPlayback}
              className="rounded-t-[22px]"
            />
          )
        ) : null}
        <div
          className={cn(
            "p-3",
            data.kind === "clip" && "border-t border-white/[0.065] bg-white/[0.025]"
          )}
        >
          {data.kind === "clip" ? (
            <>
              {data.title ? (
                <h2 className="-mx-1 truncate rounded px-1 text-[15px] font-semibold text-white/90">
                  {data.title}
                </h2>
              ) : null}
              {data.description?.trim() ? (
                <div
                  role="region"
                  aria-label={`${data.title} · ${t("inspector.nodeDescription")}`}
                  tabIndex={0}
                  className="nodrag nopan nowheel mt-2 max-h-40 cursor-text overflow-y-auto overscroll-contain whitespace-pre-wrap wrap-anywhere rounded-sm text-xs leading-5 text-white/70 select-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/45"
                >
                  {data.description}
                </div>
              ) : null}
              {coverage ? (
                <p className="mt-1.5 text-[10px] leading-4 tabular-nums text-white/42">
                  {t("production.node.clipCoverage", {
                    ready: coverage.ready,
                    total: coverage.total,
                  })}
                </p>
              ) : null}
            </>
          ) : null}
          {hotspotInteractions.length > 0 ? (
            <div className="mt-3 overflow-hidden rounded-[16px] border border-[#5b9dff]/20 bg-[#5b9dff]/[0.055]">
              <div className="flex items-center gap-2 border-b border-[#5b9dff]/15 px-3 py-2.5">
                <span className="grid size-6 place-items-center rounded-lg bg-[#5b9dff]/18 text-[#a9ceff]">
                  <IconFocusCentered className="size-3.5" stroke={1.8} />
                </span>
                <span className="min-w-0 flex-1 text-xs font-semibold text-white/78">
                  {t("interactionAnchors.title")}
                </span>
                <span className="text-xs text-white/34 tabular-nums">
                  {hotspotInteractions.length}
                </span>
                <span className="rounded-full bg-[#5b9dff]/12 px-2 py-1 text-xs font-semibold text-[#9bc4ff]">
                  {t("interactionAnchors.hotspotType")}
                </span>
              </div>
              {hotspotInteractions.map((interaction, index) => {
                const triggerLabel =
                  interaction.trigger.kind === "swipe"
                    ? t("interactionAnchors.triggerSwipe", {
                        direction: t(
                          `interactionAnchors.directions.${interaction.trigger.direction}`
                        ),
                      })
                    : interaction.trigger.kind === "press-hold"
                      ? t("interactionAnchors.triggerPressHold", {
                          duration: formatInteractionTime(interaction.trigger.durationMs),
                        })
                      : t("interactionAnchors.triggerTap");
                const outcomes = (
                  [
                    ["success", interaction.outcomes.success],
                    ["failure", interaction.outcomes.failure],
                    ["timeout", interaction.outcomes.timeout],
                  ] as const
                ).filter((entry) => entry[1] !== undefined);
                return (
                  <div
                    key={interaction.interactionId}
                    className="group/hotspot relative grid min-h-11 grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2 px-1 py-2 pr-3 text-xs"
                  >
                    <span className="pt-1 tabular-nums text-white/24">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-white/72">
                        {interaction.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-white/34 tabular-nums">
                        {interaction.timing === "hold"
                          ? `${t("interactionAnchors.timingHold")} ${formatInteractionTime(interaction.endMs)}`
                          : `${formatInteractionTime(interaction.startMs)}–${formatInteractionTime(interaction.endMs)}`}
                        {" · "}
                        {triggerLabel}
                      </span>
                    </span>
                    <span className="flex max-w-[132px] flex-col items-end gap-1">
                      {outcomes.map(([outcome, value]) => {
                        if (!value) return null;
                        const actionLabel =
                          value.action.kind === "continue"
                            ? t("interactionAnchors.continueCurrent")
                            : value.action.kind === "pause"
                              ? t("interactionAnchors.stayOnFrame")
                              : value.action.kind === "seek"
                                ? t("interactionAnchors.seekCurrent", {
                                    time: formatInteractionTime(value.action.timeMs),
                                  })
                                : t("interactionAnchors.gotoTarget", {
                                    target: value.targetTitle ?? t("interactionCard.linkedTarget"),
                                  });
                        const outcomeLabel = t(`interactionAnchors.outcomes.${outcome}`);
                        return (
                          <span
                            key={outcome}
                            className={cn(
                              "relative max-w-full truncate rounded-full px-2 py-1 font-semibold",
                              value.action.kind === "goto"
                                ? "bg-[#5b9dff]/12 text-[#9bc4ff]"
                                : "bg-white/[0.055] text-white/48"
                            )}
                            title={`${outcomeLabel}: ${actionLabel}`}
                          >
                            {outcomeLabel}: {actionLabel}
                            {value.action.kind === "goto" ? (
                              <StoryPortHandle
                                id={`interaction:${interaction.interactionId}:${outcome}`}
                                type="source"
                                position={Position.Right}
                                isConnectable={false}
                                color={STORY_PORT_COLORS.choice}
                                label={`${outcomeLabel}: ${actionLabel}`}
                                className="-right-[23px]!"
                              />
                            ) : null}
                          </span>
                        );
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
          {interactionSourceNodeId ? (
            <section className="-m-3 overflow-visible" aria-label={t("nodeKinds.decision")}>
              <header className="flex items-center gap-3 px-4 pt-4 pb-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-[#a9ceff]">
                  <IconGitBranch className="size-4.5" stroke={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-white/88">
                    {t("interactionCard.branchOptions")}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-white/38">
                    {t("interactionCard.anchorHint")}
                  </span>
                </span>
                <span className="rounded-lg bg-white/[0.065] px-2 py-1 text-[10px] font-semibold text-white/52 tabular-nums">
                  {t("interactionCard.optionCount", { count: interactionChoiceCount })}
                </span>
              </header>
              <StoryCanvasTextInput
                multiline
                value={data.summary ?? ""}
                disabled={!choiceContext?.canEditContent}
                maxLength={STORY_AUTHORING_TEXT_MAX}
                placeholder={t("interactionCard.promptPlaceholder")}
                aria-label={t("interactionCard.promptPlaceholder")}
                onValueChange={(value) =>
                  choiceContext?.updatePrompt(interactionSourceNodeId, value)
                }
                className="nodrag nopan nowheel field-sizing-content mx-3 mb-2 block max-h-24 min-h-14 w-[calc(100%-1.5rem)] resize-none overflow-y-auto rounded-xl bg-white/[0.045] px-3 py-2.5 text-[12px] leading-5 font-medium text-white/82 outline-none transition focus:bg-white/[0.065] placeholder:text-white/30 disabled:cursor-default"
              />
              <div className="border-y border-white/[0.065]">
                {interactionChoices.map((choice, index) => (
                  <ChoiceOptionRow
                    key={choice.choiceId}
                    choice={choice}
                    index={index}
                    choiceCount={interactionChoices.length}
                    sourceNodeId={interactionSourceNodeId}
                    isConnectable={isConnectable}
                  />
                ))}
              </div>
              {interactionChoiceCount < MAX_PLAYER_CHOICES && choiceContext?.canCreateOption ? (
                <button
                  type="button"
                  className="nodrag nopan flex h-11 w-full items-center gap-2 px-4 text-left text-xs font-semibold text-[#84b7ff]/78 transition hover:bg-white/[0.035] hover:text-[#a9ceff]"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    choiceContext?.start(interactionSourceNodeId);
                  }}
                >
                  <IconPlus className="size-4" />
                  {t("interactionCard.addOption")}
                </button>
              ) : null}
            </section>
          ) : null}
        </div>
      </article>
    </div>
  );
}

function StoryVideoPreview({
  source,
  poster,
  interactive,
  frameAspectRatio,
  ariaLabel,
  emptyLabel,
  autoPreviewActive,
  manualPlaybackOwned,
  onManualPlaybackStart,
  onManualPlaybackStop,
  className,
}: {
  source?: StudioVideoSource;
  poster?: string | null;
  interactive: boolean;
  frameAspectRatio?: string;
  ariaLabel: string;
  emptyLabel: string;
  autoPreviewActive: boolean;
  manualPlaybackOwned: boolean;
  onManualPlaybackStart: () => MediaManualPlaybackLease | null;
  onManualPlaybackStop: (lease: MediaManualPlaybackLease) => void;
  className?: string;
}) {
  return (
    <div
      className={cn("relative w-full overflow-hidden bg-black/15", className)}
      style={{ aspectRatio: frameAspectRatio === "9:16" ? "9 / 16" : "16 / 9" }}
    >
      {source ? (
        interactive ? (
          <StoryInteractiveVideoPreview
            source={source}
            poster={poster}
            ariaLabel={ariaLabel}
            autoPreviewActive={autoPreviewActive}
            manualPlaybackOwned={manualPlaybackOwned}
            onManualPlaybackStart={onManualPlaybackStart}
            onManualPlaybackStop={onManualPlaybackStop}
          />
        ) : (
          <StoryPassiveVideoPreview source={source} poster={poster} active={autoPreviewActive} />
        )
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 text-white/24">
          <span className="grid size-9 place-items-center rounded-full bg-white/[0.055]">
            <IconMovie className="size-4" />
          </span>
          <span className="text-[9px] font-semibold">{emptyLabel}</span>
          {frameAspectRatio ? (
            <span className="text-[8px] tabular-nums text-white/18">{frameAspectRatio}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function StoryInteractiveVideoPreview({
  source,
  poster,
  ariaLabel,
  autoPreviewActive,
  manualPlaybackOwned,
  onManualPlaybackStart,
  onManualPlaybackStop,
}: {
  source: StudioVideoSource;
  poster?: string | null;
  ariaLabel: string;
  autoPreviewActive: boolean;
  manualPlaybackOwned: boolean;
  onManualPlaybackStart: () => MediaManualPlaybackLease | null;
  onManualPlaybackStop: (lease: MediaManualPlaybackLease) => void;
}) {
  const zoom = useStore((state) => state.transform[2]);
  const controlDensity = resolveCanvasVideoControlDensity(zoom);

  return (
    <CanvasNativePointerOwner
      className={cn("absolute inset-0", controlDensity === null && "pointer-events-none")}
    >
      <StudioVideoPlayer
        source={source}
        poster={poster ?? undefined}
        ariaLabel={ariaLabel}
        controlDensity={controlDensity}
        autoPreviewActive={autoPreviewActive}
        manualPlaybackOwned={manualPlaybackOwned}
        onManualPlaybackStart={onManualPlaybackStart}
        onManualPlaybackStop={onManualPlaybackStop}
        fit="cover"
        renderScale={zoom}
      />
    </CanvasNativePointerOwner>
  );
}

function StoryPassiveVideoPreview({
  source,
  poster,
  active,
}: {
  source: StudioVideoSource;
  poster?: string | null;
  active: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackEpochRef = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const epoch = ++playbackEpochRef.current;

    if (!active) {
      video.pause();
      video.currentTime = 0;
      return;
    }

    video.muted = true;
    video.currentTime = 0;
    void video
      .play()
      .then(() => {
        if (epoch === playbackEpochRef.current && active) return;
        video.pause();
        video.currentTime = 0;
      })
      .catch(() => {});

    return () => {
      playbackEpochRef.current += 1;
      video.pause();
    };
  }, [active, source.src]);

  return (
    <video
      ref={videoRef}
      src={source.src}
      poster={poster ?? undefined}
      muted
      draggable={false}
      playsInline
      preload="none"
      tabIndex={-1}
      aria-hidden="true"
      data-auto-preview={active ? "true" : undefined}
      className="pointer-events-none size-full object-cover select-none"
    />
  );
}

function ConflictBanner({
  description,
  onExportLocal,
  onLoadLatest,
}: {
  description?: string;
  onExportLocal: () => void;
  onLoadLatest: () => void;
}) {
  const t = useTranslations("storyStudio.canvas");
  return (
    <FrostedPanel className="absolute top-20 left-[calc(50%+190px)] z-50 flex -translate-x-1/2 items-center gap-4 bg-[oklch(0.24_0_0/0.82)] px-4 py-3 shadow-[0_20px_70px_rgba(0,0,0,0.52)] backdrop-blur-[30px]">
      <IconAlertTriangle className="size-4 shrink-0 text-[#ff9b9e]" />
      <p className="text-xs text-white/72">{description ?? t("conflict.description")}</p>
      <Button size="sm" variant="ghost" onClick={onExportLocal}>
        <IconDownload className="size-3.5" />
        {t("conflict.exportLocal")}
      </Button>
      <Button size="sm" variant="secondary" onClick={onLoadLatest}>
        <IconRefresh className="size-3.5" />
        {t("conflict.loadLatest")}
      </Button>
    </FrostedPanel>
  );
}

function downloadJsonArtifact(fileName: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  queueMicrotask(() => URL.revokeObjectURL(url));
}

function CanvasLoading() {
  const t = useTranslations("storyStudio.canvas");
  return (
    <StoryProjectWorkState>
      <div className="flex items-center gap-3 text-sm text-white/54">
        <IconLoader2 className="size-5 animate-spin" />
        {t("loading")}
      </div>
    </StoryProjectWorkState>
  );
}

function CanvasError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTranslations("storyStudio.canvas");
  return (
    <StoryProjectWorkState className="px-6">
      <FrostedPanel className="w-full max-w-md rounded-[28px] bg-[oklch(0.205_0_0/0.72)] p-7 text-center shadow-[0_26px_100px_rgba(0,0,0,0.52)] backdrop-blur-[60px]">
        <IconAlertTriangle className="mx-auto size-6 text-[#ff9b9e]" />
        <h1 className="mt-4 text-base font-semibold">{t("error.title")}</h1>
        <p className="mt-2 text-xs leading-5 text-white/44">{message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/story-studio">
              <IconArrowLeft className="size-4" />
              {t("back")}
            </Link>
          </Button>
          <Button variant="secondary" onClick={onRetry}>
            <IconRefresh className="size-4" />
            {t("error.retry")}
          </Button>
        </div>
      </FrostedPanel>
    </StoryProjectWorkState>
  );
}

function nodePositions(nodes: StoryCanvasNode[]): Record<string, StoryCanvasPosition> {
  return Object.fromEntries(
    [...nodes]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) => [node.id, { x: node.position.x, y: node.position.y }])
  );
}

function storyDuplicateSources(nodes: readonly StoryCanvasNode[]): StoryDuplicateSource[] {
  const selected = nodes.filter((node) => node.selected);
  const selectedIds = new Set(selected.map((node) => node.id));
  return selected.flatMap((node): StoryDuplicateSource[] => {
    const sourceNodeId = node.data.sourceNodeId;
    // A derived choice card is the clip's exit, not its own graph node.
    // Copying the clip already copies that exit.
    if (node.data.kind === "decision" && sourceNodeId && sourceNodeId !== node.id) {
      if (selectedIds.has(sourceNodeId)) return [];
      return [{ canvasId: node.id, nodeId: sourceNodeId, role: "choice-exit" }];
    }
    return [{ canvasId: node.id, nodeId: node.data.nodeId, role: "node" }];
  });
}

function storyConnectionExistingTargets(
  nodes: readonly StoryCanvasNode[],
  edges: readonly StoryCanvasEdge[],
  sourceCanvasNodeId: string
): StoryConnectionExistingTarget[] {
  const sourceIndex = nodes.findIndex((node) => node.id === sourceCanvasNodeId);
  const availabilityRank = { open: 0, replace: 1 } as const;
  return nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => {
      if (node.id === sourceCanvasNodeId) return false;
      // Derived choice cards are not graph nodes. A scene connects to the
      // real decision, which already appears in this list.
      return !(
        node.data.kind === "decision" &&
        node.data.sourceNodeId &&
        node.data.sourceNodeId !== node.id
      );
    })
    .flatMap(({ node, index }) => {
      const incoming = edges.filter(
        (edge) =>
          edge.target === node.id &&
          (edge.data.kind === "continuation" || edge.data.kind === "choice")
      ).length;
      const availability = storyExistingTargetAvailability(
        sourceCanvasNodeId,
        node.id,
        nodes,
        incoming
      );
      if (availability === "blocked") return [];
      const distance =
        index > sourceIndex ? index - sourceIndex : nodes.length + index - Math.max(sourceIndex, 0);
      return [
        {
          nodeId: node.data.nodeId,
          kind: node.data.kind,
          title: node.data.eyebrow || node.data.title,
          detail:
            node.data.kind === "clip"
              ? firstTextLine(node.data.description)
              : (node.data.choices ?? [])
                  .map((choice) => choice.label.trim())
                  .filter(Boolean)
                  .slice(0, 3)
                  .join(" / "),
          availability,
          distance,
        },
      ];
    })
    .sort(
      (left, right) =>
        availabilityRank[left.availability] - availabilityRank[right.availability] ||
        left.distance - right.distance
    )
    .map(({ distance: _distance, ...target }) => target);
}

function firstTextLine(text: string | undefined): string {
  const line = (text ?? "")
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  return line ? line.slice(0, 80) : "";
}

function canvasLayoutPayload(nodes: readonly StoryCanvasNode[]): StoryCanvasLayoutPayload {
  return { nodePositions: nodePositions([...nodes]) };
}

function historyNodePositions(
  content: InteractiveStoryDraftContent,
  nodes: readonly StoryCanvasNode[],
  pending: ReadonlyMap<string, StoryCanvasPosition>
): Record<string, StoryCanvasPosition> {
  const contentNodeIds = storyCanvasContentNodeIds(content);

  const positions = Object.fromEntries(
    nodes
      .filter((node) => contentNodeIds.has(node.id))
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) => [node.id, { x: node.position.x, y: node.position.y }])
  );
  pending.forEach((position, nodeId) => {
    if (contentNodeIds.has(nodeId)) positions[nodeId] = { ...position };
  });
  return positions;
}

function storyCanvasContentNodeIds(content: InteractiveStoryDraftContent): Set<string> {
  const nodeIds = new Set<string>();
  content.graph.nodes.forEach((node) => {
    nodeIds.add(node.nodeId);
  });
  return nodeIds;
}

function isCanvasPaneTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.classList.contains("react-flow__pane");
}

function connectionDropClientPosition(
  event: MouseEvent | TouchEvent
): { x: number; y: number } | null {
  if ("changedTouches" in event) {
    const touch = event.changedTouches.item(0);
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  return { x: event.clientX, y: event.clientY };
}
