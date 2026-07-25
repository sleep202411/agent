"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  applyNodeChanges,
  Handle,
  MiniMap,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
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
  IconCheck,
  IconCloudUpload,
  IconDownload,
  IconFileText,
  IconGitBranch,
  IconLoader2,
  IconMovie,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconUser,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useWorkspace } from "@/app/_components/workspace-context";
import { Button } from "@/components/ui/button";
import { CanvasControls } from "@/components/canvas/canvas-controls";
import { CanvasHistoryControls } from "@/components/canvas/canvas-history-controls";
import { useCanvasTidy } from "@/components/canvas/use-canvas-tidy";
import { useCanvasHistoryShortcuts } from "@/components/canvas/canvas-history";
import { CanvasNativePointerOwner } from "@/components/canvas/canvas-native-pointer-owner";
import { CanvasReactFlow, type CanvasReactFlowProps } from "@/components/canvas/canvas-react-flow";
import {
  CANVAS_DELETE_KEY_CODES,
  CANVAS_NODE_DRAG_HANDLE_CLASS,
} from "@/components/canvas/canvas-interaction-policy";
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
import { GlassRim } from "@/components/ui/glass-rim";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useRouter } from "@/i18n/navigation";
import { canonicalJsonString } from "@/lib/canonical-json";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import { cn } from "@/lib/utils";
import { StoryStudioCanvasBackdrop } from "./story-studio-canvas-backdrop";
import {
  addStoryCandidateAsset,
  canvasLayoutRevisionConflict,
  cancelStoryClipVideoUpload,
  completeStoryClipVideoUpload,
  archiveStoryChapter,
  createStoryChapter,
  draftRevisionConflict,
  getStoryCanvasLayout,
  getStoryExperienceCurrentRelease,
  getStoryWorkbench,
  putStoryClipCurrentVideo,
  putStoryCanvasLayout,
  putStoryDraft,
  reorderStoryChapters,
  storyApiErrorMessage,
  updateStoryChapter,
  updateStoryProject,
  waitForStoryClipVideoUploadFinalization,
  type CanvasLayoutRevisionConflict,
  type DraftRevisionConflict,
  type InteractiveStoryDraftContent,
  type StoryCandidateAsset,
  type StoryVideoLibraryItem,
  type StoryCanvasPosition,
  type StoryCanvasLayout,
  type StoryWorkbench,
} from "@/lib/story-projects-api";
import {
  STORY_ROOT_NODE_ID,
  buildStoryCanvasModel,
  characterCanvasNodeId,
  rejectsStoryCastWiring,
  syntheticDecisionNodeId,
  syntheticEndingNodeId,
  type StoryCanvasEdge,
  type StoryCanvasNode,
} from "./story-project-canvas-model";
import {
  reconcileStoryCanvasSelectedIds,
  resolveStoryCanvasNodeClick,
} from "./story-project-canvas-selection";
import { storyVideoCardMetadata } from "./story-video-card-metadata";
import {
  CLOSED_STORY_CANVAS_INSPECTOR,
  reconcileStoryCanvasInspectorTarget,
  storyCanvasInspectorNodeId,
  storyNodeInspectorTarget,
  type StoryCanvasInspectorTarget,
} from "./story-canvas-inspector-target";
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
import { StoryCanvasAssistantLayer } from "./story-canvas-assistant-layer";
import { StoryChapterDropdown } from "./story-chapter-dropdown";
import { StoryCanvasLeaveDialog } from "./story-canvas-leave-dialog";
import {
  coordinateStoryCanvasNavigation,
  guardStoryCanvasHistoryTraversal,
  resolveStoryCanvasLeaveRisk,
  type StoryCanvasHistoryEntry,
  type StoryCanvasLeaveRisk,
  type StoryCanvasNavigationEvent,
} from "./story-canvas-leave-guard";
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
import { isExactCurrentStoryRelease } from "./story-current-release";
import {
  addChoiceOption,
  connectSceneContinuation,
  connectChoiceTarget,
  convertSceneExitToChoice,
  convertSceneExitToEnding,
  createClipNode,
  createEndingNode,
  createTextNode,
  moveChoiceOption,
  removeChoiceOption,
  setEntryNode,
  setNodeMusic,
  updateChoiceExitPrompt,
  updateChoiceOptionLabel,
  updateEndingNode,
  updateTextNode,
} from "./story-project-canvas-mutations";
import { StoryCanvasHistory, type StoryCanvasHistorySnapshot } from "./story-canvas-history";
import {
  StoryConnectionCreator,
  type StoryConnectionCreationKind,
} from "./story-connection-creator";
import { StoryNodeCreator, StoryNodeDock, type StoryNodeCreationKind } from "./story-node-creator";
import {
  offsetStoryNodeDockCreationPosition,
  resolveStoryNodeCreationMenuPlacement,
  type StoryNodeCreationMenuPlacement,
} from "./story-node-creator-model";
import type { StoryCandidateAssetUploadState } from "./story-candidate-asset-picker-dialog";
import {
  StoryProductionCanvasWorkspace,
  type StoryProductionCanvasContext,
} from "./story-production-canvas-workspace";
import { useStoryCandidateAssets } from "./use-story-candidate-assets";
import { StoryNodeInspector } from "./story-node-inspector";
import { StoryPublicationDialog } from "./story-publication-dialog";
import {
  createStoryCharacter,
  deleteStoryCharacter,
  updateStoryCharacter,
  updateStoryClipMeta,
} from "./story-world-mutations";
import { StoryDraftSnapshotCoordinator } from "./story-draft-snapshot-coordinator";
import { projectConfirmedClipCurrentVideo } from "./story-workbench-current-video";
import { useStoryPublication } from "./use-story-publication";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
type FoundationField = "logline" | "synopsis" | "worldview";
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
type PendingChoiceDraft = {
  sourceNodeId: string;
  draftId: string;
  label: string;
  required: boolean;
};
type StoryCanvasChoiceContextValue = {
  drafts: PendingChoiceDraft[];
  canEditContent: boolean;
  canCreateOption: boolean;
  start: (sourceNodeId: string) => void;
  updateDraft: (sourceNodeId: string, draftId: string, label: string) => void;
  cancel: (sourceNodeId: string, draftId: string) => void;
  updatePrompt: (sourceNodeId: string, prompt: string) => void;
  updateChoice: (sourceNodeId: string, choiceId: string, label: string) => void;
  moveChoice: (sourceNodeId: string, choiceId: string, direction: "up" | "down") => void;
  removeChoice: (sourceNodeId: string, choiceId: string) => void;
};

const NODE_TYPES = { storyCanvas: StoryGraphNodeCard };
const DEFAULT_EDGE_OPTIONS = {
  type: "default",
  interactionWidth: 28,
  style: { stroke: "rgba(255,255,255,0.25)", strokeWidth: 1.5 },
};
const STORY_PORT_COLORS = {
  entry: "#8f65ff",
  flow: "rgba(255,255,255,0.72)",
  choice: "#5b9dff",
  checkpoint: "#8f65ff",
  ending: "#E52227",
  cast: "rgba(255,255,255,0.34)",
} as const;
const STORY_MEMBERSHIP_EDGE_COLOR = "rgba(255,255,255,0.14)";
const MIN_PLAYER_CHOICES = 2;
const MAX_PLAYER_CHOICES = 6;

const StoryCanvasFocusContext = createContext<string | null>(null);
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
}: {
  projectId: string;
  requestedChapterId?: string;
}) {
  const { activeWorkspace } = useWorkspace();
  // The XYFlow store belongs to the project shell, not to an individual
  // chapter. Chapter projections are swapped inside the mounted shell so a
  // query-param navigation cannot tear down the viewport and flash the cold
  // loading surface.
  const scopeKey = `${activeWorkspace?.id ?? "no-workspace"}:${projectId}`;

  return (
    <ReactFlowProvider key={scopeKey}>
      <StoryProjectCanvasInner projectId={projectId} requestedChapterId={requestedChapterId} />
    </ReactFlowProvider>
  );
}

function StoryProjectCanvasInner({
  projectId,
  requestedChapterId,
}: {
  projectId: string;
  requestedChapterId?: string;
}) {
  const t = useTranslations("storyStudio.canvas");
  const commonT = useTranslations("storyStudio");
  const canvasT = useTranslations("canvas");
  const router = useRouter();
  const { deleteElements, fitView, screenToFlowPosition } = useReactFlow<
    StoryCanvasNode,
    StoryCanvasEdge
  >();
  const queryClient = useQueryClient();
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const [content, setContent] = useState<InteractiveStoryDraftContent | null>(null);
  const [contentChapterId, setContentChapterId] = useState<string | null>(null);
  const [inspectorTarget, setInspectorTarget] = useState<StoryCanvasInspectorTarget>(
    CLOSED_STORY_CANVAS_INSPECTOR
  );
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [chapterDropdownOpen, setChapterDropdownOpen] = useState(false);
  const [productionCanvasSession, setProductionCanvasSession] =
    useState<StoryProductionCanvasContext | null>(null);
  const closeProductionCanvasWorkspace = useCallback(() => setProductionCanvasSession(null), []);
  const [chapterCreatePending, setChapterCreatePending] = useState(false);
  const [chapterMutationPendingId, setChapterMutationPendingId] = useState<string | null>(null);
  const [mutationBarrier] = useState(() => createStoryCanvasMutationBarrier());
  const focusedNodeId = storyCanvasInspectorNodeId(inspectorTarget);
  const inspectorOpen = inspectorTarget.kind !== "closed";
  const [creatorMenu, setCreatorMenu] = useState<StoryNodeCreationMenuPlacement | null>(null);
  const [pendingCompletionDrop, setPendingCompletionDrop] = useState<PendingCompletionDrop | null>(
    null
  );
  const [pendingChoiceDrafts, setPendingChoiceDrafts] = useState<PendingChoiceDraft[]>([]);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<DraftRevisionConflict | null>(null);
  const [layoutConflict, setLayoutConflict] = useState<CanvasLayoutRevisionConflict | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const [, setLayoutSaveState] = useState<SaveState>("idle");
  // Optimistic Story World presence while a layout write is in flight; the
  // authoritative layout projection re-syncs it on adoption.
  const [storyWorldNodePresentOverride, setStoryWorldNodePresentOverrideState] = useState<{
    chapterId: string;
    value: boolean;
  } | null>(null);
  const [workingPreviewPending, setWorkingPreviewPending] = useState(false);
  const [pendingLeaveRisk, setPendingLeaveRisk] = useState<StoryCanvasLeaveRisk | null>(null);
  const [recoveryExported, setRecoveryExported] = useState(false);
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
  const pendingChoiceDraftsRef = useRef<PendingChoiceDraft[]>([]);
  const pendingChoiceDraftSequenceRef = useRef(0);
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
  const explicitDiscardAndLeaveRef = useRef(false);
  const currentHistoryEntryRef = useRef<StoryCanvasHistoryEntry | null>(null);
  const pendingLeaveActionRef = useRef<(() => void) | null>(null);
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
  const pendingCanvasSelectionRef = useRef<string | null>(null);
  const requestedCanvasFocusRef = useRef<string | null>(null);
  const marqueeSelectionActiveRef = useRef(false);
  const latestCanvasSelectionRef = useRef<string[]>([]);
  const pendingNodePositionsRef = useRef(new Map<string, StoryCanvasPosition>());
  const dragStartHistorySnapshotRef = useRef<StoryCanvasHistorySnapshot | null>(null);
  // Set true once a node actually moves during a drag; consumed by onNodeClick
  // so the pointer-up that ends a drag can never open the inspector.
  const didDragNodeRef = useRef(false);

  useLayoutEffect(() => {
    currentHistoryEntryRef.current = {
      href: window.location.href,
      state: window.history.state,
    };
  });

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
    [setCanvasNodes]
  );

  const reconcileCanvasFocus = useCallback((selectedNodeIds: readonly string[]) => {
    const preferredNodeId = requestedCanvasFocusRef.current;
    requestedCanvasFocusRef.current = null;
    setInspectorTarget((current) =>
      reconcileStoryCanvasInspectorTarget(current, selectedNodeIds, preferredNodeId)
    );
  }, []);

  const onCanvasSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams<StoryCanvasNode, StoryCanvasEdge>) => {
      const selectedNodeIds = selectedNodes.map((node) => node.id);
      latestCanvasSelectionRef.current = selectedNodeIds;
      const pendingSelection = pendingCanvasSelectionRef.current;
      if (!pendingSelection || selectedNodeIds.includes(pendingSelection)) {
        pendingCanvasSelectionRef.current = null;
      }
      if (!marqueeSelectionActiveRef.current) reconcileCanvasFocus(selectedNodeIds);
    },
    [reconcileCanvasFocus]
  );

  const onCanvasSelectionStart = useCallback(() => {
    marqueeSelectionActiveRef.current = true;
  }, []);

  const onCanvasSelectionEnd = useCallback(() => {
    marqueeSelectionActiveRef.current = false;
    reconcileCanvasFocus(latestCanvasSelectionRef.current);
  }, [reconcileCanvasFocus]);

  const workbenchQueryKey = useMemo(
    () => storyProjectionQueryKey("workbench", workspaceId, projectId, requestedChapterId ?? null),
    [projectId, requestedChapterId, workspaceId]
  );
  const workbenchQuery = useQuery({
    ...storyProjectionQueryOptions({
      kind: "workbench",
      workspaceId,
      projectId,
      chapterId: requestedChapterId ?? null,
      queryFn: () => getStoryWorkbench(workspaceId as string, projectId, requestedChapterId),
    }),
  });
  // Prefer the URL target over kept-previous workbench data. Otherwise the
  // layout query remains pinned to the old chapter until the workbench read
  // finishes, extending the transition and allowing mismatched projections.
  const resolvedChapterId = requestedChapterId ?? workbenchQuery.data?.chapter.id ?? null;
  const layoutQueryKey = useMemo(
    () => storyProjectionQueryKey("canvas-layout", workspaceId, projectId, resolvedChapterId),
    [projectId, resolvedChapterId, workspaceId]
  );
  const refetchWorkbench = workbenchQuery.refetch;
  const layoutQuery = useQuery(
    storyProjectionQueryOptions({
      kind: "canvas-layout",
      workspaceId,
      projectId,
      chapterId: resolvedChapterId,
      queryFn: () =>
        getStoryCanvasLayout(workspaceId as string, projectId, resolvedChapterId as string),
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
    hasWorkspace: Boolean(workspaceId),
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
  const activeProjectionChapterId = projectionPair?.chapterId ?? null;
  const setStoryWorldNodePresentOverride = useCallback(
    (value: boolean | null) => {
      setStoryWorldNodePresentOverrideState(
        value === null || activeProjectionChapterId === null
          ? null
          : { chapterId: activeProjectionChapterId, value }
      );
    },
    [activeProjectionChapterId]
  );
  // The Story World card presence is layout-owned (layout v2): legacy projects
  // (and any layout that predates the flag) keep the card; fresh projects start
  // without it so the empty-canvas agent launcher (idea + director skills) can
  // own the first-open experience. The card is summoned from the creator
  // menu/dock and deletable like any canvas projection.
  const storyWorldNodePresent =
    (storyWorldNodePresentOverride?.chapterId === activeProjectionChapterId
      ? storyWorldNodePresentOverride.value
      : null) ??
    layoutProjection?.storyWorldNodePresent ??
    true;
  const currentReleaseQuery = useQuery({
    queryKey: ["story-studio", "current-release", workspaceId, projectId],
    queryFn: () => getStoryExperienceCurrentRelease(workspaceId as string, projectId),
    enabled: Boolean(workspaceId),
    retry: 1,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const project = workbenchProjection?.project ?? null;
  const video = workbenchProjection?.video ?? null;

  const cacheSavedDraft = useCallback(
    (saved: StoryWorkbench["draft"]) => {
      if (!workspaceId) return;
      queryClient.setQueryData<StoryWorkbench>(workbenchQueryKey, (current) =>
        current && saved.revision >= current.draft.revision ? { ...current, draft: saved } : current
      );
    },
    [queryClient, workbenchQueryKey, workspaceId]
  );

  useLayoutEffect(() => {
    if (!workbenchProjection) return;
    const workbench = workbenchProjection;
    const chapterChanged = hydratedChapterIdRef.current !== workbench.chapter.id;
    if (hydratedRef.current && !chapterChanged) {
      if (workbench.draft.revision <= revisionRef.current || conflictRef.current) return;
      const latest = latestContentRef.current;
      const hasLocalChanges = Boolean(
        recoveryContentRef.current ||
        saveInFlightRef.current ||
        (latest && canonicalJsonString(latest) !== savedSignatureRef.current)
      );
      if (hasLocalChanges) return;
    }
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
      setPendingChoiceDrafts([]);
    }
    hydratedRef.current = true;
    hydratedChapterIdRef.current = workbench.chapter.id;
    revisionRef.current = workbench.draft.revision;
    setDraftRevision(workbench.draft.revision);
    savedSignatureRef.current = canonicalJsonString(workbench.draft.content);
    latestContentRef.current = workbench.draft.content;
    history.clear();
    setHistoryVersion((current) => current + 1);
    setContentChapterId(workbench.chapter.id);
    setContent(workbench.draft.content);
    setSaveState("idle");
  }, [history, workbenchProjection]);

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
        const saved = await putStoryDraft(workspaceId, projectId, resolvedChapterId, {
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

  const publication = useStoryPublication({
    workspaceId,
    projectId,
    capabilities: project?.capabilities ?? [],
    withSavedDraftSnapshot,
  });

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
            workspaceId,
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
    rootTitle: t("projection.rootTitle"),
    rootEyebrow: t("projection.rootEyebrow"),
    rootSummary: t("projection.rootSummary"),
    clip: t("projection.clip"),
    text: t("projection.text"),
    decision: t("projection.decision"),
    ending: t("projection.ending"),
  };
  const model = useMemo(
    () =>
      content
        ? buildStoryCanvasModel(
            content,
            project?.defaultLocale ?? "en-US",
            video?.clips ?? [],
            projectionCopy,
            project?.frameProfile,
            storyWorldNodePresent,
            project?.cover ?? null
          )
        : null,
    // Translation values are primitives. Depending on them keeps the model
    // stable across ordinary renders while still refreshing after a locale change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      content,
      video?.clips,
      project?.defaultLocale,
      project?.frameProfile,
      project?.cover,
      storyWorldNodePresent,
      projectionCopy.rootTitle,
      projectionCopy.rootEyebrow,
      projectionCopy.rootSummary,
      projectionCopy.clip,
      projectionCopy.text,
      projectionCopy.decision,
      projectionCopy.ending,
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
      canPublish: true,
    },
    projectionReadiness,
    hasDraftConflict: Boolean(conflict),
    hasLayoutConflict: Boolean(layoutConflict),
  });
  const canEdit = editPolicy.canEditContent;
  const canMutateCanvasLayout = editPolicy.canEditLayout;
  const choiceDraftRequirements = useMemo(
    () =>
      model?.nodes.flatMap((node) =>
        node.data.kind === "decision" && node.data.sourceNodeId
          ? [
              {
                sourceNodeId: node.data.sourceNodeId,
                choiceCount: node.data.choices?.length ?? 0,
              },
            ]
          : []
      ) ?? [],
    [model]
  );
  const materializeChoiceDrafts = (drafts: PendingChoiceDraft[]) =>
    reconcilePendingChoiceDrafts(drafts, choiceDraftRequirements, (sourceNodeId, index) => ({
      sourceNodeId,
      draftId: `required-${index + 1}`,
      label: t("decisionCard.defaultOption", {
        number:
          (choiceDraftRequirements.find((requirement) => requirement.sourceNodeId === sourceNodeId)
            ?.choiceCount ?? 0) +
          index +
          1,
      }),
      required: true,
    }));
  const activePendingChoiceDrafts = canMutateCanvasLayout
    ? materializeChoiceDrafts(pendingChoiceDrafts)
    : [];
  useLayoutEffect(() => {
    pendingChoiceDraftsRef.current = activePendingChoiceDrafts;
  });
  const startChoiceDraft = (sourceNodeId: string) => {
    if (!canMutateCanvasLayout) return;
    setPendingChoiceDrafts((current) => {
      const materialized = materializeChoiceDrafts(current);
      const choiceCount =
        choiceDraftRequirements.find((requirement) => requirement.sourceNodeId === sourceNodeId)
          ?.choiceCount ?? 0;
      if (
        choiceCount + materialized.filter((draft) => draft.sourceNodeId === sourceNodeId).length >=
        MAX_PLAYER_CHOICES
      ) {
        return materialized;
      }
      pendingChoiceDraftSequenceRef.current += 1;
      return [
        ...materialized,
        {
          sourceNodeId,
          draftId: `draft-${pendingChoiceDraftSequenceRef.current}`,
          label: t("decisionCard.defaultOption", {
            number:
              choiceCount +
              materialized.filter((draft) => draft.sourceNodeId === sourceNodeId).length +
              1,
          }),
          required: false,
        },
      ];
    });
  };
  const updateChoiceDraft = (sourceNodeId: string, draftId: string, label: string) => {
    setPendingChoiceDrafts((current) =>
      materializeChoiceDrafts(current).map((draft) =>
        draft.sourceNodeId === sourceNodeId && draft.draftId === draftId
          ? { ...draft, label }
          : draft
      )
    );
  };
  const cancelChoiceDraft = (sourceNodeId: string, draftId: string) => {
    setPendingChoiceDrafts((current) =>
      materializeChoiceDrafts(current).filter(
        (draft) =>
          draft.required || draft.sourceNodeId !== sourceNodeId || draft.draftId !== draftId
      )
    );
  };
  const removePendingChoiceDraft = (sourceNodeId: string, draftId: string) => {
    setPendingChoiceDrafts((current) =>
      materializeChoiceDrafts(current).filter(
        (draft) => draft.sourceNodeId !== sourceNodeId || draft.draftId !== draftId
      )
    );
  };
  const choiceContext: StoryCanvasChoiceContextValue = {
    drafts: activePendingChoiceDrafts,
    canEditContent: canEdit,
    canCreateOption: canMutateCanvasLayout,
    start: startChoiceDraft,
    updateDraft: updateChoiceDraft,
    cancel: cancelChoiceDraft,
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
      applyGraphMutation((current) => moveChoiceOption(current, sourceNodeId, choiceId, direction));
    },
    removeChoice: (sourceNodeId, choiceId) => {
      applyGraphMutation((current) => removeChoiceOption(current, sourceNodeId, choiceId));
    },
  };
  const candidateAssets = useStoryCandidateAssets({
    workspaceId,
    projectId,
    canEdit: canMutateCanvasLayout,
  });
  useLayoutEffect(() => {
    mutationBarrier.update({
      canEditContent: canEdit,
      canEditLayout: canMutateCanvasLayout,
      canManageProduction: editPolicy.canManageProduction,
    });
  }, [canEdit, canMutateCanvasLayout, editPolicy.canManageProduction, mutationBarrier]);
  const canManageClipMedia = editPolicy.canManageProduction;
  const clipMediaDisabledReason = !canManageClipMedia
    ? !project?.capabilities.includes("story.generate")
      ? t("production.disabled.permission")
      : t("readOnly")
    : null;
  const coverMediaDisabledReason = canMutateCanvasLayout ? null : t("readOnly");
  const updateProjectCover = async (coverAssetId: string | null) => {
    if (!workspaceId || !project || !canMutateCanvasLayout) {
      throw new Error(t("production.errors.action"));
    }
    try {
      const updatedProject = await updateStoryProject(workspaceId, projectId, {
        expectedProjectVersion: project.projectVersion,
        coverAssetId,
      });
      queryClient.setQueryData<StoryWorkbench>(workbenchQueryKey, (current) =>
        current ? { ...current, project: updatedProject } : current
      );
      void queryClient.invalidateQueries({
        queryKey: ["story-studio", "projects"],
      });
    } catch (error) {
      await refetchWorkbench();
      throw error;
    }
  };
  const selectProjectCover = async (candidate: StoryCandidateAsset) => {
    await updateProjectCover(candidate.asset.id);
  };
  const uploadProjectCover = async (
    file: File,
    onState: (state: StoryCandidateAssetUploadState) => void,
    signal: AbortSignal
  ) => {
    if (!workspaceId || !canMutateCanvasLayout) {
      throw new Error(t("production.errors.action"));
    }
    const isVideo =
      file.type.toLowerCase().startsWith("video/") || /\.(?:mp4|mov)$/i.test(file.name);
    const uploaded = await uploadFileViaSignedUrl(file, {
      kind: isVideo ? "ai_reference_video" : "ai_reference_image",
      workspaceId,
      onProgress: (progress) => onState({ stage: "uploading", progress }),
      signal,
    });
    if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
    onState({ stage: "processing" });
    const candidate = await addStoryCandidateAsset(workspaceId, projectId, uploaded.mediaAssetId);
    await candidateAssets.refresh();
    if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
    await updateProjectCover(candidate.asset.id);
  };

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
      setLayoutConflict(null);
      setStoryWorldNodePresentOverride(null);
      setInspectorTarget(CLOSED_STORY_CANVAS_INSPECTOR);
      layoutHydratedChapterIdRef.current = workbenchProjection.chapter.id;
    }
    const authoritativeLayout: StoryCanvasLayoutPayload = {
      nodePositions: layoutProjection.nodePositions,
      storyWorldNodePresent: layoutProjection.storyWorldNodePresent,
    };
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
    const currentById = new Map(canvasNodesRef.current.map((node) => [node.id, node]));
    const pendingSelection = pendingCanvasSelectionRef.current;
    const selectedNodeIds = reconcileStoryCanvasSelectedIds(
      model.nodes.map((node) => node.id),
      new Set(canvasNodesRef.current.filter((node) => node.selected).map((node) => node.id)),
      pendingSelection
    );
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
        position: layoutProjection.nodePositions[node.id] ?? node.position,
        selected: selectedNodeIds.has(node.id),
      }));
      const initialLayout = canvasLayoutPayload(initialNodes, storyWorldNodePresent);
      layoutHydratedRef.current = true;
      layoutRevisionRef.current = layoutProjection.revision;
      latestDesiredLayoutRef.current = initialLayout;
      layoutSavedSignatureRef.current = layoutPayloadSignature(initialLayout);
      setLayoutSaveState("idle");
      canvasNodesRef.current = initialNodes;
      setCanvasNodes(initialNodes);
      reconcileFocusAfterModel(initialNodes);
      return;
    }
    if (shouldAdoptAuthoritativeLayout) {
      layoutRevisionRef.current = layoutProjection.revision;
      setStoryWorldNodePresentOverride(layoutProjection.storyWorldNodePresent);
      setLayoutSaveState("idle");
      history.clear();
      setHistoryVersion((current) => current + 1);
    }
    const placedNodeIds: string[] = [];
    const nextNodes = model.nodes.map((node) => {
      const pendingPosition = pendingNodePositionsRef.current.get(node.id);
      if (pendingPosition) placedNodeIds.push(node.id);
      return {
        ...node,
        selected: selectedNodeIds.has(node.id),
        position:
          pendingPosition ??
          (shouldAdoptAuthoritativeLayout
            ? layoutProjection.nodePositions[node.id]
            : (currentById.get(node.id)?.position ?? layoutProjection.nodePositions[node.id])) ??
          node.position,
      };
    });
    placedNodeIds.forEach((nodeId) => pendingNodePositionsRef.current.delete(nodeId));
    canvasNodesRef.current = nextNodes;
    setCanvasNodes(nextNodes);
    reconcileFocusAfterModel(nextNodes);
    if (shouldAdoptAuthoritativeLayout) {
      const adoptedLayout = canvasLayoutPayload(
        nextNodes,
        authoritativeLayout.storyWorldNodePresent
      );
      latestDesiredLayoutRef.current = adoptedLayout;
      layoutSavedSignatureRef.current = layoutPayloadSignature(adoptedLayout);
    }
    if (placedNodeIds.length > 0) {
      const nextLayout = canvasLayoutPayload(nextNodes, storyWorldNodePresent);
      setLayoutSaveState("dirty");
      void persistLayoutRef.current(nextLayout);
    }
  }, [
    contentChapterId,
    history,
    layoutProjection,
    model,
    setCanvasNodes,
    storyWorldNodePresent,
    setStoryWorldNodePresentOverride,
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
        setLayoutSaveState((current) => (current === "idle" ? "idle" : "saved"));
        return;
      }

      clearLayoutSaveRetry();
      recoveryLayoutRef.current = next;
      layoutSaveInFlightRef.current = true;
      setLayoutSaveState("saving");
      let requestFailed = false;
      let requestConflicted = false;
      let failure: unknown = null;
      try {
        const saved = await putStoryCanvasLayout(workspaceId, projectId, resolvedChapterId, {
          expectedRevision: layoutRevisionRef.current,
          nodePositions: next.nodePositions,
          storyWorldNodePresent: next.storyWorldNodePresent,
          sessionId,
        });
        layoutRevisionRef.current = saved.revision;
        layoutSavedSignatureRef.current = signature;
        recoveryLayoutRef.current = null;
        clearLayoutSaveRetry(true);
        setLayoutSaveState("saved");
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
          setLayoutSaveState("saved");
        } else if (nextConflict) {
          failure = error;
          requestConflicted = true;
          layoutConflictRef.current = nextConflict;
          recoveryLayoutRef.current = next;
          clearLayoutSaveRetry(true);
          setCreatorMenu(null);
          setPendingCompletionDrop(null);
          setLayoutConflict(nextConflict);
          setLayoutSaveState("conflict");
        } else {
          failure = error;
          requestFailed = true;
          recoveryLayoutRef.current = next;
          setLayoutSaveState("error");
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

  const readLeaveRisk = useCallback((): StoryCanvasLeaveRisk => {
    const latestDraft = latestContentRef.current;
    const latestLayout = latestDesiredLayoutRef.current;
    return resolveStoryCanvasLeaveRisk({
      draftDirty: Boolean(
        recoveryContentRef.current ||
        inFlightContentRef.current ||
        (latestDraft && canonicalJsonString(latestDraft) !== savedSignatureRef.current)
      ),
      draftSaveInFlight: saveInFlightRef.current,
      draftConflict: conflictRef.current !== null,
      layoutDirty: Boolean(
        recoveryLayoutRef.current ||
        (latestLayout && layoutPayloadSignature(latestLayout) !== layoutSavedSignatureRef.current)
      ),
      layoutSaveInFlight: layoutSaveInFlightRef.current,
      layoutConflict: layoutConflictRef.current !== null,
    });
  }, []);

  const queueBlockedNavigation = useCallback((risk: StoryCanvasLeaveRisk, resume: () => void) => {
    pendingLeaveActionRef.current = resume;
    setRecoveryExported(false);
    setPendingLeaveRisk(risk);
  }, []);

  const requestStoryCanvasNavigation = useCallback(
    (event: StoryCanvasNavigationEvent | null, resume: () => void) => {
      if (explicitDiscardAndLeaveRef.current) {
        if (!event) resume();
        return false;
      }
      return coordinateStoryCanvasNavigation({
        event,
        risk: readLeaveRisk(),
        resume,
        onBlocked: queueBlockedNavigation,
      });
    },
    [queueBlockedNavigation, readLeaveRisk]
  );

  useEffect(() => {
    const guardHistoryTraversal = (event: PopStateEvent) => {
      if (explicitDiscardAndLeaveRef.current) return;
      const currentEntry = currentHistoryEntryRef.current;
      if (!currentEntry) return;
      guardStoryCanvasHistoryTraversal({
        event,
        risk: readLeaveRisk(),
        currentEntry,
        history: window.history,
        onBlocked: queueBlockedNavigation,
      });
    };

    // Next installs a bubble listener. Capturing lets the canvas restore the
    // active entry before App Router consumes a dirty back/forward traversal.
    window.addEventListener("popstate", guardHistoryTraversal, { capture: true });
    return () => {
      window.removeEventListener("popstate", guardHistoryTraversal, { capture: true });
    };
  }, [queueBlockedNavigation, readLeaveRisk]);

  const openWorkingPreview = useCallback(async () => {
    if (!workspaceId || workingPreviewPending) return;
    setWorkingPreviewPending(true);
    try {
      await withSavedDraftSnapshot(async () => {
        requestStoryCanvasNavigation(null, () => {
          router.push(`/story-studio/projects/${encodeURIComponent(projectId)}/playtest`);
        });
      });
    } catch (error) {
      if (!disposedRef.current)
        toast.error(storyApiErrorMessage(error, t("workingPreview.errorFallback")));
    } finally {
      if (!disposedRef.current) setWorkingPreviewPending(false);
    }
  }, [
    projectId,
    requestStoryCanvasNavigation,
    router,
    t,
    withSavedDraftSnapshot,
    workingPreviewPending,
    workspaceId,
  ]);

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
          storyWorldNodePresent: saved.storyWorldNodePresent,
        });
        recoveryLayoutRef.current = null;
        clearLayoutSaveRetry(true);
        queryClient.setQueryData(layoutQueryKey, saved);
        if (!disposedRef.current) {
          setLayoutSaveState("saved");
        }
        return true;
      };

      void putStoryCanvasLayout(
        workspaceId,
        projectId,
        resolvedChapterId,
        {
          expectedRevision,
          nodePositions: next.nodePositions,
          storyWorldNodePresent: next.storyWorldNodePresent,
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
            setLayoutSaveState("conflict");
            return;
          }
          setLayoutSaveState("error");
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
      if (explicitDiscardAndLeaveRef.current) return;
      if (saveDebounceTimerRef.current !== null) {
        window.clearTimeout(saveDebounceTimerRef.current);
        saveDebounceTimerRef.current = null;
      }
      clearSaveRetry();
      clearLayoutSaveRetry();
      flushDraftBeforeLeaving(keepalive);
      flushLayoutBeforeLeaving(keepalive);
    };
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (explicitDiscardAndLeaveRef.current || !readLeaveRisk().blocked) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const flushOnPageHide = () => {
      pageHiding = true;
      flushBeforeLeaving(true);
    };
    const restoreAfterPageShow = () => {
      pageHiding = false;
      disposedRef.current = false;
      explicitDiscardAndLeaveRef.current = false;
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

    window.addEventListener("beforeunload", warnBeforeUnload);
    window.addEventListener("pagehide", flushOnPageHide);
    window.addEventListener("pageshow", restoreAfterPageShow);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      window.removeEventListener("pagehide", flushOnPageHide);
      window.removeEventListener("pageshow", restoreAfterPageShow);
      disposedRef.current = true;
      flushBeforeLeaving(pageHiding);
    };
  }, [
    clearLayoutSaveRetry,
    clearSaveRetry,
    flushDraftBeforeLeaving,
    flushLayoutBeforeLeaving,
    readLeaveRisk,
  ]);

  const focusedNode = useMemo(
    () => model?.nodes.find((node) => node.id === focusedNodeId) ?? null,
    [focusedNodeId, model?.nodes]
  );
  const focusedClipVideo =
    focusedNode?.data.kind === "clip" ? (focusedNode.data.clipVideo ?? null) : null;
  const focusedGraphNodeId = focusedNode?.data.kind === "clip" ? focusedNode.data.nodeId : null;
  const updateClipVideoSelection = useCallback(
    async (
      graphNodeId: string,
      expectedSelectionVersion: number,
      selection: { assetId: string | null; variantId: string | null }
    ) => {
      if (!workspaceId || !mutationBarrier.permits("production")) {
        throw new Error(t("production.errors.action"));
      }
      try {
        const confirmedClip = await withSavedDraftSnapshot((expectedDraftRevision) =>
          putStoryClipCurrentVideo(workspaceId, projectId, graphNodeId, {
            expectedDraftRevision,
            expectedSelectionVersion,
            ...selection,
          })
        );
        queryClient.setQueryData<StoryWorkbench>(workbenchQueryKey, (current) =>
          projectConfirmedClipCurrentVideo(current, confirmedClip)
        );
        void refetchWorkbench();
      } catch (error) {
        // A stale selection/draft token is recoverable only after refreshing
        // the authoritative clip summary. Keep the upstream error for the UI.
        await refetchWorkbench();
        throw error;
      }
    },
    [
      mutationBarrier,
      projectId,
      queryClient,
      refetchWorkbench,
      t,
      withSavedDraftSnapshot,
      workbenchQueryKey,
      workspaceId,
    ]
  );
  const bindClipVideo = useCallback(
    async (graphNodeId: string, expectedSelectionVersion: number, item: StoryVideoLibraryItem) =>
      updateClipVideoSelection(graphNodeId, expectedSelectionVersion, {
        assetId: item.asset.id,
        variantId: item.variantId,
      }),
    [updateClipVideoSelection]
  );
  const selectCandidateClipVideo = useCallback(
    async (candidate: StoryCandidateAsset) => {
      if (!focusedGraphNodeId || !candidate.videoVariant) {
        throw new Error(t("inspector.media.candidateUnavailable"));
      }
      await bindClipVideo(focusedGraphNodeId, focusedClipVideo?.selectionVersion ?? 0, {
        asset: candidate.asset,
        variantId: candidate.videoVariant.id,
        variantKey: candidate.videoVariant.variantKey,
        contentType: candidate.videoVariant.contentType,
        width: candidate.videoVariant.width,
        height: candidate.videoVariant.height,
        durationSeconds: candidate.videoVariant.durationSeconds,
        checksumSha256: candidate.videoVariant.checksumSha256,
        createdAt: candidate.addedAt,
      });
    },
    [bindClipVideo, focusedClipVideo?.selectionVersion, focusedGraphNodeId, t]
  );
  const clearSelectedClipVideo = useCallback(async () => {
    if (!focusedGraphNodeId || !focusedClipVideo?.currentVideo) {
      return;
    }
    await updateClipVideoSelection(focusedGraphNodeId, focusedClipVideo.selectionVersion, {
      assetId: null,
      variantId: null,
    });
  }, [focusedClipVideo, focusedGraphNodeId, updateClipVideoSelection]);
  const uploadSelectedClipVideo = useCallback(
    async (
      file: File,
      onState: (state: StoryCandidateAssetUploadState) => void,
      signal: AbortSignal
    ) => {
      if (!workspaceId || !focusedGraphNodeId || !mutationBarrier.permits("production")) {
        throw new Error(t("production.errors.action"));
      }
      // Capture the target before the long upload starts. Selecting another
      // canvas node mid-upload must never bind the result to that later node.
      // A graph node with no video state starts at selectionVersion 0.
      const graphNodeId = focusedGraphNodeId;
      const expectedSelectionVersion = focusedClipVideo?.selectionVersion ?? 0;
      let issuedMediaAssetId: string | null = null;
      let finalizationAccepted = false;
      try {
        const uploaded = await uploadFileViaSignedUrl(file, {
          kind: "story_clip_video",
          workspaceId,
          scope: { projectId },
          onProgress: (progress) => onState({ stage: "uploading", progress }),
          onSessionIssued: ({ mediaAssetId }) => {
            issuedMediaAssetId = mediaAssetId;
          },
          signal,
        });
        if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
        onState({ stage: "processing" });
        const finalization = await completeStoryClipVideoUpload(
          workspaceId,
          projectId,
          {
            mediaAssetId: uploaded.mediaAssetId,
          },
          signal
        );
        // From this point the durable worker owns completion. If the user
        // changes nodes during polling, keep the resulting asset in the
        // workspace library instead of attempting to cancel active processing.
        finalizationAccepted = true;
        const item = await waitForStoryClipVideoUploadFinalization(
          workspaceId,
          projectId,
          finalization,
          { signal }
        );
        if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
        await bindClipVideo(graphNodeId, expectedSelectionVersion, item);
      } catch (error) {
        if (issuedMediaAssetId && !finalizationAccepted) {
          // Use a fresh bounded request: the upload signal is already aborted.
          // Cancellation is best-effort and must never hide the real failure.
          await cancelStoryClipVideoUpload(workspaceId, projectId, issuedMediaAssetId).catch(
            () => undefined
          );
        }
        throw error;
      }
    },
    [
      bindClipVideo,
      mutationBarrier,
      focusedClipVideo,
      focusedGraphNodeId,
      projectId,
      t,
      workspaceId,
    ]
  );
  const authoringLocale = project?.defaultLocale ?? "en-US";
  const layeredCanvasNodes = useMemo(
    () =>
      canvasNodes.map((node) => {
        const zIndex = node.id === focusedNodeId ? 1 : 0;
        return node.zIndex === zIndex ? node : { ...node, zIndex };
      }),
    [canvasNodes, focusedNodeId]
  );
  const displayEdges = useMemo(
    () =>
      model?.edges.map((edge) => {
        const related =
          !focusedNodeId || edge.source === focusedNodeId || edge.target === focusedNodeId;
        const isMembership = edge.data.kind === "membership";
        return {
          ...edge,
          // The membership tether reads as "belongs to this world", never story
          // flow: it stays behind the flow edges and never lifts on focus.
          zIndex: isMembership ? 0 : related ? 2 : 0,
          style: {
            ...DEFAULT_EDGE_OPTIONS.style,
            strokeWidth: isMembership ? 1 : DEFAULT_EDGE_OPTIONS.style.strokeWidth,
            opacity: isMembership ? (related ? 0.9 : 0.32) : related ? 1 : 0.18,
            stroke: isMembership
              ? STORY_MEMBERSHIP_EDGE_COLOR
              : edge.data.kind === "root"
                ? STORY_PORT_COLORS.entry
                : edge.data.kind === "choice" || edge.data.kind === "decision"
                  ? STORY_PORT_COLORS.choice
                  : edge.data.kind === "checkpoint"
                    ? STORY_PORT_COLORS.checkpoint
                    : edge.data.kind === "ending"
                      ? STORY_PORT_COLORS.ending
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
    const timer = window.setTimeout(() => {
      if (hasFittedInitialCanvasRef.current) return;
      hasFittedInitialCanvasRef.current = true;
      void fitView({ padding: 0.16, duration: 420, maxZoom: 0.78 });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [canvasNodes.length, fitView]);

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
          pendingNodePositionsRef.current,
          storyWorldNodePresent
        ),
        storyWorldNodePresent,
      };
    },
    [storyWorldNodePresent]
  );

  /**
   * The single persistence path for every layout move — dragging and tidying
   * alike — so the edit barrier, the undo snapshot and the no-op signature check
   * can never drift apart between them.
   */
  const commitCanvasLayout = useCallback(
    (nextNodes: StoryCanvasNode[], beforeMove: StoryCanvasHistorySnapshot | null) => {
      if (!mutationBarrier.permits("layout")) return;
      const nextLayout = canvasLayoutPayload(nextNodes, storyWorldNodePresent);
      if (
        beforeMove &&
        layoutPositionSignature(beforeMove.nodePositions) !==
          layoutPositionSignature(nextLayout.nodePositions)
      ) {
        history.capture(beforeMove);
        refreshHistoryState();
      }
      if (layoutPayloadSignature(nextLayout) === layoutSavedSignatureRef.current) return;
      setLayoutSaveState("dirty");
      void persistLayoutRef.current(nextLayout);
    },
    [history, mutationBarrier, refreshHistoryState, storyWorldNodePresent]
  );

  // Tidy reaches the store through the same commit path as a drag: positions land
  // in the projection via `onCanvasNodesChange` (which the barrier already
  // filters) and are persisted here, so a tidy survives a reload.
  const tidyStoryCanvas = useCanvasTidy<StoryCanvasNode, StoryCanvasEdge>({
    edges: canvasEdges,
    onNodesChange: onCanvasNodesChange,
    onTidied: useCallback(
      (nextNodes: StoryCanvasNode[]) => commitCanvasLayout(nextNodes, readHistorySnapshot()),
      [commitCanvasLayout, readHistorySnapshot]
    ),
  });

  const restoreHistorySnapshot = useCallback(
    (snapshot: StoryCanvasHistorySnapshot) => {
      if (!mutationBarrier.permits("layout")) return;
      const currentSnapshot = readHistorySnapshot();
      const nextLayout: StoryCanvasLayoutPayload = {
        nodePositions: snapshot.nodePositions,
        storyWorldNodePresent: snapshot.storyWorldNodePresent,
      };
      const layoutChanged =
        !currentSnapshot ||
        layoutPayloadSignature({
          nodePositions: currentSnapshot.nodePositions,
          storyWorldNodePresent: currentSnapshot.storyWorldNodePresent,
        }) !== layoutPayloadSignature(nextLayout);

      latestContentRef.current = snapshot.content;
      setPendingCompletionDrop(null);
      closeCreatorMenu();
      setGraphError(null);
      setContent(snapshot.content);
      setStoryWorldNodePresentOverride(snapshot.storyWorldNodePresent);

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
      setLayoutSaveState("dirty");
      void persistLayoutRef.current(nextLayout);
    },
    [
      closeCreatorMenu,
      mutationBarrier,
      readHistorySnapshot,
      setCanvasNodes,
      setStoryWorldNodePresentOverride,
    ]
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
    enabled: canMutateCanvasLayout && !productionCanvasSession,
    undo: undoStoryCanvas,
    redo: redoStoryCanvas,
  });

  const commitContent = (
    next: InteractiveStoryDraftContent,
    options: CommitContentOptions = {}
  ): boolean => {
    // This is the final write barrier. Event handlers also gate eagerly for
    // UX, but a stale callback must never bypass a newly acquired Agent lock,
    // conflict, or permission change.
    if (!mutationBarrier.permits("content")) return false;
    const current = latestContentRef.current;
    if (!current || next === current) return false;
    const snapshot = readHistorySnapshot(current);
    if (!snapshot) return false;
    history.capture(snapshot, { mergeKey: options.mergeKey });
    refreshHistoryState();
    latestContentRef.current = next;
    setContent(next);
    return true;
  };

  const updateFoundation = (field: FoundationField, value: string) => {
    const current = latestContentRef.current;
    if (!current || !mutationBarrier.permits("content")) return;
    commitContent(
      {
        ...current,
        storyBible: { ...current.storyBible, [field]: value },
      },
      { mergeKey: `foundation:${field}` }
    );
  };

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

  // Newborn cards live only in pendingNodePositionsRef until some later drag
  // persists the layout; an authoritative layout echo arriving before that
  // (realtime, revision adoption) doesn't know the node and snaps it back to
  // its model-default slot. Persist immediately so the placement sticks.
  const persistLayoutWithPendingPositions = (nextContent: InteractiveStoryDraftContent) => {
    const nextLayout: StoryCanvasLayoutPayload = {
      nodePositions: historyNodePositions(
        nextContent,
        canvasNodesRef.current,
        pendingNodePositionsRef.current,
        storyWorldNodePresent
      ),
      storyWorldNodePresent,
    };
    setLayoutSaveState("dirty");
    void persistLayoutRef.current(nextLayout);
  };

  const createStoryElement = (
    kind: StoryNodeCreationKind,
    position: StoryCanvasPosition,
    options?: { atDropPosition?: boolean }
  ) => {
    if (!content || !mutationBarrier.permits("layout")) return;
    try {
      // Summoning the Story World card is a pure layout mutation: the draft
      // and entry semantics are untouched, presence flips in the canvas layout.
      if (kind === "root") {
        if (storyWorldNodePresent) return;
        const snapshot = readHistorySnapshot();
        if (!snapshot) return;
        history.capture(snapshot);
        refreshHistoryState();
        pendingNodePositionsRef.current.set(STORY_ROOT_NODE_ID, { ...position });
        const nextLayout: StoryCanvasLayoutPayload = {
          nodePositions: {
            ...snapshot.nodePositions,
            [STORY_ROOT_NODE_ID]: { ...position },
          },
          storyWorldNodePresent: true,
        };
        setStoryWorldNodePresentOverride(true);
        setLayoutSaveState("dirty");
        void persistLayoutRef.current(nextLayout);
        selectCanvasNodeExclusively(STORY_ROOT_NODE_ID);
        setGraphError(null);
        return;
      }

      let nextContent: InteractiveStoryDraftContent;
      let createdCanvasNodeId: string;
      // Characters are never wired into the story-flow graph; a fresh cast card
      // is seeded in the cast lane left of the root regardless of the click
      // point that opened the creator.
      let placement = position;

      if (kind === "clip") {
        const result = createClipNode(content);
        nextContent = result.content;
        createdCanvasNodeId = result.created.nodeId;
      } else if (kind === "text") {
        const result = createTextNode(content, { locale: authoringLocale });
        nextContent = result.content;
        createdCanvasNodeId = result.created.nodeId;
      } else if (kind === "ending") {
        const result = createEndingNode(content, { locale: authoringLocale });
        nextContent = result.content;
        createdCanvasNodeId = syntheticEndingNodeId(result.created.id);
      } else if (kind === "character") {
        const result = createStoryCharacter(content, { locale: authoringLocale });
        nextContent = result.content;
        createdCanvasNodeId = characterCanvasNodeId(result.created.id);
        // A cast-anchor drag carries spatial intent; menu/dock entries don't
        // and keep the tidy cast-lane default.
        if (!options?.atDropPosition) placement = nextCastLanePosition(canvasNodesRef.current);
      } else return;

      pendingNodePositionsRef.current.set(createdCanvasNodeId, { ...placement });
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
        showStoryWorld: !storyWorldNodePresent,
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

  const connectStoryNodes = (connection: Connection) => {
    if (
      !mutationBarrier.permits("content") ||
      !connection.source ||
      !connection.target ||
      !content ||
      !model
    ) {
      return;
    }
    const source = model.nodes.find((node) => node.id === connection.source);
    const target = model.nodes.find((node) => node.id === connection.target);
    if (!source || !target) return;
    const choiceDraftId =
      source.data.kind === "decision" ? choiceDraftIdFromHandle(connection.sourceHandle) : null;
    const createsChoice = choiceDraftId !== null;
    const pendingDraft = pendingChoiceDraftsRef.current.find(
      (draft) => draft.sourceNodeId === source.data.sourceNodeId && draft.draftId === choiceDraftId
    );
    const pendingLabel = createsChoice && pendingDraft ? pendingDraft.label.trim() : "";
    if (createsChoice && !pendingLabel) return;
    // Red line: character cards tether only to the Story World root and can
    // never participate in a story-flow connection in either direction.
    if (
      rejectsStoryCastWiring({
        sourceKind: source.data.kind,
        targetKind: target.data.kind,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      })
    ) {
      return;
    }
    const committed = applyGraphMutation((current) => {
      if (source.id === STORY_ROOT_NODE_ID) return setEntryNode(current, target.data.nodeId);
      if (source.data.kind === "decision" && source.data.sourceNodeId) {
        if (connection.sourceHandle?.startsWith("choice:")) {
          return connectChoiceTarget(
            current,
            source.data.sourceNodeId,
            connection.sourceHandle.slice("choice:".length),
            target.data.nodeId
          );
        }
        if (!choiceDraftId) return current;
        return addChoiceOption(
          current,
          source.data.sourceNodeId,
          target.data.nodeId,
          authoringLocale,
          { label: pendingLabel }
        ).content;
      }
      if (target.data.kind === "ending" && target.data.endingId) {
        return convertSceneExitToEnding(current, source.data.nodeId, target.data.endingId);
      }
      if (
        (source.data.kind === "clip" || source.data.kind === "text") &&
        source.data.exitKind === "auto" &&
        connection.sourceHandle === "completion"
      ) {
        return connectSceneContinuation(current, source.data.nodeId, target.data.nodeId);
      }
      // No other source handle produces a story-flow connection in a pure
      // branching tree; leave the draft unchanged.
      return current;
    });
    if (committed && choiceDraftId && source.data.sourceNodeId) {
      removePendingChoiceDraft(source.data.sourceNodeId, choiceDraftId);
    }
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
    const sourceHandleId = connectionState.fromHandle.id ?? "";
    const dropPosition = screenToFlowPosition(clientPosition);
    const choiceDraftId =
      source.data.kind === "decision" ? choiceDraftIdFromHandle(sourceHandleId) : null;
    const createsChoice = choiceDraftId !== null;
    const pendingDraft = pendingChoiceDraftsRef.current.find(
      (draft) => draft.sourceNodeId === source.data.sourceNodeId && draft.draftId === choiceDraftId
    );
    const pendingLabel = createsChoice && pendingDraft ? pendingDraft.label.trim() : "";
    if (createsChoice && !pendingLabel) return;

    if (source.data.kind === "root" && sourceHandleId === "cast") {
      // The drag IS the tether: seat the new card so its right-edge cast port
      // lands on the release point (a fresh cast card is 310px wide with the
      // port at the mid-height of its header-only body), instead of dropping
      // the card's top-left corner under the pointer.
      createStoryElement(
        "character",
        { x: dropPosition.x - 310, y: dropPosition.y - 44 },
        { atDropPosition: true }
      );
      return;
    }

    if (
      (source.data.kind === "clip" || source.data.kind === "text") &&
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
      const created = createConnectedSceneForBlankDrop(
        content,
        source.data,
        sourceHandleId,
        authoringLocale,
        {
          sceneKind: project.format === "text_adventure" ? "text" : "clip",
          newChoiceLabel: pendingLabel || undefined,
        }
      );
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
        if (choiceDraftId && source.data.sourceNodeId) {
          removePendingChoiceDraft(source.data.sourceNodeId, choiceDraftId);
        }
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
    if (
      !source ||
      (source.data.kind !== "clip" && source.data.kind !== "text") ||
      source.data.exitKind !== "auto"
    ) {
      setPendingCompletionDrop(null);
      return;
    }

    try {
      if (kind === "choice") {
        const decisionNodeId = syntheticDecisionNodeId(source.data.nodeId);
        pendingNodePositionsRef.current.set(decisionNodeId, {
          x: pending.flowPosition.x + 18,
          y: pending.flowPosition.y - 72,
        });
        commitContent(convertSceneExitToChoice(content, source.data.nodeId, authoringLocale));
        selectCanvasNodeExclusively(decisionNodeId);
      } else {
        const created = createConnectedSceneForBlankDrop(
          content,
          source.data,
          pending.sourceHandleId,
          authoringLocale,
          { sceneKind: kind }
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

  const isValidStoryConnection = (connection: Connection | Edge): boolean => {
    if (!mutationBarrier.permits("content")) return false;
    if (!connection.source || !connection.target || connection.source === connection.target) {
      return false;
    }
    const source = model?.nodes.find((node) => node.id === connection.source);
    const target = model?.nodes.find((node) => node.id === connection.target);
    if (
      !source ||
      !target ||
      target.data.kind === "root" ||
      target.data.kind === "decision" ||
      source.data.kind === "ending"
    ) {
      return false;
    }
    // Red line: character cards tether only to the root cast anchor. Reject any
    // attempt to wire a character into the story graph, a story node into the
    // cast anchor, or the cast handles as a story-flow connection.
    if (
      rejectsStoryCastWiring({
        sourceKind: source.data.kind,
        targetKind: target.data.kind,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      })
    ) {
      return false;
    }
    if (source.data.kind === "root") {
      return (
        connection.sourceHandle === "entry" &&
        connection.targetHandle === "in" &&
        (target.data.kind === "clip" || target.data.kind === "text")
      );
    }
    if (source.data.kind === "decision") {
      return (
        (Boolean(choiceDraftIdFromHandle(connection.sourceHandle)) ||
          Boolean(connection.sourceHandle?.startsWith("choice:"))) &&
        connection.targetHandle === "in" &&
        (target.data.kind === "clip" || target.data.kind === "text")
      );
    }
    if (target.data.kind === "ending") {
      return (
        (source.data.kind === "clip" || source.data.kind === "text") &&
        source.data.exitKind === "auto" &&
        !source.data.continuationTargetNodeId &&
        connection.sourceHandle === "completion" &&
        connection.targetHandle === "ending-in"
      );
    }
    if (connection.targetHandle !== "in") return false;
    if (source.data.kind === "clip" || source.data.kind === "text") {
      return (
        source.data.exitKind === "auto" &&
        !source.data.continuationTargetNodeId &&
        connection.sourceHandle === "completion" &&
        (target.data.kind === "clip" || target.data.kind === "text")
      );
    }
    return false;
  };

  const deleteStoryElements = ({
    nodes,
    edges,
  }: {
    nodes: StoryCanvasNode[];
    edges: StoryCanvasEdge[];
  }) => {
    if (!mutationBarrier.permits("layout")) return;
    const currentSnapshot = readHistorySnapshot();
    const current = latestContentRef.current;
    if (!currentSnapshot || !current) return;
    // Deleting the Story World card is a layout-only mutation (presence flips
    // off); draft content and entry semantics are untouched.
    const deletesStoryWorld =
      storyWorldNodePresent && nodes.some((node) => node.id === STORY_ROOT_NODE_ID);

    try {
      const next = deleteStoryCanvasElements(current, { nodes, edges });
      const contentChanged = next !== current;
      if (!contentChanged && !deletesStoryWorld) return;

      history.capture(currentSnapshot);
      refreshHistoryState();
      if (contentChanged) {
        latestContentRef.current = next;
        setContent(next);
      }
      if (deletesStoryWorld) setStoryWorldNodePresentOverride(false);

      const nextStoryWorldNodePresent = deletesStoryWorld ? false : storyWorldNodePresent;
      const nextNodeIds = storyCanvasContentNodeIds(next, nextStoryWorldNodePresent);
      const deletedNodeIds = new Set(
        [...storyCanvasContentNodeIds(current, storyWorldNodePresent)].filter(
          (nodeId) => !nextNodeIds.has(nodeId)
        )
      );

      if (deletedNodeIds.size > 0) {
        const remainingPositions = Object.fromEntries(
          Object.entries(currentSnapshot.nodePositions).filter(
            ([nodeId]) => !deletedNodeIds.has(nodeId)
          )
        );
        deletedNodeIds.forEach((nodeId) => pendingNodePositionsRef.current.delete(nodeId));
        const nextLayout: StoryCanvasLayoutPayload = {
          nodePositions: remainingPositions,
          storyWorldNodePresent: nextStoryWorldNodePresent,
        };
        setLayoutSaveState("dirty");
        void persistLayoutRef.current(nextLayout);
      }
      const remainingSelectedNodeIds = latestCanvasSelectionRef.current.filter(
        (nodeId) => !deletedNodeIds.has(nodeId)
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

  const updateEnding = (
    endingId: string,
    patch: Partial<InteractiveStoryDraftContent["storyBible"]["endings"][number]>
  ) => {
    applyGraphMutation(
      (current) =>
        updateEndingNode(current, endingId, {
          ...(patch.summary
            ? {
                summary: {
                  locale: authoringLocale,
                  value: patch.summary[authoringLocale] ?? "",
                },
              }
            : {}),
          ...(patch.title
            ? { title: { locale: authoringLocale, value: patch.title[authoringLocale] ?? "" } }
            : {}),
        }),
      { mergeKey: `ending:${endingId}:${Object.keys(patch).sort().join(",")}` }
    );
  };

  const deleteCharacter = (characterId: string) => {
    if (!content || !mutationBarrier.permits("content")) return;
    // The inspector disables delete while a character is still referenced by a
    // condition/effect, so this only ever removes an unreferenced character.
    const snapshot = readHistorySnapshot();
    try {
      if (!commitContent(deleteStoryCharacter(content, characterId))) return;
      setGraphError(null);
      // Drop the removed character's orphaned cast-lane position.
      const characterNodeId = characterCanvasNodeId(characterId);
      pendingNodePositionsRef.current.delete(characterNodeId);
      if (snapshot && characterNodeId in snapshot.nodePositions) {
        const remainingPositions = Object.fromEntries(
          Object.entries(snapshot.nodePositions).filter(([nodeId]) => nodeId !== characterNodeId)
        );
        setLayoutSaveState("dirty");
        void persistLayoutRef.current({
          nodePositions: remainingPositions,
          storyWorldNodePresent,
        });
      }
      selectCanvasNodeExclusively(null);
    } catch {
      setGraphError(t("graphError.generic"));
    }
  };

  const loadLatestAfterConflict = () => {
    if (!conflict) return;
    conflictRef.current = null;
    clearSaveRetry(true);
    revisionRef.current = conflict.current.revision;
    setDraftRevision(conflict.current.revision);
    savedSignatureRef.current = canonicalJsonString(conflict.current.content);
    latestContentRef.current = conflict.current.content;
    queuedContentRef.current = null;
    recoveryContentRef.current = null;
    history.clear();
    refreshHistoryState();
    setContent(conflict.current.content);
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
      storyWorldNodePresent: layoutConflict.current.storyWorldNodePresent,
    };
    layoutConflictRef.current = null;
    recoveryLayoutRef.current = null;
    latestDesiredLayoutRef.current = latestLayout;
    clearLayoutSaveRetry(true);
    layoutRevisionRef.current = layoutConflict.current.revision;
    layoutSavedSignatureRef.current = layoutPayloadSignature(latestLayout);
    queryClient.setQueryData(layoutQueryKey, layoutConflict.current);
    setStoryWorldNodePresentOverride(layoutConflict.current.storyWorldNodePresent);
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
    setLayoutSaveState("idle");
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

  const guardBackNavigation = useCallback(
    (event: StoryCanvasNavigationEvent) => {
      requestStoryCanvasNavigation(event, () => router.push("/story-studio"));
    },
    [requestStoryCanvasNavigation, router]
  );

  const navigateToChapter = useCallback(
    (chapterId: string) => {
      if (chapterId === resolvedChapterId) return;
      requestStoryCanvasNavigation(null, () => {
        setPendingChoiceDrafts([]);
        router.push(
          `/story-studio/projects/${encodeURIComponent(projectId)}/canvas?chapter=${encodeURIComponent(chapterId)}`
        );
      });
    },
    [projectId, requestStoryCanvasNavigation, resolvedChapterId, router]
  );

  const createChapter = async (title: string): Promise<boolean> => {
    if (!workspaceId || !workbenchProjection || chapterCreatePending || !canEdit) return false;
    setChapterCreatePending(true);
    try {
      const chapter = await createStoryChapter(workspaceId, projectId, { title });
      navigateToChapter(chapter.id);
      return true;
    } catch (error) {
      toast.error(storyApiErrorMessage(error, t("chapters.createError")));
      return false;
    } finally {
      if (!disposedRef.current) setChapterCreatePending(false);
    }
  };

  const renameChapter = async (
    chapter: StoryWorkbench["chapters"][number],
    title: string
  ): Promise<boolean> => {
    if (!workspaceId || chapterMutationPendingId || !canEdit) return false;
    setChapterMutationPendingId(chapter.id);
    try {
      await updateStoryChapter(workspaceId, projectId, chapter.id, {
        title,
      });
      await refetchWorkbench();
      return true;
    } catch (error) {
      toast.error(storyApiErrorMessage(error, t("chapters.updateError")));
      return false;
    } finally {
      if (!disposedRef.current) setChapterMutationPendingId(null);
    }
  };

  const moveChapter = async (
    chapter: StoryWorkbench["chapters"][number],
    direction: -1 | 1
  ): Promise<boolean> => {
    if (!workspaceId || !workbenchProjection || chapterMutationPendingId || !canEdit) {
      return false;
    }
    const currentIndex = workbenchProjection.chapters.findIndex(
      (candidate) => candidate.id === chapter.id
    );
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= workbenchProjection.chapters.length) {
      return false;
    }
    const chapterIds = workbenchProjection.chapters.map((candidate) => candidate.id);
    [chapterIds[currentIndex], chapterIds[targetIndex]] = [
      chapterIds[targetIndex] as string,
      chapterIds[currentIndex] as string,
    ];
    setChapterMutationPendingId(chapter.id);
    try {
      await reorderStoryChapters(workspaceId, projectId, {
        expectedProjectVersion: workbenchProjection.project.projectVersion,
        chapterIds,
      });
      await refetchWorkbench();
      return true;
    } catch (error) {
      toast.error(storyApiErrorMessage(error, t("chapters.reorderError")));
      return false;
    } finally {
      if (!disposedRef.current) setChapterMutationPendingId(null);
    }
  };

  const archiveChapter = async (chapter: StoryWorkbench["chapters"][number]): Promise<boolean> => {
    if (!workspaceId || !workbenchProjection || chapterMutationPendingId || !canEdit) {
      return false;
    }
    if (chapter.id === resolvedChapterId && readLeaveRisk().blocked) {
      toast.error(t("chapters.saveBeforeArchive"));
      return false;
    }
    const nextChapter = workbenchProjection.chapters.find(
      (candidate) => candidate.id !== chapter.id
    );
    setChapterMutationPendingId(chapter.id);
    try {
      await archiveStoryChapter(workspaceId, projectId, chapter.id);
      if (chapter.id === resolvedChapterId && nextChapter) {
        router.push(
          `/story-studio/projects/${encodeURIComponent(projectId)}/canvas?chapter=${encodeURIComponent(nextChapter.id)}`
        );
      } else {
        await refetchWorkbench();
      }
      return true;
    } catch (error) {
      toast.error(storyApiErrorMessage(error, t("chapters.archiveError")));
      return false;
    } finally {
      if (!disposedRef.current) setChapterMutationPendingId(null);
    }
  };

  const exportFullCanvasRecovery = useCallback(() => {
    const risk = readLeaveRisk();
    if (!risk.blocked) {
      pendingLeaveActionRef.current = null;
      setPendingLeaveRisk(null);
      return;
    }

    const draftContent = risk.planes.includes("draft")
      ? (recoveryContentRef.current ?? inFlightContentRef.current ?? latestContentRef.current)
      : null;
    const layout = risk.planes.includes("layout")
      ? (recoveryLayoutRef.current ?? latestDesiredLayoutRef.current)
      : null;
    downloadJsonArtifact(`fizzdragon-story-canvas-recovery-${projectId}.json`, {
      artifactType: "fizzdragon.story-canvas-recovery",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      workspaceId,
      projectId,
      recoveryPlanes: risk.planes,
      draft: draftContent
        ? {
            localBaseRevision: revisionRef.current,
            canonicalRevision: conflictRef.current?.current.revision ?? null,
            content: draftContent,
          }
        : null,
      layout: layout
        ? {
            localBaseRevision: layoutRevisionRef.current,
            canonicalRevision: layoutConflictRef.current?.current.revision ?? null,
            value: layout,
          }
        : null,
    });
    setPendingLeaveRisk(risk);
    setRecoveryExported(true);
  }, [projectId, readLeaveRisk, workspaceId]);

  const discardRecoveryAndLeave = useCallback(() => {
    const resume = pendingLeaveActionRef.current;
    pendingLeaveActionRef.current = null;
    explicitDiscardAndLeaveRef.current = true;
    setPendingLeaveRisk(null);
    setRecoveryExported(false);
    resume?.();
  }, []);

  const leaveDialog = (
    <StoryCanvasLeaveDialog
      open={pendingLeaveRisk !== null}
      planes={pendingLeaveRisk?.planes ?? []}
      recoveryExported={recoveryExported}
      onStay={() => {
        pendingLeaveActionRef.current = null;
        setPendingLeaveRisk(null);
        setRecoveryExported(false);
      }}
      onExport={exportFullCanvasRecovery}
      onDiscardAndLeave={discardRecoveryAndLeave}
    />
  );

  // Full-screen surfaces are reserved for a true cold start. Canonical
  // projection refetches keep the previous snapshot mounted so the XYFlow
  // viewport and any in-flight assistant stream survive, while readiness
  // latches writes through the edit policy above.
  const projectionSurface = resolveStoryCanvasProjectionSurface(
    projectionReadiness,
    workbenchProjection !== undefined && layoutProjection !== undefined
  );
  if (workspaceLoading || projectionSurface === "loading") return <CanvasLoading />;
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
      <>
        <CanvasError
          message={storyApiErrorMessage(
            workbenchQuery.error ?? layoutQuery.error,
            commonT("errors.generic")
          )}
          onBackNavigate={guardBackNavigation}
          onRetry={() => {
            void workbenchQuery.refetch();
            void layoutQuery.refetch();
          }}
        />
        {leaveDialog}
      </>
    );
  }

  const openProductionCanvas = () => {
    if (productionCanvasSession) return;
    setProductionCanvasSession({
      projectId,
      workspaceId,
      sessionId,
      canEdit: canMutateCanvasLayout,
      canGenerate: canMutateCanvasLayout && canManageClipMedia,
    });
  };

  // Both hashes here were produced in THIS session, by one server version: the
  // publish response's and the workbench projection's. Unlike the authority
  // check below, no stored hash is involved, so the `has_audio` digest change
  // cannot reach this comparison.
  const locallyConfirmedCurrentDraftPublished = Boolean(
    (saveState === "idle" || saveState === "saved") &&
    publication.lastSucceeded?.sourceDraftRevision === draftRevision &&
    publication.lastSucceeded.build.videoSnapshotHash === video?.snapshotHash
  );
  // This one DOES compare a stored `story_builds.video_snapshot_hash` against a
  // freshly computed one. Retiring `has_audio` redefined that digest, so every
  // project published before the cutover reads as not-current until it is
  // published again — deliberately, and truthfully; the reasoning is on
  // `isExactCurrentStoryRelease`.
  const authorityConfirmedCurrentDraftPublished =
    (saveState === "idle" || saveState === "saved") &&
    isExactCurrentStoryRelease(currentReleaseQuery.data, {
      draftRevision,
      videoSnapshotHash: video?.snapshotHash ?? "",
    });
  return (
    <main className="relative h-screen min-w-[1120px] overflow-hidden bg-[oklch(0.18_0_0)] text-white">
      <StoryCanvasAssistantLayer
        projectId={projectId}
        chapterId={workbenchProjection.chapter.id}
        workspaceId={workspaceId}
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        suspended={Boolean(productionCanvasSession)}
      >
        <CanvasHeader
          title={project.title}
          canEdit={canEdit}
          previewPending={workingPreviewPending}
          publishPending={publication.isPending}
          published={
            authorityConfirmedCurrentDraftPublished ||
            (!currentReleaseQuery.data && locallyConfirmedCurrentDraftPublished)
          }
          canPublish={
            editPolicy.canPublish && publication.canPublish && !currentReleaseQuery.isLoading
          }
          publishDisabledReason={
            currentReleaseQuery.isLoading ? t("publish.statusChecking") : publication.disabledReason
          }
          onPreview={() => void openWorkingPreview()}
          onPublish={publication.open}
          onOpenMediaCreation={openProductionCanvas}
          chapterControl={
            <StoryChapterDropdown
              open={chapterDropdownOpen}
              chapters={workbenchProjection.chapters}
              activeChapterId={workbenchProjection.chapter.id}
              canEdit={canEdit}
              creating={chapterCreatePending}
              pendingChapterId={chapterMutationPendingId}
              onOpenChange={setChapterDropdownOpen}
              onSelect={navigateToChapter}
              onCreate={createChapter}
              onRename={renameChapter}
              onMove={moveChapter}
              onArchive={archiveChapter}
            />
          }
          assistantOpen={assistantOpen}
          onToggleAssistant={() => setAssistantOpen((current) => !current)}
          onBackNavigate={guardBackNavigation}
        />

        {leaveDialog}

        <StoryPublicationDialog
          state={publication.state}
          draftRevision={draftRevision}
          canMutate={editPolicy.canPublish}
          disabledReason={publication.disabledReason}
          onClose={publication.close}
          onConfirm={() => {
            if (editPolicy.canPublish) void publication.confirm();
          }}
          onRetry={() => {
            if (editPolicy.canPublish) void publication.retry();
          }}
        />

        <section
          ref={canvasSectionRef}
          // Inspectors and StoryOS are floating overlays: opening either one
          // never resizes the React Flow container or changes its viewport.
          className="absolute inset-0"
          onDoubleClick={(event) => {
            if (!mutationBarrier.permits("layout") || !isCanvasPaneTarget(event.target)) {
              return;
            }
            event.preventDefault();
            openCreatorMenuAtClientPosition({ x: event.clientX, y: event.clientY });
          }}
        >
          <StoryStudioCanvasBackdrop />
          <MediaHoverPreviewProvider>
            <StoryCanvasChoiceContext.Provider value={choiceContext}>
              <StoryCanvasFocusContext.Provider value={focusedNodeId}>
                <StoryCanvasReactFlow
                  nodes={layeredCanvasNodes}
                  edges={canvasEdges}
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
                    setInspectorTarget(storyNodeInspectorTarget(outcome.nodeId));
                  }}
                  onNodeDoubleClick={(event, node) => {
                    if (node.data.kind !== "clip") return;
                    event.preventDefault();
                    event.stopPropagation();
                    openProductionCanvas();
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
                  nodeTypes={NODE_TYPES}
                  defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
                  colorMode="dark"
                  proOptions={{ hideAttribution: true }}
                  minZoom={0.16}
                  maxZoom={1.4}
                  defaultViewport={{ x: 80, y: 160, zoom: 0.48 }}
                  nodesDraggable={canMutateCanvasLayout}
                  nodesConnectable={canMutateCanvasLayout}
                  edgesReconnectable={false}
                  edgesFocusable={canMutateCanvasLayout}
                  deleteKeyCode={canMutateCanvasLayout ? CANVAS_DELETE_KEY_CODES : null}
                  selectNodesOnDrag
                  zoomOnDoubleClick={false}
                  fitView={canvasNodes.length > 0}
                  fitViewOptions={{ padding: 0.16, maxZoom: 0.78 }}
                  className="relative z-10"
                  style={{ backgroundColor: "transparent" }}
                >
                  {model.nodes.length > 0 ? (
                    <MiniMap
                      pannable
                      position="bottom-left"
                      className={cn(
                        "canvas-wheel-zoom bottom-5! m-0! overflow-hidden rounded-[18px] bg-[oklch(0.24_0_0/0.82)]! shadow-[0_18px_60px_rgba(0,0,0,0.4)] backdrop-blur-[30px]! backdrop-saturate-150!",
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
                    onTidy={canMutateCanvasLayout ? tidyStoryCanvas : undefined}
                    className={cn(
                      "bottom-5! overflow-hidden rounded-full bg-[oklch(0.24_0_0/0.82)]! p-1! shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-[30px]! backdrop-saturate-150! [&_button]:size-9!",
                      // Clear the full-width canvas's left inspector overlay.
                      inspectorOpen ? "left-[392px]!" : "left-5!"
                    )}
                  />
                </StoryCanvasReactFlow>
              </StoryCanvasFocusContext.Provider>
            </StoryCanvasChoiceContext.Provider>
          </MediaHoverPreviewProvider>

          {canMutateCanvasLayout ? (
            <StoryNodeDock
              showStoryWorld={!storyWorldNodePresent}
              onCreate={createStoryElementFromDock}
            />
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
              showStoryWorld={!storyWorldNodePresent}
              onCreate={(kind) => createStoryElement(kind, creatorMenu.flowPosition)}
              onCancel={closeCreatorMenu}
            />
          ) : null}
        </section>

        {canMutateCanvasLayout && pendingCompletionDrop ? (
          <StoryConnectionCreator
            position={pendingCompletionDrop.clientPosition}
            onCreate={createCompletionStep}
            onCancel={() => setPendingCompletionDrop(null)}
          />
        ) : null}

        {inspectorOpen ? (
          <StoryNodeInspector
            content={content}
            format={project.format}
            locale={authoringLocale}
            selectedNode={focusedNode}
            clipMedia={
              focusedNode?.data.kind === "clip"
                ? {
                    clip: focusedClipVideo ?? null,
                    canEdit: canManageClipMedia,
                    disabledReason: clipMediaDisabledReason,
                    candidateAssets: candidateAssets.items,
                    candidateAssetsLoading: candidateAssets.loading,
                    candidateAssetsError: candidateAssets.failed
                      ? candidateAssets.error || t("inspector.media.candidateLoadError")
                      : null,
                    onRetryCandidates: () => void candidateAssets.refresh(),
                    onSelectCandidate: selectCandidateClipVideo,
                    onClearSelection: clearSelectedClipVideo,
                    onUpload: uploadSelectedClipVideo,
                  }
                : undefined
            }
            onUpdateClipMeta={(nodeId, patch) =>
              applyGraphMutation((current) => updateStoryClipMeta(current, nodeId, patch), {
                mergeKey: `clip-meta:${nodeId}:${Object.keys(patch).sort().join(",")}`,
              })
            }
            onUpdateText={(nodeId, patch) =>
              applyGraphMutation(
                (current) => updateTextNode(current, nodeId, authoringLocale, patch),
                { mergeKey: `text:${nodeId}:${Object.keys(patch).sort().join(",")}` }
              )
            }
            workspaceId={workspaceId}
            onUpdateMusic={(nodeId, music) =>
              applyGraphMutation((current) => setNodeMusic(current, nodeId, music))
            }
            showFoundation={inspectorTarget.kind === "world"}
            canEdit={canMutateCanvasLayout}
            coverMedia={{
              cover: project.cover,
              candidateAssets: candidateAssets.items,
              candidateAssetsLoading: candidateAssets.loading,
              candidateAssetsError: candidateAssets.failed
                ? candidateAssets.error || t("world.cover.candidateLoadError")
                : null,
              disabledReason: coverMediaDisabledReason,
              onRetryCandidates: () => void candidateAssets.refresh(),
              onSelectCandidate: selectProjectCover,
              onClearSelection: () => updateProjectCover(null),
              onUpload: uploadProjectCover,
            }}
            onUpdateFoundation={updateFoundation}
            onUpdateCharacter={(characterId, patch) =>
              applyGraphMutation((current) => updateStoryCharacter(current, characterId, patch), {
                mergeKey: `character:${characterId}:${Object.keys(patch).sort().join(",")}`,
              })
            }
            onDeleteCharacter={deleteCharacter}
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
            onUpdateEnding={updateEnding}
            onDeleteSelected={() => {
              if (focusedNode) void deleteElements({ nodes: [focusedNode] });
            }}
          />
        ) : null}

        {graphError ? (
          <FrostedPanel className="absolute right-5 bottom-20 z-50 flex max-w-[520px] items-center gap-3 rounded-[16px] bg-[oklch(0.24_0_0/0.9)] px-4 py-3 shadow-[0_20px_70px_rgba(0,0,0,0.48)] backdrop-blur-[30px]">
            <IconAlertTriangle className="size-4 shrink-0 text-[#ff9b9e]" />
            <p className="min-w-0 flex-1 text-xs leading-5 text-white/68">{graphError}</p>
            <button
              type="button"
              onClick={() => setGraphError(null)}
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
      </StoryCanvasAssistantLayer>
      {productionCanvasSession ? (
        <StoryProductionCanvasWorkspace
          context={productionCanvasSession}
          candidates={candidateAssets}
          onClose={closeProductionCanvasWorkspace}
        />
      ) : null}
    </main>
  );
}

function CanvasHeader({
  title,
  canEdit,
  previewPending,
  publishPending,
  published,
  canPublish,
  publishDisabledReason,
  onPreview,
  onPublish,
  onOpenMediaCreation,
  chapterControl,
  assistantOpen,
  onToggleAssistant,
  onBackNavigate,
}: {
  title: string;
  canEdit: boolean;
  previewPending: boolean;
  publishPending: boolean;
  published: boolean;
  canPublish: boolean;
  publishDisabledReason: string | null;
  onPreview: () => void;
  onPublish: () => void;
  onOpenMediaCreation: () => void;
  chapterControl: ReactNode;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  onBackNavigate: (event: StoryCanvasNavigationEvent) => void;
}) {
  const t = useTranslations("storyStudio.canvas");
  const publishButton = (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      onClick={onPublish}
      disabled={!canPublish || publishPending || published}
      className="h-9 gap-2 rounded-[14px] bg-transparent px-3 font-semibold text-white/68 hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed"
    >
      {publishPending ? (
        <IconLoader2 className="size-4 animate-spin" />
      ) : published ? (
        <IconCheck className="size-4" />
      ) : (
        <IconCloudUpload className="size-4" />
      )}
      {publishPending
        ? t("publish.actionPending")
        : published
          ? t("publish.actionPublished")
          : t("publish.action")}
    </Button>
  );
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-40 flex h-16 items-center justify-between gap-3 px-3 py-2">
      <div className="pointer-events-auto flex h-12 min-w-0 items-center gap-3">
        <Link
          href="/story-studio"
          onNavigate={onBackNavigate}
          aria-label={t("back")}
          className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/[0.07] text-white/68 transition hover:bg-white/[0.12] hover:text-white"
        >
          <IconArrowLeft className="size-5" />
        </Link>
        <h1 className="max-w-[320px] truncate text-[15px] font-semibold tracking-[-0.01em]">
          {title}
        </h1>
        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-white/[0.1]" />
        {chapterControl}
      </div>

      <div className="liquid-rim pointer-events-auto relative flex h-12 shrink-0 items-center gap-0.5 rounded-[18px] bg-white/[0.055] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.14),inset_0_-1px_0_rgba(0,0,0,0.3),0_16px_48px_-18px_rgba(0,0,0,0.68)] backdrop-blur-2xl backdrop-saturate-[1.8]">
        <button
          type="button"
          aria-pressed={assistantOpen}
          onClick={onToggleAssistant}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-[14px] px-3 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
            assistantOpen
              ? "bg-white/[0.14] text-white"
              : "bg-transparent text-white/68 hover:bg-white/[0.1] hover:text-white"
          )}
        >
          <IconSparkles className="size-4" />
          {t("assistant.action")}
        </button>
        <button
          type="button"
          onClick={onOpenMediaCreation}
          className="inline-flex h-9 items-center gap-2 rounded-[14px] bg-transparent px-3 text-xs font-semibold text-white/68 transition hover:bg-white/[0.1] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
        >
          <IconMovie className="size-4" />
          {t("mediaCreation")}
        </button>
        {/* Playtest hidden for now — the working-preview flow isn't a good fit
            yet. Re-enable by restoring this button once it's reworked. */}
        {false ? (
          <button
            type="button"
            onClick={onPreview}
            disabled={previewPending}
            className="inline-flex h-9 items-center gap-2 rounded-[14px] bg-transparent px-3 text-xs font-semibold text-white/68 transition hover:bg-white/[0.1] hover:text-white disabled:cursor-wait disabled:opacity-50"
          >
            {previewPending ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconPlayerPlay className="size-4" />
            )}
            {t("workingPreview.action")}
          </button>
        ) : null}
        {!canPublish && publishDisabledReason ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="inline-flex rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-white/55 [&>button]:pointer-events-none"
                aria-label={`${t("publish.action")}: ${publishDisabledReason}`}
              >
                {publishButton}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              {publishDisabledReason}
            </TooltipContent>
          </Tooltip>
        ) : (
          publishButton
        )}
        {!canEdit ? (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-[14px] bg-white px-3 text-[11px] font-semibold text-black">
            {t("readOnly")}
          </span>
        ) : null}
      </div>
    </header>
  );
}

function StoryPortHandle({
  id,
  type,
  position,
  color,
  label,
  isConnectable = true,
  className,
  style,
}: {
  id: string;
  type: "source" | "target";
  position: Position;
  color: string;
  label: string;
  isConnectable?: boolean;
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
      className={cn(
        "z-30! size-3.5! border-0! transition-[transform,box-shadow] duration-150 hover:scale-125!",
        className
      )}
      style={{
        backgroundColor: color,
        boxShadow: `0 0 0 3px rgba(17,17,17,0.92), 0 0 16px ${color}`,
        ...style,
      }}
    />
  );
}

function StoryGraphNodeCard({ id, data, selected, isConnectable }: NodeProps<StoryCanvasNode>) {
  const t = useTranslations("storyStudio.canvas");
  const focusedNodeId = useContext(StoryCanvasFocusContext);
  const choiceContext = useContext(StoryCanvasChoiceContext);
  const isRoot = data.kind === "root";
  const isEnding = data.kind === "ending";
  const isDecision = data.kind === "decision";
  const isCharacter = data.kind === "character";
  const decisionChoices = data.choices ?? [];
  const decisionSourceNodeId = isDecision ? data.sourceNodeId : undefined;
  const choiceDrafts = decisionSourceNodeId
    ? (choiceContext?.drafts.filter((draft) => draft.sourceNodeId === decisionSourceNodeId) ?? [])
    : [];
  const currentVideo = data.kind === "clip" ? data.clipVideo?.currentVideo : null;
  const currentVideoAsset = currentVideo?.asset;
  const coverMedia =
    isRoot && data.coverMedia?.status === "ready" && data.coverMedia.moderationStatus !== "blocked"
      ? data.coverMedia
      : null;
  const videoMetadata = storyVideoCardMetadata(currentVideo);
  const currentVideoSource: StudioVideoSource | undefined = currentVideoAsset?.previewUrl
    ? {
        src: currentVideoAsset.previewUrl,
        type: currentVideoAsset.contentType,
      }
    : undefined;
  const coverVideoSource: StudioVideoSource | undefined =
    coverMedia?.kind === "video" && coverMedia.previewUrl
      ? {
          src: coverMedia.previewUrl,
          type: coverMedia.contentType,
        }
      : undefined;
  const previewSource = currentVideoSource ?? coverVideoSource;
  const mediaPreview = useMediaHoverPreview({
    ownerId: id,
    enabled: Boolean(previewSource),
    canActivate: canActivateCanvasMediaPreview,
    canClaimManual: canClaimCanvasManualPlayback,
  });
  const previewFocused = focusedNodeId === id;
  const chipStyle =
    data.kind === "root"
      ? { background: "rgba(123,75,232,0.42)", iconBackground: "rgba(143,101,255,0.70)" }
      : data.kind === "decision"
        ? { background: "rgba(91,157,255,0.38)", iconBackground: "rgba(91,157,255,0.62)" }
        : data.kind === "ending"
          ? { background: "rgba(229,34,39,0.36)", iconBackground: "rgba(229,34,39,0.60)" }
          : isCharacter
            ? { background: "rgba(255,255,255,0.09)", iconBackground: "rgba(255,255,255,0.17)" }
            : { background: "rgba(255,255,255,0.14)", iconBackground: "rgba(255,255,255,0.22)" };
  return (
    <div className="relative pt-10" data-story-node-id={id}>
      <FrostedPanel
        rim={false}
        className={cn(
          CANVAS_NODE_DRAG_HANDLE_CLASS,
          "pointer-events-auto absolute top-0 left-0 z-10 inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.3)] backdrop-blur-xl"
        )}
        style={{ backgroundColor: chipStyle.background }}
      >
        <span
          className="grid size-6 place-items-center rounded-full"
          style={{ backgroundColor: chipStyle.iconBackground }}
        >
          {isRoot ? <IconWorld className="size-3.5" stroke={2} /> : null}
          {data.kind === "clip" ? <IconMovie className="size-3.5" stroke={2} /> : null}
          {data.kind === "text" ? <IconFileText className="size-3.5" stroke={2} /> : null}
          {isDecision ? <IconGitBranch className="size-3.5" stroke={2} /> : null}
          {isEnding ? <IconSparkles className="size-3.5" stroke={2} /> : null}
          {isCharacter ? <IconUser className="size-3.5" stroke={2} /> : null}
        </span>
        {t(`nodeKinds.${data.kind}`)}
      </FrostedPanel>
      <article
        {...mediaPreview.hoverProps}
        className={cn(
          "relative w-[310px] overflow-visible rounded-[22px] bg-[oklch(0.205_0_0/0.72)] shadow-[0_22px_70px_rgba(0,0,0,0.38)] backdrop-blur-xl backdrop-saturate-150 transition",
          isRoot && "w-[360px]",
          data.kind === "text" && "w-[330px]",
          isDecision && "w-[340px]",
          isEnding && "w-[280px]",
          isCharacter && "w-[236px]",
          selected && "bg-[oklch(0.24_0_0/0.86)] shadow-[0_28px_100px_rgba(0,0,0,0.55)]"
        )}
      >
        <GlassRim width="1px" />
        {!isRoot && !isCharacter ? (
          <StoryPortHandle
            id={isDecision ? "decision-in" : isEnding ? "ending-in" : "in"}
            type="target"
            position={Position.Left}
            isConnectable={isConnectable && !isDecision}
            color={
              isDecision
                ? STORY_PORT_COLORS.choice
                : isEnding
                  ? STORY_PORT_COLORS.ending
                  : STORY_PORT_COLORS.flow
            }
            label={isEnding ? t("ports.ending") : t("ports.input")}
            className="-left-1.75!"
          />
        ) : null}
        {isRoot ? (
          <StoryPortHandle
            id="entry"
            type="source"
            position={Position.Right}
            isConnectable={isConnectable}
            color={STORY_PORT_COLORS.entry}
            label={t("ports.entry")}
            className="-right-1.75!"
          />
        ) : null}
        {isRoot ? (
          // Dedicated LEFT cast anchor — the world membership port. It never
          // completes a story-flow connection (rejectsStoryCastWiring), but a
          // drag released on blank canvas seeds a new character in the cast lane.
          <StoryPortHandle
            id="cast"
            type="source"
            position={Position.Left}
            isConnectable={isConnectable}
            color={STORY_PORT_COLORS.cast}
            label={t("ports.cast")}
            className="-left-1.75!"
          />
        ) : null}
        {isCharacter ? (
          <StoryPortHandle
            id="cast-in"
            type="target"
            position={Position.Right}
            isConnectable={false}
            color={STORY_PORT_COLORS.cast}
            label={t("ports.cast")}
            className="-right-1.75!"
          />
        ) : null}
        {data.kind === "clip" || data.kind === "text" ? (
          <StoryPortHandle
            id="completion"
            type="source"
            position={Position.Right}
            color={
              data.exitKind === "choice"
                ? STORY_PORT_COLORS.choice
                : data.exitKind === "checkpoint"
                  ? STORY_PORT_COLORS.checkpoint
                  : data.exitKind === "ending"
                    ? STORY_PORT_COLORS.ending
                    : STORY_PORT_COLORS.flow
            }
            label={t("ports.completion")}
            isConnectable={
              isConnectable && data.exitKind === "auto" && !data.continuationTargetNodeId
            }
            className="-right-1.75!"
          />
        ) : null}
        {data.kind === "clip" ? (
          <StoryVideoPreview
            source={currentVideoSource}
            interactive={previewFocused}
            frameAspectRatio={data.frameAspectRatio}
            ariaLabel={t("production.node.videoPreview")}
            emptyLabel={t("production.node.noVideo")}
            autoPreviewActive={mediaPreview.isAutoPreviewActive}
            manualPlaybackOwned={mediaPreview.isManualPlaybackOwner}
            onManualPlaybackStart={mediaPreview.acquireManualPlayback}
            onManualPlaybackStop={mediaPreview.releaseManualPlayback}
            className="rounded-t-[22px]"
          />
        ) : null}
        {isRoot && coverMedia?.kind === "image" && coverMedia.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed project media URL
          <img
            src={coverMedia.previewUrl}
            alt={t("world.cover.imageAlt")}
            draggable={false}
            className="aspect-video w-full select-none rounded-t-[22px] object-cover"
          />
        ) : null}
        {isRoot && coverVideoSource ? (
          <StoryVideoPreview
            source={coverVideoSource}
            interactive={previewFocused}
            frameAspectRatio="16:9"
            ariaLabel={t("world.cover.videoLabel")}
            emptyLabel={t("world.cover.empty")}
            autoPreviewActive={mediaPreview.isAutoPreviewActive}
            manualPlaybackOwned={mediaPreview.isManualPlaybackOwner}
            onManualPlaybackStart={mediaPreview.acquireManualPlayback}
            onManualPlaybackStop={mediaPreview.releaseManualPlayback}
            className="rounded-t-[22px]"
          />
        ) : null}
        {isCharacter && data.characterImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- unsized user upload
          <img
            src={data.characterImageUrl}
            alt=""
            draggable={false}
            className="aspect-[3/4] w-full select-none rounded-t-[22px] object-cover"
          />
        ) : null}
        <div className="p-3">
          {data.kind === "clip" ? (
            <>
              {data.title ? (
                <h2
                  className={cn(
                    CANVAS_NODE_DRAG_HANDLE_CLASS,
                    "-mx-1 truncate rounded px-1 text-[15px] font-semibold text-white/90"
                  )}
                >
                  {data.title}
                </h2>
              ) : null}
              {videoMetadata.length > 0 ? (
                <dl className="mt-1.5 flex min-w-0 flex-wrap items-center gap-y-1 text-[10px] leading-4 text-white/42 tabular-nums">
                  {videoMetadata.map((item, index) => (
                    <div key={item.key} className="flex min-w-0 items-center">
                      {index > 0 ? (
                        <span aria-hidden className="mx-1.5 text-white/18">
                          ·
                        </span>
                      ) : null}
                      <dt className="sr-only">{t(`production.node.metadata.${item.key}`)}</dt>
                      <dd className="truncate">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </>
          ) : (
            <div
              className={cn(
                CANVAS_NODE_DRAG_HANDLE_CLASS,
                "-mx-1 flex items-start justify-between gap-3 rounded px-1"
              )}
            >
              <div className="min-w-0 flex-1">
                {isDecision && decisionSourceNodeId ? (
                  <textarea
                    rows={1}
                    value={data.title}
                    disabled={!choiceContext?.canEditContent}
                    maxLength={4_000}
                    placeholder={t("decisionCard.promptPlaceholder")}
                    aria-label={t("decisionCard.promptPlaceholder")}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      choiceContext?.updatePrompt(decisionSourceNodeId, event.target.value)
                    }
                    className="nodrag nopan nowheel field-sizing-content block max-h-20 min-h-8 w-full resize-none overflow-y-auto bg-transparent py-1 text-[16px] leading-6 font-semibold tracking-[-0.01em] text-white/90 outline-none placeholder:text-white/38 disabled:cursor-default"
                  />
                ) : (
                  <>
                    <p className="text-[10px] font-semibold tracking-[0.14em] text-white/34 uppercase">
                      {isCharacter ? t("world.characters.cardEyebrow") : data.eyebrow}
                    </p>
                    <h2
                      className={cn(
                        "mt-1 truncate text-[15px] font-semibold",
                        isCharacter && !data.title ? "text-white/40" : "text-white/90"
                      )}
                    >
                      {isCharacter ? data.title || t("world.characters.cardUntitled") : data.title}
                    </h2>
                  </>
                )}
              </div>
              <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/[0.07] text-white/58">
                {isDecision ? <IconGitBranch className="size-4" /> : null}
                {isEnding ? <IconSparkles className="size-4" /> : null}
                {isRoot ? <IconWorld className="size-4" /> : null}
                {isCharacter ? <IconUser className="size-4" /> : null}
                {data.kind === "text" ? <IconFileText className="size-4" /> : null}
              </span>
            </div>
          )}
          {data.summary ? (
            <p className="mt-3 line-clamp-3 text-[11px] leading-[18px] text-white/48">
              {data.summary}
            </p>
          ) : null}
          {data.rootStats ? (
            <div className="mt-3">
              <NodeStat label={t("metrics.characters")} value={data.rootStats.characters} />
            </div>
          ) : null}
          {isDecision ? (
            <div className="mt-3">
              {decisionChoices.length > 0 ? <div className="h-px bg-white/[0.07]" /> : null}
              {decisionChoices.map((choice, index) => (
                <div
                  key={choice.choiceId}
                  className="group/choice relative grid min-h-10 grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 px-1 py-2 pr-3 text-xs transition-colors hover:bg-white/[0.025]"
                >
                  <span className="tabular-nums text-white/24">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <input
                    value={choice.label}
                    disabled={!choiceContext?.canEditContent}
                    maxLength={4_000}
                    placeholder={t("decisionCard.untitledOption")}
                    aria-label={t("decisionCard.optionPlaceholder")}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      if (!decisionSourceNodeId) return;
                      choiceContext?.updateChoice(
                        decisionSourceNodeId,
                        choice.choiceId,
                        event.target.value
                      );
                    }}
                    className={cn(
                      "nodrag nopan nowheel w-full min-w-0 rounded-md bg-transparent px-1 py-1 outline-none transition placeholder:text-[#e0a45c]/78 hover:bg-white/[0.03] focus:bg-white/[0.05] disabled:cursor-default",
                      choice.label.trim() ? "text-white/72" : "text-[#e0a45c]/78"
                    )}
                  />
                  <span className="max-w-[112px] truncate rounded-full bg-white/[0.055] px-2 py-1 text-[9px] text-white/38 group-hover/choice:hidden group-focus-within/choice:hidden">
                    → {choice.targetTitle ?? t("decisionCard.linkedTarget")}
                  </span>
                  {choiceContext?.canEditContent && decisionSourceNodeId ? (
                    <span className="nodrag nopan hidden items-center gap-0.5 group-hover/choice:flex group-focus-within/choice:flex">
                      <button
                        type="button"
                        disabled={index === 0}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          choiceContext.moveChoice(decisionSourceNodeId, choice.choiceId, "up");
                        }}
                        className="grid size-6 place-items-center rounded-md text-white/32 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-20"
                        aria-label={t("inspector.moveChoiceUp")}
                      >
                        <IconArrowUp className="size-3" />
                      </button>
                      <button
                        type="button"
                        disabled={index === decisionChoices.length - 1}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          choiceContext.moveChoice(decisionSourceNodeId, choice.choiceId, "down");
                        }}
                        className="grid size-6 place-items-center rounded-md text-white/32 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-20"
                        aria-label={t("inspector.moveChoiceDown")}
                      >
                        <IconArrowDown className="size-3" />
                      </button>
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          choiceContext.removeChoice(decisionSourceNodeId, choice.choiceId);
                        }}
                        className="grid size-6 place-items-center rounded-md text-white/32 transition hover:bg-white/[0.08] hover:text-[#ff9b9e]"
                        aria-label={t("inspector.removeChoice")}
                      >
                        <IconTrash className="size-3" />
                      </button>
                    </span>
                  ) : null}
                  <StoryPortHandle
                    id={`choice:${choice.choiceId}`}
                    type="source"
                    position={Position.Right}
                    isConnectable={isConnectable}
                    color={STORY_PORT_COLORS.choice}
                    label={t("ports.choiceOption", {
                      label: choice.label.trim() || t("decisionCard.untitledOption"),
                    })}
                    className="-right-[23px]!"
                  />
                </div>
              ))}
              {decisionSourceNodeId
                ? choiceDrafts.map((draft, index) => (
                    <div
                      key={draft.draftId}
                      className="nodrag nopan nowheel relative mt-1 grid min-h-10 grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-white/[0.045] px-1 py-2 pr-3"
                    >
                      <span className="tabular-nums text-white/24">
                        {String(decisionChoices.length + index + 1).padStart(2, "0")}
                      </span>
                      <input
                        value={draft.label}
                        maxLength={4_000}
                        placeholder={t("decisionCard.optionPlaceholder")}
                        aria-label={t("decisionCard.optionPlaceholder")}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          choiceContext?.updateDraft(
                            decisionSourceNodeId,
                            draft.draftId,
                            event.target.value
                          )
                        }
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Escape" && !draft.required) {
                            event.preventDefault();
                            choiceContext?.cancel(decisionSourceNodeId, draft.draftId);
                          }
                        }}
                        className="h-7 w-full min-w-0 bg-transparent px-1 text-xs text-white/82 outline-none placeholder:text-white/28"
                      />
                      {!draft.required ? (
                        <button
                          type="button"
                          aria-label={t("decisionCard.cancelOption")}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            choiceContext?.cancel(decisionSourceNodeId, draft.draftId);
                          }}
                          className="grid size-6 shrink-0 place-items-center rounded-lg text-white/32 transition hover:bg-white/[0.08] hover:text-white/72"
                        >
                          <IconX className="size-3" />
                        </button>
                      ) : (
                        <span className="size-6" aria-hidden="true" />
                      )}
                      {draft.label.trim() ? (
                        <StoryPortHandle
                          id={`choice-new:${draft.draftId}`}
                          type="source"
                          position={Position.Right}
                          isConnectable={isConnectable}
                          color={STORY_PORT_COLORS.choice}
                          label={t("decisionCard.connectOption")}
                          className="-right-[23px]!"
                        />
                      ) : null}
                    </div>
                  ))
                : null}
              {decisionChoices.length + choiceDrafts.length < MAX_PLAYER_CHOICES &&
              decisionSourceNodeId &&
              choiceContext?.canCreateOption ? (
                <button
                  type="button"
                  className="nodrag nopan mt-1 flex h-10 w-full items-center gap-2 rounded-xl px-2.5 text-left text-xs font-semibold text-[#84b7ff]/78 transition hover:bg-[rgba(91,157,255,0.08)] hover:text-[#a9ceff]"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    choiceContext?.start(decisionSourceNodeId);
                  }}
                >
                  <IconPlus className="size-4" />
                  {t("decisionCard.addOption")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </article>
    </div>
  );
}

function StoryVideoPreview({
  source,
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
      className={cn("relative w-full overflow-hidden bg-black/30", className)}
      style={{ aspectRatio: frameAspectRatio === "9:16" ? "9 / 16" : "16 / 9" }}
    >
      {source ? (
        interactive ? (
          <StoryInteractiveVideoPreview
            source={source}
            ariaLabel={ariaLabel}
            autoPreviewActive={autoPreviewActive}
            manualPlaybackOwned={manualPlaybackOwned}
            onManualPlaybackStart={onManualPlaybackStart}
            onManualPlaybackStop={onManualPlaybackStop}
          />
        ) : (
          <StoryPassiveVideoPreview source={source} active={autoPreviewActive} />
        )
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 text-white/24">
          <span className="grid size-9 place-items-center rounded-full bg-white/[0.055]">
            <IconMovie className="size-4" />
          </span>
          <span className="text-[9px] font-semibold">{emptyLabel}</span>
          {/* Null-profile (text-first) projects have no frame contract — never
              advertise the film default on them. */}
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
  ariaLabel,
  autoPreviewActive,
  manualPlaybackOwned,
  onManualPlaybackStart,
  onManualPlaybackStop,
}: {
  source: StudioVideoSource;
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
  active,
}: {
  source: StudioVideoSource;
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
      muted
      draggable={false}
      playsInline
      preload="metadata"
      tabIndex={-1}
      aria-hidden="true"
      data-auto-preview={active ? "true" : undefined}
      className="pointer-events-none size-full object-cover select-none"
    />
  );
}

function NodeStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/[0.045] px-2 py-2">
      <p className="truncate text-[8px] font-semibold text-white/30">{label}</p>
      <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-white/68">{value}</p>
    </div>
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
    <main className="grid h-screen place-items-center bg-[oklch(0.105_0_0)] text-white">
      <div className="flex items-center gap-3 text-sm text-white/54">
        <IconLoader2 className="size-5 animate-spin" />
        {t("loading")}
      </div>
    </main>
  );
}

function CanvasError({
  message,
  onBackNavigate,
  onRetry,
}: {
  message: string;
  onBackNavigate: (event: StoryCanvasNavigationEvent) => void;
  onRetry: () => void;
}) {
  const t = useTranslations("storyStudio.canvas");
  return (
    <main className="grid h-screen place-items-center bg-[oklch(0.105_0_0)] px-6 text-white">
      <FrostedPanel className="w-full max-w-md rounded-[28px] bg-[oklch(0.205_0_0/0.72)] p-7 text-center shadow-[0_26px_100px_rgba(0,0,0,0.52)] backdrop-blur-[60px]">
        <IconAlertTriangle className="mx-auto size-6 text-[#ff9b9e]" />
        <h1 className="mt-4 text-base font-semibold">{t("error.title")}</h1>
        <p className="mt-2 text-xs leading-5 text-white/44">{message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/story-studio" onNavigate={onBackNavigate}>
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
    </main>
  );
}

// Cast-lane geometry mirrors the model's auto-layout: characters stack in a
// dedicated column to the LEFT of the Story World root, clear of the story-flow
// lane on the right.
const CAST_LANE_COLUMN_GAP = 480;
const CAST_LANE_ROW_GAP = 150;

function nextCastLanePosition(nodes: readonly StoryCanvasNode[]): StoryCanvasPosition {
  const rootPosition = nodes.find((node) => node.id === STORY_ROOT_NODE_ID)?.position ?? {
    x: 0,
    y: 0,
  };
  const existingCharacters = nodes.filter((node) => node.data.kind === "character").length;
  return {
    x: rootPosition.x - CAST_LANE_COLUMN_GAP,
    y: rootPosition.y + existingCharacters * CAST_LANE_ROW_GAP,
  };
}

function nodePositions(nodes: StoryCanvasNode[]): Record<string, StoryCanvasPosition> {
  return Object.fromEntries(
    [...nodes]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) => [node.id, { x: node.position.x, y: node.position.y }])
  );
}

function canvasLayoutPayload(
  nodes: readonly StoryCanvasNode[],
  storyWorldNodePresent: boolean
): StoryCanvasLayoutPayload {
  return {
    nodePositions: nodePositions(
      storyWorldNodePresent ? [...nodes] : nodes.filter((node) => node.id !== STORY_ROOT_NODE_ID)
    ),
    storyWorldNodePresent,
  };
}

function historyNodePositions(
  content: InteractiveStoryDraftContent,
  nodes: readonly StoryCanvasNode[],
  pending: ReadonlyMap<string, StoryCanvasPosition>,
  storyWorldNodePresent: boolean
): Record<string, StoryCanvasPosition> {
  const contentNodeIds = storyCanvasContentNodeIds(content, storyWorldNodePresent);

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

function storyCanvasContentNodeIds(
  content: InteractiveStoryDraftContent,
  storyWorldNodePresent: boolean
): Set<string> {
  const nodeIds = new Set<string>();
  if (storyWorldNodePresent) nodeIds.add(STORY_ROOT_NODE_ID);
  content.graph.nodes.forEach((node) => {
    nodeIds.add(node.nodeId);
    if (node.exit.kind === "choice") {
      nodeIds.add(syntheticDecisionNodeId(node.nodeId));
    }
  });
  content.storyBible.endings.forEach((ending) => {
    nodeIds.add(syntheticEndingNodeId(ending.id));
  });
  // Character cards persist their layout under `character:` keys. Including them
  // here keeps their positions in history snapshots and drops a deleted
  // character's orphaned position alongside the story-graph nodes.
  content.storyBible.characters.forEach((character) => {
    nodeIds.add(characterCanvasNodeId(character.id));
  });
  return nodeIds;
}

function reconcilePendingChoiceDrafts(
  current: PendingChoiceDraft[],
  requirements: Array<{ sourceNodeId: string; choiceCount: number }>,
  createRequiredDraft: (sourceNodeId: string, index: number) => PendingChoiceDraft
): PendingChoiceDraft[] {
  const next: PendingChoiceDraft[] = [];

  requirements.forEach(({ sourceNodeId, choiceCount }) => {
    const capacity = Math.max(0, MAX_PLAYER_CHOICES - choiceCount);
    const requiredCount = Math.min(capacity, Math.max(0, MIN_PLAYER_CHOICES - choiceCount));
    const sourceDrafts = current.filter((draft) => draft.sourceNodeId === sourceNodeId);

    while (sourceDrafts.length > capacity) {
      const emptyIndex = sourceDrafts.findLastIndex((draft) => !draft.label.trim());
      sourceDrafts.splice(emptyIndex >= 0 ? emptyIndex : sourceDrafts.length - 1, 1);
    }
    while (sourceDrafts.length < requiredCount) {
      sourceDrafts.push(createRequiredDraft(sourceNodeId, sourceDrafts.length));
    }

    sourceDrafts.forEach((draft, index) => {
      const required = index < requiredCount;
      next.push(draft.required === required ? draft : { ...draft, required });
    });
  });

  return next.length === current.length && next.every((draft, index) => draft === current[index])
    ? current
    : next;
}

function choiceDraftIdFromHandle(handleId: string | null | undefined): string | null {
  const match = handleId?.match(/^choice-new:(.+)$/u);
  return match?.[1] ?? null;
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
