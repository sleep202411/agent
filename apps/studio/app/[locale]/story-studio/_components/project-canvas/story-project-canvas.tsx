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
  IconChevronDown,
  IconCloudUpload,
  IconDownload,
  IconFocusCentered,
  IconLoader2,
  IconMovie,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { WorldModelWorld } from "@repo/shared/world-model-protocol";
import { ShareDialog } from "@/app/_components/share-dialog";
import { useWorkspace } from "@/app/_components/workspace-context";
import { AgentOsPanel } from "@/components/agent-os/agent-os-panel";
import { Button } from "@/components/ui/button";
import { CanvasControls } from "@/components/canvas/canvas-controls";
import { CanvasHistoryControls } from "@/components/canvas/canvas-history-controls";
import { useCanvasTidy } from "@/components/canvas/use-canvas-tidy";
import type { CanvasTidyLayoutOptions } from "@/components/canvas/canvas-tidy-layout";
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
import { WorldModelExperienceRenderer } from "@/components/experience-runtime/world-model-experience-renderer";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { GlassRim } from "@/components/ui/glass-rim";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useRouter } from "@/i18n/navigation";
import { canonicalJsonString } from "@/lib/canonical-json";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import { cn } from "@/lib/utils";
import { listWorlds, worldModelQueryKeys } from "@/lib/world-model-api";
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
  type StoryClipGraphNode,
  type StoryGraphNode,
  type StoryInteractionAction,
  type StoryInteractionOutcomes,
  type StoryInteractionTrigger,
  type StoryWorldGraphNode,
  type StoryWorkbench,
} from "@/lib/story-projects-api";
import {
  buildStoryCanvasModel,
  estimateStoryNodeHeight,
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
  STORY_FOUNDATION_INSPECTOR,
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
import { shouldAdoptAuthoritativeStoryDraft } from "./story-canvas-draft-reconcile";
import { StoryCanvasSidebar } from "./story-canvas-sidebar";
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
  convertExitToAuto,
  convertSceneExitToChoice,
  createClipNode,
  createWorldNode,
  moveChoiceOption,
  removeChoiceOption,
  replaceStoryNodeInteractions,
  updateStoryClipMeta,
  updateStoryWorldNode,
  updateChoiceExitPrompt,
  updateChoiceOptionLabel,
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
import { useStoryCandidateAssets } from "./use-story-candidate-assets";
import { StoryNodeInspector, type SceneExitIntent } from "./story-node-inspector";
import { StoryWorldBindingControl, StoryWorldNodeEditor } from "./story-world-node-editor";
import { StoryInteractionEditor } from "./story-interaction-editor";
import { migrateLegacyStoryHotspotIds } from "./story-interaction-ids";
import type {
  StoryInteractionActionDraft,
  StoryInteractionDraft,
  StoryInteractionOutcomesDraft,
  StoryInteractionTriggerDraft,
} from "./story-interaction-types";
import {
  applyActiveStoryCanvasCapabilities,
  STORY_WORLD_EXPERIENCE_AVAILABLE,
} from "./story-world-feature-policy";
import { StoryPublicationDialog } from "./story-publication-dialog";
import { StoryDraftSnapshotCoordinator } from "./story-draft-snapshot-coordinator";
import { projectConfirmedClipCurrentVideo } from "./story-workbench-current-video";
import { useStoryPublication } from "./use-story-publication";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
type FoundationField = "logline" | "synopsis";
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
type StoryCanvasWorldContextValue = {
  projectId: string;
  worlds: WorldModelWorld[];
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  canGenerate: boolean;
  candidateAssets: StoryCandidateAsset[];
  candidateAssetsLoading: boolean;
  candidateAssetsError: string | null;
  node: (nodeId: string) => StoryWorldGraphNode | null;
  retry: () => void;
  retryCandidateAssets: () => void;
  uploadCandidateAsset: (
    file: File,
    onState: (state: StoryCandidateAssetUploadState) => void,
    signal: AbortSignal
  ) => Promise<StoryCandidateAsset>;
  update: (
    nodeId: string,
    patch: Partial<
      Pick<StoryWorldGraphNode, "worldId" | "entryInstruction" | "maxExperienceSeconds">
    >
  ) => void;
  run: (nodeId: string, worldId: string) => void;
};
type StoryWorldRunState = {
  worldId: string;
  entryInstruction?: string;
  maxExperienceSeconds: 60 | 90 | 120;
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
  ending: "#E52227",
} as const;
const STORY_CANVAS_TIDY_LAYOUT = {
  lanes: [],
} satisfies CanvasTidyLayoutOptions<StoryCanvasNode>;
const MIN_PLAYER_CHOICES = 2;
const MAX_PLAYER_CHOICES = 6;

const StoryCanvasFocusContext = createContext<string | null>(null);
const StoryCanvasChoiceContext = createContext<StoryCanvasChoiceContextValue | null>(null);
const StoryCanvasWorldContext = createContext<StoryCanvasWorldContextValue | null>(null);

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
  const agentT = useTranslations("agentOs");
  const router = useRouter();
  const { fitView, screenToFlowPosition } = useReactFlow<StoryCanvasNode, StoryCanvasEdge>();
  const queryClient = useQueryClient();
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const [content, setContent] = useState<InteractiveStoryDraftContent | null>(null);
  const [contentChapterId, setContentChapterId] = useState<string | null>(null);
  const [inspectorTarget, setInspectorTarget] = useState<StoryCanvasInspectorTarget>(
    CLOSED_STORY_CANVAS_INSPECTOR
  );
  const [shareOpen, setShareOpen] = useState(false);
  const [chapterDropdownOpen, setChapterDropdownOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [worldRun, setWorldRun] = useState<StoryWorldRunState | null>(null);
  const [interactionEditorNodeId, setInteractionEditorNodeId] = useState<string | null>(null);
  const [chapterCreatePending, setChapterCreatePending] = useState(false);
  const [chapterMutationPendingId, setChapterMutationPendingId] = useState<string | null>(null);
  const [mutationBarrier] = useState(() => createStoryCanvasMutationBarrier());
  const focusedNodeId = storyCanvasInspectorNodeId(inspectorTarget);
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
  const authoringLocale = project?.defaultLocale ?? "en-US";
  const worldsQuery = useQuery({
    queryKey: worldModelQueryKeys.worlds(projectId),
    queryFn: () => listWorlds(projectId),
    enabled: Boolean(workspaceId) && STORY_WORLD_EXPERIENCE_AVAILABLE,
    staleTime: 10_000,
    refetchInterval: (query) =>
      query.state.data?.some((world) => world.status === "generating") ? 3_000 : false,
  });

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
      setPendingChoiceDrafts([]);
    }
    hydratedRef.current = true;
    hydratedChapterIdRef.current = workbench.chapter.id;
    revisionRef.current = workbench.draft.revision;
    setDraftRevision(workbench.draft.revision);
    const adoptedContent = applyActiveStoryCanvasCapabilities(
      migrateLegacyStoryHotspotIds(workbench.draft.content)
    );
    savedSignatureRef.current = canonicalJsonString(workbench.draft.content);
    latestContentRef.current = adoptedContent;
    history.clear();
    setHistoryVersion((current) => current + 1);
    setContentChapterId(workbench.chapter.id);
    setContent(adoptedContent);
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
    clip: t("projection.clip"),
    world: t("projection.world"),
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
            STORY_WORLD_EXPERIENCE_AVAILABLE ? (worldsQuery.data ?? []) : []
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
      projectionCopy.clip,
      projectionCopy.world,
      worldsQuery.data,
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
  const canEdit = editPolicy.canEditContent;
  const canMutateCanvasLayout = editPolicy.canEditLayout;
  const choiceDraftRequirements = useMemo(
    () =>
      model?.nodes.flatMap((node) =>
        node.data.kind === "clip" && node.data.exitKind === "choice"
          ? [
              {
                sourceNodeId: node.data.nodeId,
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
      label: t("interactionCard.defaultOption", {
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
          label: t("interactionCard.defaultOption", {
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
    // A cover is always a still, so this is always the verified-image upload
    // path — the one that probes and records the checksum and pixel dimensions
    // that a runtime image asset cannot be published without.
    const uploaded = await uploadFileViaSignedUrl(file, {
      kind: "ai_reference_image",
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
  const uploadWorldOpeningFrame = async (
    file: File,
    onState: (state: StoryCandidateAssetUploadState) => void,
    signal: AbortSignal
  ): Promise<StoryCandidateAsset> => {
    if (!workspaceId || !canMutateCanvasLayout) {
      throw new Error(t("production.errors.action"));
    }
    const uploaded = await uploadFileViaSignedUrl(file, {
      kind: "ai_reference_image",
      workspaceId,
      onProgress: (progress) => onState({ stage: "uploading", progress }),
      signal,
    });
    if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
    onState({ stage: "processing" });
    const candidate = await addStoryCandidateAsset(workspaceId, projectId, uploaded.mediaAssetId);
    await candidateAssets.refresh();
    if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
    return candidate;
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
      setInspectorTarget(CLOSED_STORY_CANVAS_INSPECTOR);
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
      const initialLayout = canvasLayoutPayload(initialNodes);
      layoutHydratedRef.current = true;
      layoutRevisionRef.current = layoutProjection.revision;
      latestDesiredLayoutRef.current = initialLayout;
      layoutSavedSignatureRef.current = layoutPayloadSignature(initialLayout);
      canvasNodesRef.current = initialNodes;
      setCanvasNodes(initialNodes);
      reconcileFocusAfterModel(initialNodes);
      return;
    }
    if (shouldAdoptAuthoritativeLayout) {
      layoutRevisionRef.current = layoutProjection.revision;
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
      const adoptedLayout = canvasLayoutPayload(nextNodes);
      latestDesiredLayoutRef.current = adoptedLayout;
      layoutSavedSignatureRef.current = layoutPayloadSignature(adoptedLayout);
    }
    if (placedNodeIds.length > 0) {
      const nextLayout = canvasLayoutPayload(nextNodes);
      void persistLayoutRef.current(nextLayout);
    }
  }, [contentChapterId, history, layoutProjection, model, setCanvasNodes, workbenchProjection]);

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
        const saved = await putStoryCanvasLayout(workspaceId, projectId, resolvedChapterId, {
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
          const chapterQuery = resolvedChapterId
            ? `?chapter=${encodeURIComponent(resolvedChapterId)}`
            : "";
          router.push(
            `/story-studio/projects/${encodeURIComponent(projectId)}/playtest${chapterQuery}`
          );
        });
      });
    } catch (error) {
      if (!disposedRef.current)
        toast.error(storyApiErrorMessage(error, t("workingPreview.errorFallback")));
    } finally {
      if (!disposedRef.current) setWorkingPreviewPending(false);
    }
  }, [
    resolvedChapterId,
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
        });
        recoveryLayoutRef.current = null;
        clearLayoutSaveRetry(true);
        queryClient.setQueryData(layoutQueryKey, saved);
        return true;
      };

      void putStoryCanvasLayout(
        workspaceId,
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
  const inspectorOpen = inspectorTarget.kind === "foundation" || focusedNode?.data.kind === "clip";
  const focusedClipVideo =
    focusedNode?.data.kind === "clip" ? (focusedNode.data.clipVideo ?? null) : null;
  const focusedGraphNodeId = focusedNode?.data.kind === "clip" ? focusedNode.data.nodeId : null;
  const interactionEditorNode =
    content?.graph.nodes.find(
      (node): node is StoryClipGraphNode =>
        node.nodeId === interactionEditorNodeId && node.kind === "clip"
    ) ?? null;
  const interactionEditorClip =
    video?.clips.find((clip) => clip.graphNodeId === interactionEditorNodeId) ?? null;
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
  const layeredCanvasNodes = useMemo(
    () =>
      canvasNodes.map((node) => {
        const zIndex = node.id === focusedNodeId ? 100 : 0;
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
          pendingNodePositionsRef.current
        ),
      };
    },
    []
  );

  /**
   * The single persistence path for every layout move — dragging and tidying
   * alike — so the edit barrier, the undo snapshot and the no-op signature check
   * can never drift apart between them.
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

  // Tidy reaches the store through the same commit path as a drag: positions land
  // in the projection via `onCanvasNodesChange` (which the barrier already
  // filters) and are persisted here, so a tidy survives a reload.
  const tidyStoryCanvas = useCanvasTidy<StoryCanvasNode, StoryCanvasEdge>({
    estimateHeight: (node) => estimateStoryNodeHeight((node as StoryCanvasNode).data),
    edges: canvasEdges,
    layoutOptions: STORY_CANVAS_TIDY_LAYOUT,
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
      };
      const layoutChanged =
        !currentSnapshot ||
        layoutPayloadSignature({
          nodePositions: currentSnapshot.nodePositions,
        }) !== layoutPayloadSignature(nextLayout);

      const restoredContent = applyActiveStoryCanvasCapabilities(
        migrateLegacyStoryHotspotIds(snapshot.content)
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
    const normalizedNext = applyActiveStoryCanvasCapabilities(migrateLegacyStoryHotspotIds(next));
    if (normalizedNext === current) return false;
    const snapshot = readHistorySnapshot(current);
    if (!snapshot) return false;
    history.capture(snapshot, { mergeKey: options.mergeKey });
    refreshHistoryState();
    latestContentRef.current = normalizedNext;
    setContent(normalizedNext);
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
        pendingNodePositionsRef.current
      ),
    };
    void persistLayoutRef.current(nextLayout);
  };

  const createStoryElement = (kind: StoryNodeCreationKind, position: StoryCanvasPosition) => {
    if (!content || !mutationBarrier.permits("layout")) return;
    if (kind === "world" && !STORY_WORLD_EXPERIENCE_AVAILABLE) return;
    try {
      const result = kind === "world" ? createWorldNode(content) : createClipNode(content);
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
    if (!source || !target) {
      return;
    }
    const choiceDraftId =
      source.data.kind === "clip" && source.data.exitKind === "choice"
        ? choiceDraftIdFromHandle(connection.sourceHandle)
        : null;
    const createsChoice = choiceDraftId !== null;
    const pendingDraft = pendingChoiceDraftsRef.current.find(
      (draft) => draft.sourceNodeId === source.data.nodeId && draft.draftId === choiceDraftId
    );
    const pendingLabel = createsChoice && pendingDraft ? pendingDraft.label.trim() : "";
    if (createsChoice && !pendingLabel) return;
    const committed = applyGraphMutation((current) => {
      if (source.data.exitKind === "choice") {
        if (connection.sourceHandle?.startsWith("choice:")) {
          return connectChoiceTarget(
            current,
            source.data.nodeId,
            connection.sourceHandle.slice("choice:".length),
            target.data.nodeId
          );
        }
        if (!choiceDraftId) return current;
        return addChoiceOption(current, source.data.nodeId, target.data.nodeId, authoringLocale, {
          label: pendingLabel,
        }).content;
      }
      if (source.data.exitKind === "auto" && connection.sourceHandle === "completion") {
        return connectSceneContinuation(current, source.data.nodeId, target.data.nodeId);
      }
      // No other source handle produces a story-flow connection in a pure
      // branching tree; leave the draft unchanged.
      return current;
    });
    if (committed && choiceDraftId) {
      removePendingChoiceDraft(source.data.nodeId, choiceDraftId);
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
    if (!source || source.data.kind !== "clip" || !clientPosition) return;
    const sourceHandleId = connectionState.fromHandle.id ?? "";
    const dropPosition = screenToFlowPosition(clientPosition);
    const choiceDraftId =
      source.data.exitKind === "choice" ? choiceDraftIdFromHandle(sourceHandleId) : null;
    const createsChoice = choiceDraftId !== null;
    const pendingDraft = pendingChoiceDraftsRef.current.find(
      (draft) => draft.sourceNodeId === source.data.nodeId && draft.draftId === choiceDraftId
    );
    const pendingLabel = createsChoice && pendingDraft ? pendingDraft.label.trim() : "";
    if (createsChoice && !pendingLabel) return;

    if (source.data.exitKind === "auto" && sourceHandleId === "completion") {
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
        { newChoiceLabel: pendingLabel || undefined }
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
        if (choiceDraftId) {
          removePendingChoiceDraft(source.data.nodeId, choiceDraftId);
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
    if (!source || source.data.kind !== "clip" || source.data.exitKind !== "auto") {
      setPendingCompletionDrop(null);
      return;
    }

    try {
      if (kind === "choice") {
        commitContent(convertSceneExitToChoice(content, source.data.nodeId, authoringLocale));
        selectCanvasNodeExclusively(source.data.nodeId);
      } else {
        const created = createConnectedSceneForBlankDrop(
          content,
          source.data,
          pending.sourceHandleId,
          authoringLocale,
          {}
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

  /**
   * Realizes an inspector exit intent. Each kind is one mutation except `auto`
   * with a target: the conversion clears the continuation by design, so the
   * target has to be re-applied in the same commit or the scene would be left
   * dead-ended.
   */
  const setSceneExit = (nodeId: string, intent: SceneExitIntent) => {
    if (intent.kind === "choice") {
      if (
        applyGraphMutation((current) => convertSceneExitToChoice(current, nodeId, authoringLocale))
      ) {
        selectCanvasNodeExclusively(nodeId);
      }
      return;
    }
    applyGraphMutation((current) => {
      const asAuto = convertExitToAuto(current, nodeId);
      return intent.nextNodeId
        ? connectSceneContinuation(asAuto, nodeId, intent.nextNodeId)
        : asAuto;
    });
  };

  const isValidStoryConnection = (connection: Connection | Edge): boolean => {
    if (!mutationBarrier.permits("content")) return false;
    if (!connection.source || !connection.target || connection.source === connection.target) {
      return false;
    }
    const source = model?.nodes.find((node) => node.id === connection.source);
    const target = model?.nodes.find((node) => node.id === connection.target);
    if (!source || !target) {
      return false;
    }
    if (source.data.kind === "clip" && source.data.exitKind === "choice") {
      return (
        (Boolean(choiceDraftIdFromHandle(connection.sourceHandle)) ||
          Boolean(connection.sourceHandle?.startsWith("choice:"))) &&
        connection.targetHandle === "in"
      );
    }
    if (connection.targetHandle !== "in") return false;
    return (
      source.data.exitKind === "auto" &&
      !source.data.continuationTargetNodeId &&
      connection.sourceHandle === "completion"
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

      if (deletedNodeIds.size > 0) {
        const remainingPositions = Object.fromEntries(
          Object.entries(currentSnapshot.nodePositions).filter(
            ([nodeId]) => !deletedNodeIds.has(nodeId)
          )
        );
        deletedNodeIds.forEach((nodeId) => pendingNodePositionsRef.current.delete(nodeId));
        const nextLayout: StoryCanvasLayoutPayload = {
          nodePositions: remainingPositions,
        };
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

  const loadLatestAfterConflict = () => {
    if (!conflict) return;
    conflictRef.current = null;
    clearSaveRetry(true);
    revisionRef.current = conflict.current.revision;
    setDraftRevision(conflict.current.revision);
    savedSignatureRef.current = canonicalJsonString(conflict.current.content);
    const activeContent = applyActiveStoryCanvasCapabilities(
      migrateLegacyStoryHotspotIds(conflict.current.content)
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

  const openProductionCanvas = (focusNodeId?: string) => {
    router.push(
      `/story-studio/projects/${projectId}/workbench/canvas${
        focusNodeId ? `?focus=${encodeURIComponent(focusNodeId)}` : ""
      }`
    );
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
  const refreshAfterAgentMutation = async () => {
    await Promise.all([workbenchQuery.refetch(), layoutQuery.refetch()]);
  };
  const worldContext: StoryCanvasWorldContextValue = {
    projectId,
    worlds: worldsQuery.data ?? [],
    loading: worldsQuery.isLoading,
    error: worldsQuery.isError
      ? storyApiErrorMessage(worldsQuery.error, commonT("errors.generic"))
      : null,
    canEdit: canMutateCanvasLayout,
    canGenerate: editPolicy.canManageProduction,
    candidateAssets: candidateAssets.items,
    candidateAssetsLoading: candidateAssets.loading,
    candidateAssetsError: candidateAssets.failed
      ? candidateAssets.error || t("worldNode.firstFrameCandidateLoadError")
      : null,
    node: (nodeId) => {
      const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
      return node?.kind === "world" ? node : null;
    },
    retry: () => void worldsQuery.refetch(),
    retryCandidateAssets: () => void candidateAssets.refresh(),
    uploadCandidateAsset: uploadWorldOpeningFrame,
    update: (nodeId, patch) =>
      applyGraphMutation((current) => updateStoryWorldNode(current, nodeId, patch), {
        mergeKey: `world-node:${nodeId}:${Object.keys(patch).sort().join(",")}`,
      }),
    run: (nodeId, worldId) => {
      const node = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
      if (node?.kind !== "world") return;
      const entryInstruction = node.entryInstruction?.trim();
      setWorldRun({
        worldId,
        entryInstruction: entryInstruction || undefined,
        maxExperienceSeconds: node.maxExperienceSeconds,
      });
    },
  };
  return (
    <main className="flex h-screen min-w-[1120px] overflow-hidden bg-[var(--canvas-background)] text-white">
      <StoryCanvasSidebar
        agentLabel={agentT("title")}
        agentOpen={agentOpen}
        foundationOpen={inspectorTarget.kind === "foundation"}
        chapterDropdown={{
          open: chapterDropdownOpen,
          chapters: workbenchProjection.chapters,
          activeChapterId: workbenchProjection.chapter.id,
          canEdit,
          creating: chapterCreatePending,
          pendingChapterId: chapterMutationPendingId,
          onOpenChange: (open) => {
            setChapterDropdownOpen(open);
            if (open) {
              setAgentOpen(false);
              setInspectorTarget(CLOSED_STORY_CANVAS_INSPECTOR);
            }
          },
          onSelect: navigateToChapter,
          onCreate: createChapter,
          onRename: renameChapter,
          onMove: moveChapter,
          onArchive: archiveChapter,
        }}
        onBackNavigate={guardBackNavigation}
        onOpenMediaCreation={() => openProductionCanvas()}
        onShare={() => setShareOpen(true)}
        onToggleAgent={() => {
          setChapterDropdownOpen(false);
          setAgentOpen((current) => !current);
        }}
        onToggleFoundation={() => {
          setChapterDropdownOpen(false);
          setInspectorTarget((current) =>
            current.kind === "foundation"
              ? CLOSED_STORY_CANVAS_INSPECTOR
              : STORY_FOUNDATION_INSPECTOR
          );
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <CanvasHeader
          projectId={projectId}
          title={project.title}
          chapterTitle={workbenchProjection.chapter.title}
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
        />
        <div className="relative min-w-0 flex-1">
          {worldRun ? (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t("worldNode.run")}
              className="fixed inset-0 z-[200] bg-black"
            >
              <WorldModelExperienceRenderer
                config={{
                  projectId,
                  worldId: worldRun.worldId,
                  entryInstruction: worldRun.entryInstruction,
                  maxExperienceSeconds: worldRun.maxExperienceSeconds,
                  autoplay: true,
                }}
                active
                onCompleted={() => setWorldRun(null)}
                onError={(error) => {
                  toast.error(storyApiErrorMessage(error, t("worldNode.runError")));
                  setWorldRun(null);
                }}
              />
              <button
                type="button"
                aria-label={t("worldNode.exitRun")}
                title={t("worldNode.exitRun")}
                onClick={() => setWorldRun(null)}
                className="absolute top-5 right-5 grid size-11 place-items-center rounded-full border border-white/12 bg-black/55 text-white/78 backdrop-blur-xl transition hover:bg-white/14 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <IconX className="size-5" />
              </button>
            </div>
          ) : null}

          <ShareDialog
            scope={{ kind: "story-project", id: projectId, name: project.title }}
            canManage={project.capabilities.includes("story.admin")}
            open={shareOpen}
            onOpenChange={setShareOpen}
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
                <StoryCanvasWorldContext.Provider value={worldContext}>
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
                        openProductionCanvas(node.id);
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
                </StoryCanvasWorldContext.Provider>
              </StoryCanvasChoiceContext.Provider>
            </MediaHoverPreviewProvider>

            {canMutateCanvasLayout ? <StoryNodeDock onCreate={createStoryElementFromDock} /> : null}

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
              onCreate={createCompletionStep}
              onCancel={() => setPendingCompletionDrop(null)}
            />
          ) : null}

          {inspectorOpen ? (
            <StoryNodeInspector
              content={content}
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
              showFoundation={inspectorTarget.kind === "foundation"}
              canEdit={canMutateCanvasLayout}
              coverMedia={{
                cover: project.cover,
                candidateAssets: candidateAssets.items,
                candidateAssetsLoading: candidateAssets.loading,
                candidateAssetsError: candidateAssets.failed
                  ? candidateAssets.error || t("filmFoundation.cover.candidateLoadError")
                  : null,
                disabledReason: coverMediaDisabledReason,
                onRetryCandidates: () => void candidateAssets.refresh(),
                onSelectCandidate: selectProjectCover,
                onClearSelection: () => updateProjectCover(null),
                onUpload: uploadProjectCover,
              }}
              onUpdateFoundation={updateFoundation}
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
              onSetSceneExit={setSceneExit}
              onEditInteractions={setInteractionEditorNodeId}
              onDeleteSelected={() => {
                if (focusedNode) deleteStoryElements({ nodes: [focusedNode], edges: [] });
              }}
            />
          ) : null}

          {interactionEditorNode ? (
            <StoryInteractionEditor
              node={interactionEditorNode}
              nodes={content.graph.nodes}
              clip={interactionEditorClip}
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
        </div>
      </div>
      <AgentOsPanel
        projectId={projectId}
        projectKind="story"
        workbenchMode="story"
        workbenchContext={{ chapterId: workbenchProjection.chapter.id }}
        onMutationCompleted={refreshAfterAgentMutation}
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
      />
    </main>
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
  if (action.kind === "goto") return { kind: "goto", nodeId: action.targetNodeId };
  if (action.kind === "seek") {
    return { kind: "seek", timeMs: Math.round(action.timeSeconds * 1_000) };
  }
  return { kind: "continue" };
}

function storyInteractionActionDraft(action: StoryInteractionAction): StoryInteractionActionDraft {
  if (action.kind === "goto") return { kind: "goto", targetNodeId: action.nodeId };
  if (action.kind === "seek") return { kind: "seek", timeSeconds: action.timeMs / 1_000 };
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

/**
 * Toolbar label visibility. Below this container width the full-label pill
 * overflows the header row, so labels collapse to sr-only and the buttons run
 * icon-only. Applies to the canvas-header preview and publish actions.
 */
const HEADER_LABEL_CLASS = "@max-[1000px]:sr-only";

function CanvasHeader({
  projectId,
  title,
  chapterTitle,
  canEdit,
  previewPending,
  publishPending,
  published,
  canPublish,
  publishDisabledReason,
  onPreview,
  onPublish,
}: {
  projectId: string;
  title: string;
  chapterTitle: string;
  canEdit: boolean;
  previewPending: boolean;
  publishPending: boolean;
  published: boolean;
  canPublish: boolean;
  publishDisabledReason: string | null;
  onPreview: () => void;
  onPublish: () => void;
}) {
  const t = useTranslations("storyStudio.canvas");
  const stagesT = useTranslations("storyStudio.canvas.steps");
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
      <span className={HEADER_LABEL_CLASS}>
        {publishPending
          ? t("publish.actionPending")
          : published
            ? t("publish.actionPublished")
            : t("publish.action")}
      </span>
    </Button>
  );
  return (
    // Occupying top bar (the canvas region starts below it), monochrome solid
    // background + hairline divider per DESIGN.md. `@container`: toolbar labels
    // collapse to icon-only when space is tight.
    <header className="@container relative z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/8 bg-[oklch(0.185_0_0)] px-4">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="max-w-[320px] truncate text-[15px] font-semibold tracking-[-0.01em]">
          {title}
        </h1>
        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-white/[0.1]" />
        <span className="max-w-56 truncate text-xs font-medium text-white/52">{chapterTitle}</span>
      </div>

      {/* Numbered production stepper — the canvas IS the Plot Tree step; the
          other steps live on the workbench routes. Centered between the title
          (left) and the preview/publish actions (right). */}
      <nav
        aria-label={stagesT("tree")}
        className="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center md:flex"
      >
        {/* Steps 1/3/4 are disabled until their production pages exist — no
            fake entrances. Only the Plot Tree (this canvas) is live. */}
        <span aria-disabled="true" className="inline-flex items-center gap-2 opacity-45">
          <span className="grid size-5 place-items-center rounded-full bg-white/10 text-[10px] font-semibold tabular-nums text-white/55">
            1
          </span>
          <span className="text-xs font-medium text-white/55">{stagesT("script")}</span>
        </span>
        <span aria-hidden="true" className="mx-3 h-px w-8 bg-white/12" />
        <span aria-current="page" className="inline-flex items-center gap-2">
          <span className="grid size-5 place-items-center rounded-full bg-white text-[10px] font-semibold tabular-nums text-black">
            2
          </span>
          <span className="text-xs font-semibold text-white">{stagesT("tree")}</span>
        </span>
        <span aria-hidden="true" className="mx-3 h-px w-8 bg-white/12" />
        <span aria-disabled="true" className="inline-flex items-center gap-2 opacity-45">
          <span className="grid size-5 place-items-center rounded-full bg-white/10 text-[10px] font-semibold tabular-nums text-white/55">
            3
          </span>
          <span className="text-xs font-medium text-white/55">{stagesT("assets")}</span>
        </span>
        <span aria-hidden="true" className="mx-3 h-px w-8 bg-white/12" />
        <span aria-disabled="true" className="inline-flex items-center gap-2 opacity-45">
          <span className="grid size-5 place-items-center rounded-full bg-white/10 text-[10px] font-semibold tabular-nums text-white/55">
            4
          </span>
          <span className="text-xs font-medium text-white/55">{stagesT("storyboard")}</span>
        </span>
      </nav>

      <div className="flex shrink-0 items-center gap-0.5">
        {/* Was hidden while a draft preview could only ever start at the story's
            first scene, which made it useless for a multi-chapter work. It now
            previews the chapter being edited, and a missing clip stands in
            rather than failing the compile, so an unfinished chapter is walkable. */}
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
          <span className={HEADER_LABEL_CLASS}>{t("workingPreview.action")}</span>
        </button>
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
  const worldContext = useContext(StoryCanvasWorldContext);
  const [worldEditorOpen, setWorldEditorOpen] = useState(false);
  const isWorld = data.kind === "world";
  const worldEditorId = `story-world-editor-${data.nodeId}`;
  const interactionSourceNodeId =
    data.kind === "clip" && data.exitKind === "choice" ? data.nodeId : undefined;
  const interactionChoices = interactionSourceNodeId ? (data.choices ?? []) : [];
  const hotspotInteractions = data.kind === "clip" ? (data.interactions ?? []) : [];
  const choiceDrafts = interactionSourceNodeId
    ? (choiceContext?.drafts.filter((draft) => draft.sourceNodeId === interactionSourceNodeId) ??
      [])
    : [];
  const currentVideo = data.kind === "clip" ? data.clipVideo?.currentVideo : null;
  const currentVideoAsset = currentVideo?.asset;
  const videoMetadata = storyVideoCardMetadata(currentVideo);
  const currentVideoSource: StudioVideoSource | undefined = currentVideoAsset?.previewUrl
    ? {
        src: currentVideoAsset.previewUrl,
        type: currentVideoAsset.contentType,
      }
    : undefined;
  const previewSource = currentVideoSource;
  const mediaPreview = useMediaHoverPreview({
    ownerId: id,
    enabled: Boolean(previewSource),
    canActivate: canActivateCanvasMediaPreview,
    canClaimManual: canClaimCanvasManualPlayback,
  });
  const previewFocused = focusedNodeId === id;
  const geometry = canvasNodeGeometry({ type: "storyCanvas", data });
  const worldNode = isWorld ? (worldContext?.node(data.nodeId) ?? null) : null;
  return (
    <div className="relative pt-10" data-story-node-id={id}>
      <FrostedPanel
        rim={false}
        className={cn(
          "pointer-events-auto absolute top-0 left-0 z-10 inline-flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.3)] backdrop-blur-xl"
        )}
        style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
      >
        <span
          className="grid size-6 place-items-center rounded-full"
          style={{ backgroundColor: "rgba(255,255,255,0.22)" }}
        >
          {data.kind === "clip" ? <IconMovie className="size-3.5" stroke={2} /> : null}
          {isWorld ? <IconWorld className="size-3.5" stroke={2} /> : null}
        </span>
        {t(`nodeKinds.${data.kind}`)}
      </FrostedPanel>
      <article
        {...mediaPreview.hoverProps}
        className={cn(
          "relative overflow-visible rounded-[22px] bg-[oklch(0.205_0_0/0.72)] shadow-[0_22px_70px_rgba(0,0,0,0.38)] backdrop-blur-xl backdrop-saturate-150 transition",
          selected && "bg-[oklch(0.24_0_0/0.86)] shadow-[0_28px_100px_rgba(0,0,0,0.55)]"
        )}
        style={{ width: geometry.width, minHeight: geometry.minHeight }}
      >
        <GlassRim width="1px" />
        <StoryPortHandle
          id="in"
          type="target"
          position={Position.Left}
          isConnectable={isConnectable}
          color={STORY_PORT_COLORS.flow}
          label={t("ports.input")}
          className="-left-1.75!"
          style={isWorld ? { top: geometry.minHeight / 2 } : undefined}
        />
        {data.exitKind === "auto" ? (
          <StoryPortHandle
            id="completion"
            type="source"
            position={Position.Right}
            color={STORY_PORT_COLORS.flow}
            label={t("ports.completion")}
            isConnectable={isConnectable && !data.continuationTargetNodeId}
            className="-right-1.75!"
            style={isWorld ? { top: geometry.minHeight / 2 } : undefined}
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
        {isWorld ? (
          <div className="group/world relative aspect-video overflow-hidden rounded-t-[22px] bg-white/[0.025]">
            {data.world?.firstFrameUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- provider-owned world preview
              <img
                src={data.world.firstFrameUrl}
                alt=""
                draggable={false}
                className="size-full select-none object-cover"
              />
            ) : null}
            {!data.worldId && worldNode && worldContext ? (
              <div className="absolute inset-0 z-10 grid place-items-center bg-black/10">
                <StoryWorldBindingControl
                  node={worldNode}
                  worlds={worldContext.worlds}
                  loading={worldContext.loading}
                  error={worldContext.error}
                  canEdit={worldContext.canEdit}
                  compact={false}
                  onRetry={worldContext.retry}
                  onUpdate={(worldId) => worldContext.update(worldNode.nodeId, { worldId })}
                />
              </div>
            ) : !data.world?.firstFrameUrl ? (
              <div className="grid size-full place-items-center">
                <span className="grid size-12 place-items-center rounded-2xl bg-white/[0.06] text-white/38">
                  <IconWorld className="size-6" stroke={1.5} />
                </span>
              </div>
            ) : null}
            {data.worldId && worldNode && worldContext ? (
              <div className="absolute top-2 right-2 z-20">
                <StoryWorldBindingControl
                  node={worldNode}
                  worlds={worldContext.worlds}
                  loading={worldContext.loading}
                  error={worldContext.error}
                  canEdit={worldContext.canEdit}
                  compact
                  onRetry={worldContext.retry}
                  onUpdate={(worldId) => worldContext.update(worldNode.nodeId, { worldId })}
                />
              </div>
            ) : null}
            <div className="absolute right-2 bottom-2 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-semibold text-white/70 backdrop-blur-xl">
              {data.world ? t(`worldNode.status.${data.world.status}`) : t("worldNode.unbound")}
            </div>
          </div>
        ) : null}
        <div className="p-3">
          {data.kind === "clip" ? (
            <>
              {data.title ? (
                <h2 className="-mx-1 truncate rounded px-1 text-[15px] font-semibold text-white/90">
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
          ) : isWorld ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[15px] font-semibold text-white/90">{data.title}</h2>
                  <p className="mt-1 text-[10px] text-white/38">
                    {data.maxExperienceSeconds
                      ? t("worldNode.duration", { seconds: data.maxExperienceSeconds })
                      : null}
                  </p>
                </div>
                <button
                  type="button"
                  aria-controls={worldEditorId}
                  aria-expanded={worldEditorOpen}
                  aria-label={t(
                    worldEditorOpen ? "worldNode.collapseEditor" : "worldNode.expandEditor"
                  )}
                  title={t(worldEditorOpen ? "worldNode.collapseEditor" : "worldNode.expandEditor")}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    setWorldEditorOpen((open) => !open);
                  }}
                  className="nodrag nopan nowheel grid size-8 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-white/58 transition hover:bg-white/[0.11] hover:text-white/82 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/45"
                >
                  <IconChevronDown
                    className={cn(
                      "size-4 transition-transform duration-200",
                      worldEditorOpen && "rotate-180"
                    )}
                  />
                </button>
              </div>
              {data.summary ? (
                <p className="mt-3 line-clamp-2 text-[11px] leading-[18px] text-white/46">
                  {data.summary}
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
                        {formatInteractionTime(interaction.startMs)}–
                        {formatInteractionTime(interaction.endMs)} · {triggerLabel}
                      </span>
                    </span>
                    <span className="flex max-w-[132px] flex-col items-end gap-1">
                      {outcomes.map(([outcome, value]) => {
                        if (!value) return null;
                        const actionLabel =
                          value.action.kind === "continue"
                            ? t("interactionAnchors.continueCurrent")
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
            <div className="mt-3 overflow-hidden rounded-[16px] border border-[#5b9dff]/20 bg-[#5b9dff]/[0.055]">
              <div className="flex items-center gap-2 border-b border-[#5b9dff]/15 px-3 py-2.5">
                <span className="grid size-6 place-items-center rounded-lg bg-[#5b9dff]/18 text-[#a9ceff]">
                  <IconFocusCentered className="size-3.5" stroke={1.8} />
                </span>
                <span className="min-w-0 flex-1 text-xs font-semibold text-white/78">
                  {t("interactionAnchors.title")}
                </span>
                <span className="text-xs text-white/34 tabular-nums">
                  {interactionChoices.length}
                </span>
                <span className="rounded-full bg-[#5b9dff]/12 px-2 py-1 text-xs font-semibold text-[#9bc4ff]">
                  {t("interactionAnchors.choiceType")}
                </span>
              </div>
              <textarea
                rows={1}
                value={data.summary ?? ""}
                disabled={!choiceContext?.canEditContent}
                maxLength={4_000}
                placeholder={t("interactionCard.promptPlaceholder")}
                aria-label={t("interactionCard.promptPlaceholder")}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                onChange={(event) =>
                  choiceContext?.updatePrompt(interactionSourceNodeId, event.target.value)
                }
                className="nodrag nopan nowheel field-sizing-content block max-h-20 min-h-10 w-full resize-none overflow-y-auto border-b border-white/[0.06] bg-transparent px-3 py-2.5 text-[12px] leading-5 font-semibold text-white/82 outline-none placeholder:text-white/32 disabled:cursor-default"
              />
              {interactionChoices.map((choice, index) => (
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
                    placeholder={t("interactionCard.untitledOption")}
                    aria-label={t("interactionCard.optionPlaceholder")}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      choiceContext?.updateChoice(
                        interactionSourceNodeId,
                        choice.choiceId,
                        event.target.value
                      );
                    }}
                    className={cn(
                      "nodrag nopan nowheel w-full min-w-0 rounded-md bg-transparent px-1 py-1 outline-none transition placeholder:text-[#e0a45c]/78 hover:bg-white/[0.03] focus:bg-white/[0.05] disabled:cursor-default",
                      choice.label.trim() ? "text-white/72" : "text-[#e0a45c]/78"
                    )}
                  />
                  <span className="max-w-[112px] truncate rounded-full bg-white/[0.055] px-2 py-1 text-xs text-white/38 group-hover/choice:hidden group-focus-within/choice:hidden">
                    → {choice.targetTitle ?? t("interactionCard.linkedTarget")}
                  </span>
                  {choiceContext?.canEditContent ? (
                    <span className="nodrag nopan hidden items-center gap-0.5 group-hover/choice:flex group-focus-within/choice:flex">
                      <button
                        type="button"
                        disabled={index === 0}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          choiceContext.moveChoice(interactionSourceNodeId, choice.choiceId, "up");
                        }}
                        className="grid size-6 place-items-center rounded-md text-white/32 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-20"
                        aria-label={t("inspector.moveChoiceUp")}
                      >
                        <IconArrowUp className="size-3" />
                      </button>
                      <button
                        type="button"
                        disabled={index === interactionChoices.length - 1}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          choiceContext.moveChoice(
                            interactionSourceNodeId,
                            choice.choiceId,
                            "down"
                          );
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
                          choiceContext.removeChoice(interactionSourceNodeId, choice.choiceId);
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
                      label: choice.label.trim() || t("interactionCard.untitledOption"),
                    })}
                    className="-right-[23px]!"
                  />
                </div>
              ))}
              {choiceDrafts.map((draft, index) => (
                <div
                  key={draft.draftId}
                  className="nodrag nopan nowheel relative mt-1 grid min-h-10 grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-white/[0.045] px-1 py-2 pr-3"
                >
                  <span className="tabular-nums text-white/24">
                    {String(interactionChoices.length + index + 1).padStart(2, "0")}
                  </span>
                  <input
                    value={draft.label}
                    maxLength={4_000}
                    placeholder={t("interactionCard.optionPlaceholder")}
                    aria-label={t("interactionCard.optionPlaceholder")}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      choiceContext?.updateDraft(
                        interactionSourceNodeId,
                        draft.draftId,
                        event.target.value
                      )
                    }
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Escape" && !draft.required) {
                        event.preventDefault();
                        choiceContext?.cancel(interactionSourceNodeId, draft.draftId);
                      }
                    }}
                    className="h-7 w-full min-w-0 bg-transparent px-1 text-xs text-white/82 outline-none placeholder:text-white/28"
                  />
                  {!draft.required ? (
                    <button
                      type="button"
                      aria-label={t("interactionCard.cancelOption")}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        choiceContext?.cancel(interactionSourceNodeId, draft.draftId);
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
                      label={t("interactionCard.connectOption")}
                      className="-right-[23px]!"
                    />
                  ) : null}
                </div>
              ))}
              {interactionChoices.length + choiceDrafts.length < MAX_PLAYER_CHOICES &&
              choiceContext?.canCreateOption ? (
                <button
                  type="button"
                  className="nodrag nopan mt-1 flex h-10 w-full items-center gap-2 rounded-xl px-2.5 text-left text-xs font-semibold text-[#84b7ff]/78 transition hover:bg-[rgba(91,157,255,0.08)] hover:text-[#a9ceff]"
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
            </div>
          ) : null}
        </div>
        {worldEditorOpen && worldNode && worldContext ? (
          <div
            id={worldEditorId}
            className="nodrag nopan nowheel border-t border-white/[0.07] p-4"
            aria-label={t("worldNode.bindingTitle")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <StoryWorldNodeEditor
              key={`${worldNode.nodeId}:${worldNode.worldId ?? "unbound"}`}
              projectId={worldContext.projectId}
              node={worldNode}
              world={
                worldNode.worldId
                  ? (worldContext.worlds.find((world) => world.id === worldNode.worldId) ?? null)
                  : null
              }
              canEdit={worldContext.canEdit}
              canGenerate={worldContext.canGenerate}
              candidateAssets={worldContext.candidateAssets}
              candidateAssetsLoading={worldContext.candidateAssetsLoading}
              candidateAssetsError={worldContext.candidateAssetsError}
              onRetryCandidateAssets={worldContext.retryCandidateAssets}
              onUploadCandidateAsset={worldContext.uploadCandidateAsset}
              onUpdate={worldContext.update}
              onRun={(worldId) => worldContext.run(worldNode.nodeId, worldId)}
            />
          </div>
        ) : null}
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

function nodePositions(nodes: StoryCanvasNode[]): Record<string, StoryCanvasPosition> {
  return Object.fromEntries(
    [...nodes]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) => [node.id, { x: node.position.x, y: node.position.y }])
  );
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
