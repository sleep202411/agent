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
  IconArrowLeft,
  IconBook2,
  IconLayoutGrid,
  IconCheck,
  IconCloudUpload,
  IconDownload,
  IconFileText,
  IconGitBranch,
  IconLoader2,
  IconMovie,
  IconPlayerPlay,
  IconRefresh,
  IconSparkles,
  IconUser,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { StoryAgentRunStatus } from "@repo/shared/story-agent";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useWorkspace } from "@/app/_components/workspace-context";
import { Button } from "@/components/ui/button";
import { CanvasControls } from "@/components/canvas/canvas-controls";
import { CanvasHistoryControls } from "@/components/canvas/canvas-history-controls";
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
import {
  canvasLayoutRevisionConflict,
  cancelStoryClipVideoUpload,
  completeStoryClipVideoUpload,
  createStoryClipVideoGeneration,
  createStoryTrailerVideoGeneration,
  draftRevisionConflict,
  getStoryCanvasLayout,
  getStoryExperienceCurrentRelease,
  getStoryWorkbench,
  putStoryClipCurrentVideo,
  putStoryCanvasLayout,
  putStoryDraft,
  storyApiErrorMessage,
  waitForStoryClipVideoUploadFinalization,
  type CanvasLayoutRevisionConflict,
  type DraftRevisionConflict,
  type InteractiveStoryDraftContent,
  type StoryVideoGeneration,
  type StoryVideoLibraryItem,
  type StoryCanvasPosition,
  type StoryCanvasLayout,
  type StoryVideoGenerationRecipeInput,
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
import {
  CLOSED_STORY_CANVAS_INSPECTOR,
  STORY_WORLD_INSPECTOR,
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
import { StoryAgentRunAura } from "./story-agent-run-aura";
import { StoryCanvasAssistantLayer } from "./story-canvas-assistant-layer";
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
  resolveStoryAgentAuthoringPhase,
  resolveStoryCanvasEditPolicy,
  resolveStoryCanvasProjectionSurface,
  resolveStoryCanvasWriteAuthority,
  resolveStoryProjectionAuthority,
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
  updateChoiceExit,
  updateChoiceOption,
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
import type { StoryClipMediaUploadState } from "./story-clip-media-panel";
import { StoryNodeInspector } from "./story-node-inspector";
import { StoryPublicationDialog } from "./story-publication-dialog";
import { type StoryClipGenerationFormProps } from "./story-clip-generation-form";
import {
  StoryProductionActionGate,
  StorySubmissionKeyRegistry,
} from "./story-trailer-production-model";
import {
  createStoryCharacter,
  deleteStoryCharacter,
  updateStoryCharacter,
  updateStoryClipMeta,
} from "./story-world-mutations";
import { StoryDraftSnapshotCoordinator } from "./story-draft-snapshot-coordinator";
import {
  storyGenerationError,
  isActiveVideoGeneration,
  resolveStoryVideoState,
  workbenchHasActiveGeneration,
} from "./story-video-state";
import { projectConfirmedClipCurrentVideo } from "./story-workbench-current-video";
import { useStoryPublication } from "./use-story-publication";
import { useStoryAgentRun } from "./use-story-agent-run";
import { useStoryAgentNodeReveal } from "./use-story-agent-node-reveal";

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
type StoryClipGenerationRequest = {
  requestId: string;
  graphNodeId: string;
  expectedSelectionVersion: number;
  recipe: StoryVideoGenerationRecipeInput;
  recipeFingerprint: string;
};
type StoryGenerationRecipeRecord = {
  recipe: StoryVideoGenerationRecipeInput;
  dirty: boolean;
};
type PendingCompletionDrop = {
  sourceCanvasNodeId: string;
  sourceHandleId: string;
  clientPosition: { x: number; y: number };
  flowPosition: StoryCanvasPosition;
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
const TRAILER_RECIPE_KEY = "trailer";

function emptyStoryGenerationRecipe(): StoryVideoGenerationRecipeInput {
  return {
    prompt: "",
    modelId: "",
    mode: "multimodal_to_video",
    durationMs: 0,
    references: [],
  };
}

const StoryCanvasFocusContext = createContext<string | null>(null);

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

export function StoryProjectCanvas({ projectId }: { projectId: string }) {
  const { activeWorkspace } = useWorkspace();
  const scopeKey = `${activeWorkspace?.id ?? "no-workspace"}:${projectId}`;

  return (
    <ReactFlowProvider key={scopeKey}>
      <StoryProjectCanvasInner projectId={projectId} />
    </ReactFlowProvider>
  );
}

function StoryProjectCanvasInner({ projectId }: { projectId: string }) {
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
  const agentRunController = useStoryAgentRun({ workspaceId, projectId });
  const agentApplying = agentRunController.applying;
  const agentAuthorityReady = agentRunController.authorityState === "ready";
  const [content, setContent] = useState<InteractiveStoryDraftContent | null>(null);
  const [inspectorTarget, setInspectorTarget] = useState<StoryCanvasInspectorTarget>(
    CLOSED_STORY_CANVAS_INSPECTOR
  );
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [agentTakeoverAction, setAgentTakeoverAction] = useState<"confirm" | "undo" | null>(null);
  const [mutationBarrier] = useState(() => createStoryCanvasMutationBarrier());
  const focusedNodeId = storyCanvasInspectorNodeId(inspectorTarget);
  const inspectorOpen = inspectorTarget.kind !== "closed";
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
  const [appliedLayoutRevision, setAppliedLayoutRevision] = useState<number | null>(null);
  const [layoutSaveState, setLayoutSaveState] = useState<SaveState>("idle");
  const [layoutSaveError, setLayoutSaveError] = useState<string | null>(null);
  // Optimistic Story World presence while a layout write is in flight; the
  // authoritative layout projection re-syncs it on adoption.
  const [storyWorldNodePresentOverride, setStoryWorldNodePresentOverride] = useState<
    boolean | null
  >(null);
  const [productionPendingKey, setProductionPendingKey] = useState<string | null>(null);
  const [productionError, setProductionError] = useState<string | null>(null);
  const [clipGenerationRequest, setClipGenerationRequest] =
    useState<StoryClipGenerationRequest | null>(null);
  const [generationRecipes, setGenerationRecipes] = useState<
    Record<string, StoryGenerationRecipeRecord>
  >({});
  const [workingPreviewPending, setWorkingPreviewPending] = useState(false);
  const [pendingLeaveRisk, setPendingLeaveRisk] = useState<StoryCanvasLeaveRisk | null>(null);
  const [recoveryExported, setRecoveryExported] = useState(false);
  const [productionActionGate] = useState(() => new StoryProductionActionGate());
  const [draftSnapshotCoordinator] = useState(() => new StoryDraftSnapshotCoordinator());
  const [productionSubmissionKeys] = useState(
    () =>
      new StorySubmissionKeyRegistry(
        `story-clip:${workspaceId ?? "no-workspace"}:${projectId}`,
        () => {
          try {
            return globalThis.window?.sessionStorage ?? null;
          } catch {
            return null;
          }
        }
      )
  );
  const [trailerPendingKey, setTrailerPendingKey] = useState<string | null>(null);
  const [trailerError, setTrailerError] = useState<string | null>(null);
  const [trailerActionGate] = useState(() => new StoryProductionActionGate());
  const [trailerSubmissionKeys] = useState(
    () =>
      new StorySubmissionKeyRegistry(
        `story-trailer:${workspaceId ?? "no-workspace"}:${projectId}`,
        () => {
          try {
            return globalThis.window?.sessionStorage ?? null;
          } catch {
            return null;
          }
        }
      )
  );
  const [canvasNodes, setCanvasNodes] = useNodesState<StoryCanvasNode>([]);
  const [canvasEdges, setCanvasEdges, onCanvasEdgesChange] = useEdgesState<StoryCanvasEdge>([]);
  const [sessionId] = useState(() => globalThis.crypto.randomUUID());
  const [history] = useState(() => new StoryCanvasHistory());
  const [, setHistoryVersion] = useState(0);
  const hydratedRef = useRef(false);
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
  const explicitDiscardAndLeaveRef = useRef(false);
  const currentHistoryEntryRef = useRef<StoryCanvasHistoryEntry | null>(null);
  const pendingLeaveActionRef = useRef<(() => void) | null>(null);
  const persistRef = useRef<
    (next: InteractiveStoryDraftContent, options?: PersistDraftOptions) => Promise<void>
  >(async () => {});
  const saveSettledWaitersRef = useRef(new Set<() => void>());
  const draftSnapshotBarrierRef = useRef(false);
  const layoutHydratedRef = useRef(false);
  const layoutRevisionRef = useRef(0);
  const layoutSavedSignatureRef = useRef("");
  const layoutConflictRef = useRef<CanvasLayoutRevisionConflict | null>(null);
  const layoutSaveInFlightRef = useRef(false);
  const layoutSaveSettledWaitersRef = useRef(new Set<() => void>());
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
  const hasDirtyGenerationRecipeRef = useRef(false);
  const agentTakeoverPendingRef = useRef(false);

  useLayoutEffect(() => {
    hasDirtyGenerationRecipeRef.current = Object.values(generationRecipes).some(
      (record) => record.dirty
    );
  }, [generationRecipes]);

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

  const showStoryWorldInspector = useCallback(() => {
    selectCanvasNodeExclusively(null);
    setInspectorTarget(STORY_WORLD_INSPECTOR);
    setCreatorMenu(null);
  }, [selectCanvasNodeExclusively]);

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
    () =>
      storyProjectionQueryKey(
        "workbench",
        workspaceId,
        projectId,
        agentRunController.authoritySnapshotKey
      ),
    [agentRunController.authoritySnapshotKey, projectId, workspaceId]
  );
  const layoutQueryKey = useMemo(
    () =>
      storyProjectionQueryKey(
        "canvas-layout",
        workspaceId,
        projectId,
        agentRunController.authoritySnapshotKey
      ),
    [agentRunController.authoritySnapshotKey, projectId, workspaceId]
  );
  const workbenchQuery = useQuery({
    ...storyProjectionQueryOptions({
      kind: "workbench",
      workspaceId,
      projectId,
      authoritySnapshotKey: agentRunController.authoritySnapshotKey,
      agentAuthorityState: agentRunController.authorityState,
      queryFn: () => getStoryWorkbench(workspaceId as string, projectId),
    }),
    refetchInterval: (query) => (workbenchHasActiveGeneration(query.state.data) ? 2_000 : false),
  });
  const refetchWorkbench = workbenchQuery.refetch;
  const layoutQuery = useQuery(
    storyProjectionQueryOptions({
      kind: "canvas-layout",
      workspaceId,
      projectId,
      authoritySnapshotKey: agentRunController.authoritySnapshotKey,
      agentAuthorityState: agentRunController.authorityState,
      queryFn: () => getStoryCanvasLayout(workspaceId as string, projectId),
    })
  );
  /**
   * "checking" here means a fresh authoritative read is in flight (or has not
   * started). It latches every write through the edit policy below, but it no
   * longer unmounts the canvas: `placeholderData: keepPreviousData` keeps the
   * previous projection snapshot rendering across authority-key rotations.
   */
  const projectionAuthority = resolveStoryProjectionAuthority({
    hasWorkspace: Boolean(workspaceId),
    agentAuthorityState: agentRunController.authorityState,
    workbenchFetchedAfterMount: workbenchQuery.isFetchedAfterMount,
    workbenchError: workbenchQuery.isError,
    layoutFetchedAfterMount: layoutQuery.isFetchedAfterMount,
    layoutError: layoutQuery.isError,
  });
  // `keepPreviousData` carries the previous snapshot through the PENDING window
  // of a rotated key, but a failed fresh read drops `data` to undefined. The
  // canvas must keep rendering its last snapshot through that failure too
  // (writes stay latched via `projectionAuthority` "unavailable"), so retain
  // the last defined projections for every render-side consumer.
  const workbenchProjection = useLastDefinedData(workbenchQuery.data);
  const layoutProjection = useLastDefinedData(layoutQuery.data);
  // The Story World card presence is layout-owned (layout v2): legacy projects
  // (and any layout that predates the flag) keep the card; fresh projects start
  // without it so the empty-canvas agent launcher (idea + director skills) can
  // own the first-open experience. The card is summoned from the creator
  // menu/dock and deletable like any canvas projection.
  const storyWorldNodePresent =
    storyWorldNodePresentOverride ?? layoutProjection?.storyWorldNodePresent ?? true;
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
  const references = workbenchProjection?.references ?? [];

  const cacheSavedDraft = useCallback(
    (saved: StoryWorkbench["draft"]) => {
      if (!workspaceId) return;
      queryClient.setQueryData<StoryWorkbench>(workbenchQueryKey, (current) =>
        current && saved.revision >= current.draft.revision ? { ...current, draft: saved } : current
      );
    },
    [queryClient, workbenchQueryKey, workspaceId]
  );

  useEffect(() => {
    if (!workbenchProjection) return;
    const workbench = workbenchProjection;
    if (hydratedRef.current) {
      if (workbench.draft.revision <= revisionRef.current || conflictRef.current) return;
      const latest = latestContentRef.current;
      const hasLocalChanges = Boolean(
        recoveryContentRef.current ||
        saveInFlightRef.current ||
        (latest && canonicalJsonString(latest) !== savedSignatureRef.current)
      );
      if (hasLocalChanges) return;
    }
    hydratedRef.current = true;
    revisionRef.current = workbench.draft.revision;
    setDraftRevision(workbench.draft.revision);
    savedSignatureRef.current = canonicalJsonString(workbench.draft.content);
    latestContentRef.current = workbench.draft.content;
    history.clear();
    setHistoryVersion((current) => current + 1);
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
      agentApplying ||
      !agentAuthorityReady ||
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
  }, [agentApplying, agentAuthorityReady]);

  const persist = useCallback(
    async (next: InteractiveStoryDraftContent, options: PersistDraftOptions = {}) => {
      if (!workspaceId || conflictRef.current || disposedRef.current) return;
      if (agentApplying || !agentAuthorityReady) {
        recoveryContentRef.current = next;
        if (!disposedRef.current) setSaveState("dirty");
        return;
      }
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
        const saved = await putStoryDraft(workspaceId, projectId, {
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
      scheduleSaveRetry,
      sessionId,
      workspaceId,
      agentApplying,
      agentAuthorityReady,
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
    if (agentApplying || !agentAuthorityReady) {
      if (signature !== savedSignatureRef.current) {
        recoveryContentRef.current = content;
        queuedContentRef.current = null;
        setSaveState("dirty");
      }
      return;
    }
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
  }, [agentApplying, agentAuthorityReady, clearSaveRetry, conflict, content, scheduleSaveRetry]);

  const flushDraftBeforeLeaving = useCallback(
    (keepalive: boolean) => {
      if (
        !workspaceId ||
        agentApplying ||
        !agentAuthorityReady ||
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
      agentApplying,
      agentAuthorityReady,
      cacheSavedDraft,
      clearSaveRetry,
      commonT,
      projectId,
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
            video?.trailer ?? null,
            storyWorldNodePresent
          )
        : null,
    // Translation values are primitives. Depending on them keeps the model
    // stable across ordinary renders while still refreshing after a locale change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      content,
      video?.clips,
      video?.trailer,
      project?.defaultLocale,
      project?.frameProfile,
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
  const projectionTarget = agentRunController.projectionTarget;
  const acknowledgeProjectionTarget = agentRunController.acknowledgeProjectionTarget;
  const projectionTargetReconciled = Boolean(
    projectionTarget?.resultDraftRevision !== null &&
    projectionTarget?.resultLayoutRevision !== null &&
    projectionTarget?.resultDraftRevision !== undefined &&
    projectionTarget?.resultLayoutRevision !== undefined &&
    draftRevision >= projectionTarget.resultDraftRevision &&
    appliedLayoutRevision !== null &&
    appliedLayoutRevision >= projectionTarget.resultLayoutRevision
  );
  const agentPhase = resolveStoryAgentAuthoringPhase({
    // Write authority spans the run head AND both projection reads: while a
    // rotated authority key refetches, the canvas keeps rendering its previous
    // snapshot, so this phase — not an unmount — is what holds writes closed.
    authorityState: resolveStoryCanvasWriteAuthority(projectionAuthority),
    takeoverPending: agentTakeoverAction !== null,
    applying: agentApplying,
    runStatus: projectionTarget ? "succeeded" : null,
    resultDraftRevision: projectionTarget?.resultDraftRevision ?? null,
    resultLayoutRevision: projectionTarget?.resultLayoutRevision ?? null,
    draftRevision,
    layoutRevision: appliedLayoutRevision,
    hasConflict: Boolean(conflict || layoutConflict),
  });
  useEffect(() => {
    if (!projectionTarget || !projectionTargetReconciled) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) acknowledgeProjectionTarget(projectionTarget.id);
    });
    return () => {
      cancelled = true;
    };
  }, [acknowledgeProjectionTarget, projectionTarget, projectionTargetReconciled]);
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
    hasDraftConflict: Boolean(conflict),
    hasLayoutConflict: Boolean(layoutConflict),
    agentPhase,
  });
  const canEdit = editPolicy.canEditContent;
  const canMutateCanvasLayout = editPolicy.canEditLayout;
  useLayoutEffect(() => {
    mutationBarrier.update({
      canEditContent: canEdit,
      canEditLayout: canMutateCanvasLayout,
      canManageProduction: editPolicy.canManageProduction,
      takeoverPending: agentTakeoverPendingRef.current,
    });
  }, [canEdit, canMutateCanvasLayout, editPolicy.canManageProduction, mutationBarrier]);
  const canManageClipMedia = editPolicy.canManageProduction;
  const clipMediaDisabledReason = !canManageClipMedia
    ? !project?.capabilities.includes("story.generate")
      ? t("production.disabled.permission")
      : t("readOnly")
    : null;

  useEffect(() => {
    canvasNodesRef.current = canvasNodes;
  }, [canvasNodes]);

  useEffect(() => {
    if (!model || !layoutProjection) return;
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
      setAppliedLayoutRevision(layoutProjection.revision);
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
      setAppliedLayoutRevision(layoutProjection.revision);
      setStoryWorldNodePresentOverride(layoutProjection.storyWorldNodePresent);
      setLayoutSaveError(null);
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
  }, [history, layoutProjection, model, setCanvasNodes, storyWorldNodePresent]);

  const clearLayoutSaveRetry = useCallback((resetAttempts = false) => {
    if (layoutRetryTimerRef.current !== null) {
      window.clearTimeout(layoutRetryTimerRef.current);
      layoutRetryTimerRef.current = null;
    }
    if (resetAttempts) layoutRetryAttemptRef.current = 0;
  }, []);

  const notifyLayoutSaveSettled = useCallback(() => {
    const waiters = [...layoutSaveSettledWaitersRef.current];
    layoutSaveSettledWaitersRef.current.clear();
    waiters.forEach((resolve) => resolve());
  }, []);

  const waitForLayoutSaveToSettle = useCallback(() => {
    if (!layoutSaveInFlightRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => layoutSaveSettledWaitersRef.current.add(resolve));
  }, []);

  const scheduleLayoutSaveRetry = useCallback(() => {
    if (
      disposedRef.current ||
      agentApplying ||
      !agentAuthorityReady ||
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
  }, [agentApplying, agentAuthorityReady]);

  const persistLayout = useCallback(
    async (next: StoryCanvasLayoutPayload, options: PersistLayoutOptions = {}) => {
      if (!workspaceId || layoutConflictRef.current) return;
      const signature = layoutPayloadSignature(next);
      if (!options.preserveDesired) latestDesiredLayoutRef.current = next;
      if (agentApplying || !agentAuthorityReady) {
        recoveryLayoutRef.current = next;
        setLayoutSaveState("dirty");
        return;
      }
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
        setLayoutSaveError(null);
        setLayoutSaveState((current) => (current === "idle" ? "idle" : "saved"));
        return;
      }

      clearLayoutSaveRetry();
      recoveryLayoutRef.current = next;
      layoutSaveInFlightRef.current = true;
      setLayoutSaveState("saving");
      setLayoutSaveError(null);
      let requestFailed = false;
      let requestConflicted = false;
      let failure: unknown = null;
      try {
        const saved = await putStoryCanvasLayout(workspaceId, projectId, {
          expectedRevision: layoutRevisionRef.current,
          nodePositions: next.nodePositions,
          storyWorldNodePresent: next.storyWorldNodePresent,
          sessionId,
        });
        layoutRevisionRef.current = saved.revision;
        setAppliedLayoutRevision(saved.revision);
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
          setAppliedLayoutRevision(nextConflict.current.revision);
          layoutSavedSignatureRef.current = signature;
          recoveryLayoutRef.current = null;
          clearLayoutSaveRetry(true);
          setLayoutSaveError(null);
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
          setLayoutSaveError(storyApiErrorMessage(error, commonT("errors.generic")));
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
        notifyLayoutSaveSettled();
      }

      if (failure && options.propagateError) throw failure;
    },
    [
      agentApplying,
      agentAuthorityReady,
      clearLayoutSaveRetry,
      commonT,
      notifyLayoutSaveSettled,
      projectId,
      scheduleLayoutSaveRetry,
      sessionId,
      workspaceId,
    ]
  );

  useEffect(() => {
    persistLayoutRef.current = persistLayout;
  }, [persistLayout]);

  useEffect(() => {
    if (agentApplying || !agentAuthorityReady || layoutConflictRef.current) return;
    const desired = unsavedDesiredLayout(
      latestDesiredLayoutRef.current,
      layoutSavedSignatureRef.current
    );
    if (!desired) return;
    recoveryLayoutRef.current = desired;
    scheduleLayoutSaveRetry();
  }, [agentApplying, agentAuthorityReady, scheduleLayoutSaveRetry]);

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
      generationRecipeDirty: hasDirtyGenerationRecipeRef.current,
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
        agentApplying ||
        !agentAuthorityReady ||
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
          setAppliedLayoutRevision(saved.revision);
          setLayoutSaveError(null);
          setLayoutSaveState("saved");
        }
        return true;
      };

      void putStoryCanvasLayout(
        workspaceId,
        projectId,
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
          setLayoutSaveError(storyApiErrorMessage(error, commonT("errors.generic")));
          scheduleLayoutSaveRetry();
        })
        .finally(() => {
          if (generation === finalLayoutFlushGenerationRef.current) {
            finalLayoutFlushActiveRef.current = false;
          }
        });
    },
    [
      agentApplying,
      agentAuthorityReady,
      clearLayoutSaveRetry,
      commonT,
      layoutQueryKey,
      projectId,
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

  const flushAuthoringBeforeAgentRun = useCallback(async () => {
    if (!workspaceId || conflictRef.current || layoutConflictRef.current) {
      throw new Error(saveError ?? layoutSaveError ?? commonT("errors.generic"));
    }

    if (saveDebounceTimerRef.current !== null) {
      window.clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = null;
    }
    clearSaveRetry();
    clearLayoutSaveRetry();

    while (saveInFlightRef.current) await waitForSaveToSettle();
    const draft = latestContentRef.current;
    if (!draft) throw new Error(commonT("errors.generic"));
    await persistRef.current(draft, { propagateError: true });
    if (conflictRef.current || savedSignatureRef.current !== canonicalJsonString(draft)) {
      throw new Error(saveError ?? commonT("errors.generic"));
    }

    while (layoutSaveInFlightRef.current) await waitForLayoutSaveToSettle();
    const layout = latestDesiredLayoutRef.current;
    if (layout) {
      await persistLayoutRef.current(layout, {
        preserveDesired: true,
        propagateError: true,
      });
      if (
        layoutConflictRef.current ||
        layoutSavedSignatureRef.current !== layoutPayloadSignature(layout)
      ) {
        throw new Error(layoutSaveError ?? commonT("errors.generic"));
      }
    }
  }, [
    clearLayoutSaveRetry,
    clearSaveRetry,
    commonT,
    layoutSaveError,
    saveError,
    waitForLayoutSaveToSettle,
    waitForSaveToSettle,
    workspaceId,
  ]);

  const canvasAgentRunController = {
    ...agentRunController,
    applying:
      agentPhase === "takeover-pending" ||
      agentPhase === "applying" ||
      agentPhase === "reconciling",
    actionPending: agentTakeoverAction !== null || agentRunController.actionPending,
    pendingAction: agentTakeoverAction ?? agentRunController.pendingAction,
    cancel: async (runId: string) => {
      if (agentTakeoverPendingRef.current) {
        throw new Error("A Story Agent takeover is already in progress.");
      }
      return agentRunController.cancel(runId);
    },
    confirm: async (runId: string) => {
      if (agentTakeoverPendingRef.current) {
        throw new Error("A Story Agent takeover is already in progress.");
      }
      agentTakeoverPendingRef.current = true;
      mutationBarrier.setTakeoverPending(true);
      setAgentTakeoverAction("confirm");
      try {
        await flushAuthoringBeforeAgentRun();
        return await agentRunController.confirm(runId);
      } catch (error) {
        await agentRunController.refresh().catch(() => undefined);
        throw error;
      } finally {
        agentTakeoverPendingRef.current = false;
        mutationBarrier.setTakeoverPending(false);
        setAgentTakeoverAction(null);
      }
    },
    undo: async (runId: string) => {
      if (agentTakeoverPendingRef.current) {
        throw new Error("A Story Agent takeover is already in progress.");
      }
      agentTakeoverPendingRef.current = true;
      mutationBarrier.setTakeoverPending(true);
      setAgentTakeoverAction("undo");
      try {
        await flushAuthoringBeforeAgentRun();
        return await agentRunController.undo(runId);
      } catch (error) {
        await agentRunController.refresh().catch(() => undefined);
        throw error;
      } finally {
        agentTakeoverPendingRef.current = false;
        mutationBarrier.setTakeoverPending(false);
        setAgentTakeoverAction(null);
      }
    },
  };

  useEffect(() => {
    if (!agentApplying && agentAuthorityReady) return;
    if (saveDebounceTimerRef.current !== null) {
      window.clearTimeout(saveDebounceTimerRef.current);
      saveDebounceTimerRef.current = null;
    }
    clearSaveRetry();
    clearLayoutSaveRetry();
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setCreatorMenu(null);
      setPendingCompletionDrop(null);
    });
    return () => {
      cancelled = true;
    };
  }, [agentApplying, agentAuthorityReady, clearLayoutSaveRetry, clearSaveRetry]);

  const focusedNode = useMemo(
    () => model?.nodes.find((node) => node.id === focusedNodeId) ?? null,
    [focusedNodeId, model?.nodes]
  );
  const focusedClipVideo =
    focusedNode?.data.kind === "clip" ? (focusedNode.data.clipVideo ?? null) : null;
  const focusedGraphNodeId = focusedNode?.data.kind === "clip" ? focusedNode.data.nodeId : null;
  const focusedRecipeKey = focusedGraphNodeId ? `clip:${focusedGraphNodeId}` : null;
  const focusedRecipe = focusedRecipeKey
    ? (generationRecipes[focusedRecipeKey]?.recipe ?? emptyStoryGenerationRecipe())
    : null;

  const updateGenerationRecipe = useCallback(
    (key: string, recipe: StoryVideoGenerationRecipeInput) => {
      if (!mutationBarrier.permits("production")) return;
      setGenerationRecipes((current) => ({
        ...current,
        [key]: { recipe, dirty: true },
      }));
    },
    [mutationBarrier]
  );

  const confirmSubmittedRecipe = useCallback((key: string, fingerprint: string) => {
    setGenerationRecipes((current) => {
      const record = current[key];
      if (!record || canonicalJsonString(record.recipe) !== fingerprint) return current;
      return { ...current, [key]: { ...record, dirty: false } };
    });
  }, []);

  const refreshProduction = useCallback(async () => {
    await workbenchQuery.refetch();
  }, [workbenchQuery]);

  const runProductionAction = useCallback(
    async (key: string, action: () => Promise<unknown>): Promise<boolean> => {
      if (!mutationBarrier.permits("production")) return false;
      if (!productionActionGate.tryAcquire()) return false;
      setProductionPendingKey(key);
      setProductionError(null);
      try {
        await action();
        await refreshProduction();
        return true;
      } catch (error) {
        setProductionError(storyApiErrorMessage(error, t("production.errors.action")));
        try {
          // The server may have accepted part of the video-plane operation
          // before a later validation fails. Refresh the authoritative state.
          await refreshProduction();
        } catch {
          // Keep the actionable generation error; refresh remains available.
        }
        return false;
      } finally {
        productionActionGate.release();
        setProductionPendingKey(null);
      }
    },
    [mutationBarrier, productionActionGate, refreshProduction, t]
  );

  const generateSelectedClip = useCallback(
    (recipe: StoryVideoGenerationRecipeInput) => {
      if (!mutationBarrier.permits("production") || !focusedGraphNodeId || !focusedRecipeKey) {
        return;
      }
      setClipGenerationRequest({
        requestId: globalThis.crypto.randomUUID(),
        graphNodeId: focusedGraphNodeId,
        expectedSelectionVersion: focusedClipVideo?.selectionVersion ?? 0,
        recipe: { ...recipe, references: [...recipe.references] },
        recipeFingerprint: canonicalJsonString(recipe),
      });
    },
    [focusedClipVideo?.selectionVersion, focusedGraphNodeId, focusedRecipeKey, mutationBarrier]
  );

  useEffect(() => {
    if (!clipGenerationRequest) return;
    const request = clipGenerationRequest;
    let active = true;

    if (!canManageClipMedia || !workspaceId) {
      queueMicrotask(() => {
        if (!active) return;
        setClipGenerationRequest((current) =>
          current?.requestId === request.requestId ? null : current
        );
      });
      return () => {
        active = false;
      };
    }

    const slot = `clip:create:${request.graphNodeId}`;
    queueMicrotask(() => {
      if (!active) return;
      void runProductionAction("generate", () =>
        withSavedDraftSnapshot(async (expectedDraftRevision) => {
          const fingerprint = canonicalJsonString({
            graphNodeId: request.graphNodeId,
            expectedDraftRevision,
            expectedSelectionVersion: request.expectedSelectionVersion,
            recipe: request.recipe,
          });
          const idempotencyKey = await productionSubmissionKeys.keyFor(slot, fingerprint, () =>
            globalThis.crypto.randomUUID()
          );
          const generation = await createStoryClipVideoGeneration(
            workspaceId,
            projectId,
            request.graphNodeId,
            {
              expectedDraftRevision,
              expectedSelectionVersion: request.expectedSelectionVersion,
              ...request.recipe,
            },
            idempotencyKey
          );
          await productionSubmissionKeys.confirm(slot, fingerprint);
          confirmSubmittedRecipe(`clip:${request.graphNodeId}`, request.recipeFingerprint);
          return generation;
        })
      ).finally(() => {
        if (!active) return;
        setClipGenerationRequest((current) =>
          current?.requestId === request.requestId ? null : current
        );
      });
    });

    return () => {
      active = false;
    };
  }, [
    canManageClipMedia,
    clipGenerationRequest,
    confirmSubmittedRecipe,
    productionSubmissionKeys,
    projectId,
    runProductionAction,
    withSavedDraftSnapshot,
    workspaceId,
  ]);

  const clipGenerationActive = isActiveVideoGeneration(focusedClipVideo?.generation);
  const productionDisabledReason = !project?.capabilities.includes("story.generate")
    ? t("production.disabled.permission")
    : !canManageClipMedia
      ? t("readOnly")
      : clipGenerationActive
        ? t("production.disabled.generating")
        : null;
  const bindClipVideo = useCallback(
    async (graphNodeId: string, expectedSelectionVersion: number, item: StoryVideoLibraryItem) => {
      if (!workspaceId || !mutationBarrier.permits("production")) {
        throw new Error(t("production.errors.action"));
      }
      const confirmedClip = await withSavedDraftSnapshot((expectedDraftRevision) =>
        putStoryClipCurrentVideo(workspaceId, projectId, graphNodeId, {
          expectedDraftRevision,
          expectedSelectionVersion,
          assetId: item.asset.id,
          variantId: item.variantId,
        })
      );
      queryClient.setQueryData<StoryWorkbench>(workbenchQueryKey, (current) =>
        projectConfirmedClipCurrentVideo(current, confirmedClip)
      );
      void refetchWorkbench();
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
  const uploadSelectedClipVideo = useCallback(
    async (
      file: File,
      onState: (state: StoryClipMediaUploadState) => void,
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
  // AI generation lives in the node inspector's "generate" tab. The clip's
  // library reuse stays on the upload tab (clipMedia), so the generation form
  // intentionally omits videoLibrary here.
  const clipGeneration: StoryClipGenerationFormProps | null =
    focusedNode?.data.kind === "clip" && focusedGraphNodeId && focusedRecipe
      ? {
          recipe: focusedRecipe,
          references,
          readOnly: !canManageClipMedia,
          canGenerate: productionDisabledReason === null,
          disabledReason: productionDisabledReason,
          pendingKey: productionPendingKey ?? (clipGenerationActive ? "generate" : null),
          error: productionError ?? storyGenerationError(focusedClipVideo?.generation),
          onRecipeChange: (next) => updateGenerationRecipe(focusedRecipeKey!, next),
          onGenerate: generateSelectedClip,
          referenceUpload: workspaceId
            ? { workspaceId, projectId, refresh: refetchWorkbench }
            : null,
        }
      : null;
  // Trailer production lives inside the Story Bible panel as a secondary action,
  // so it is scoped to the world inspector rather than a focused root node.
  const worldInspectorOpen = inspectorTarget.kind === "world";
  const selectedTrailer = worldInspectorOpen ? (video?.trailer ?? null) : null;

  const refreshTrailerProduction = useCallback(async () => {
    await workbenchQuery.refetch();
  }, [workbenchQuery]);

  const runTrailerAction = useCallback(
    async (key: string, action: () => Promise<unknown>): Promise<boolean> => {
      if (!mutationBarrier.permits("production")) return false;
      if (!trailerActionGate.tryAcquire()) return false;
      setTrailerPendingKey(key);
      setTrailerError(null);
      try {
        await action();
        await refreshTrailerProduction();
        return true;
      } catch (error) {
        setTrailerError(storyApiErrorMessage(error, t("trailer.production.errors.action")));
        try {
          await refreshTrailerProduction();
        } catch {
          // Preserve the actionable mutation error; the user can retry refresh manually.
        }
        return false;
      } finally {
        trailerActionGate.release();
        setTrailerPendingKey(null);
      }
    },
    [mutationBarrier, refreshTrailerProduction, t, trailerActionGate]
  );

  const canGenerateTrailer = canManageClipMedia;
  const trailerRecipe =
    generationRecipes[TRAILER_RECIPE_KEY]?.recipe ?? emptyStoryGenerationRecipe();

  const generateTrailer = useCallback(
    (recipe: StoryVideoGenerationRecipeInput) => {
      if (!workspaceId || !selectedTrailer || !mutationBarrier.permits("production")) {
        return;
      }
      const slot = "trailer:create";
      const recipeFingerprint = canonicalJsonString(recipe);
      const fingerprint = canonicalJsonString({
        expectedSelectionVersion: selectedTrailer.selectionVersion,
        recipe,
      });
      void runTrailerAction("generate", async () => {
        const idempotencyKey = await trailerSubmissionKeys.keyFor(slot, fingerprint, () =>
          globalThis.crypto.randomUUID()
        );
        const generation = await createStoryTrailerVideoGeneration(
          workspaceId,
          projectId,
          {
            expectedSelectionVersion: selectedTrailer.selectionVersion,
            ...recipe,
          },
          idempotencyKey
        );
        await trailerSubmissionKeys.confirm(slot, fingerprint);
        confirmSubmittedRecipe(TRAILER_RECIPE_KEY, recipeFingerprint);
        return generation;
      });
    },
    [
      confirmSubmittedRecipe,
      mutationBarrier,
      projectId,
      runTrailerAction,
      selectedTrailer,
      trailerSubmissionKeys,
      workspaceId,
    ]
  );

  const trailerGenerationActive = isActiveVideoGeneration(selectedTrailer?.generation);
  const trailerDisabledReason = !project?.capabilities.includes("story.generate")
    ? t("trailer.production.disabled.permission")
    : !canGenerateTrailer
      ? t("readOnly")
      : trailerGenerationActive
        ? t("production.disabled.generating")
        : null;
  const trailerGeneration: StoryClipGenerationFormProps | null =
    worldInspectorOpen && selectedTrailer
      ? {
          subject: "trailer",
          recipe: trailerRecipe,
          references,
          readOnly: !canGenerateTrailer,
          canGenerate: trailerDisabledReason === null,
          disabledReason: trailerDisabledReason,
          pendingKey: trailerPendingKey ?? (trailerGenerationActive ? "generate" : null),
          error: trailerError ?? storyGenerationError(selectedTrailer.generation),
          onRecipeChange: (next) => updateGenerationRecipe(TRAILER_RECIPE_KEY, next),
          onGenerate: generateTrailer,
          referenceUpload: workspaceId
            ? { workspaceId, projectId, refresh: refetchWorkbench }
            : null,
        }
      : null;
  const authoringLocale = project?.defaultLocale ?? "en-US";
  const layeredCanvasNodes = useMemo(
    () =>
      canvasNodes.map((node) => {
        const zIndex = node.id === focusedNodeId ? 1 : 0;
        return node.zIndex === zIndex ? node : { ...node, zIndex };
      }),
    [canvasNodes, focusedNodeId]
  );
  const canvasProjectionReconciled = useMemo(() => {
    if (!model || model.nodes.length !== canvasNodes.length) return false;
    const canvasNodeIds = new Set(canvasNodes.map((node) => node.id));
    return model.nodes.every((node) => canvasNodeIds.has(node.id));
  }, [canvasNodes, model]);
  useStoryAgentNodeReveal({
    run: projectionTarget ?? agentRunController.run,
    draftRevision,
    layoutRevision: appliedLayoutRevision,
    projectionReconciled: canvasProjectionReconciled,
    renderedNodeCount: canvasNodes.length,
    scopeRef: canvasSectionRef,
  });
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
    [closeCreatorMenu, mutationBarrier, readHistorySnapshot, setCanvasNodes]
  );

  // Re-apply the deterministic layout (BFS story lanes + evenly-spaced cast
  // lane) the model computes from structure, discarding manual/stray positions
  // so a batch-generated graph tidies to a clean arrangement in one click.
  const tidyCanvas = useCallback(() => {
    if (!model || !mutationBarrier.permits("layout")) return;
    const before = readHistorySnapshot();
    const modelPositions = new Map(model.nodes.map((node) => [node.id, node.position]));
    pendingNodePositionsRef.current.clear();
    const tidied = canvasNodesRef.current.map((node) => {
      const fresh = modelPositions.get(node.id);
      return fresh ? { ...node, position: { ...fresh } } : node;
    });
    canvasNodesRef.current = tidied;
    setCanvasNodes(tidied);
    const nextLayout = canvasLayoutPayload(tidied, storyWorldNodePresent);
    if (layoutPayloadSignature(nextLayout) === layoutSavedSignatureRef.current) return;
    if (before) {
      history.capture(before);
      refreshHistoryState();
    }
    setLayoutSaveState("dirty");
    void persistLayoutRef.current(nextLayout);
  }, [
    history,
    model,
    mutationBarrier,
    readHistorySnapshot,
    refreshHistoryState,
    setCanvasNodes,
    storyWorldNodePresent,
  ]);

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
    applyGraphMutation((current) => {
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
        return addChoiceOption(
          current,
          source.data.sourceNodeId,
          target.data.nodeId,
          authoringLocale
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
        project.format === "text_adventure" ? "text" : "clip"
      );
      if (!created) return;

      pendingNodePositionsRef.current.set(created.createdNodeId, {
        // The newly-created scene's input handle lands beside the release
        // point instead of placing the whole card underneath the pointer.
        x: dropPosition.x + 18,
        y: dropPosition.y - 108,
      });
      setGraphError(null);
      if (commitContent(created.content)) persistLayoutWithPendingPositions(created.content);
      selectCanvasNodeExclusively(created.createdNodeId);
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
          kind
        );
        if (!created) return;
        pendingNodePositionsRef.current.set(created.createdNodeId, {
          x: pending.flowPosition.x + 18,
          y: pending.flowPosition.y - 108,
        });
        commitContent(created.content);
        selectCanvasNodeExclusively(created.createdNodeId);
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
        (connection.sourceHandle === "choice-new" ||
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

  const addChoice = (nodeId: string, targetNodeId: string) => {
    applyGraphMutation(
      (current) => addChoiceOption(current, nodeId, targetNodeId, authoringLocale).content
    );
  };

  const updateChoice = (
    nodeId: string,
    choiceId: string,
    patch: Parameters<typeof updateChoiceOption>[3]
  ) => {
    applyGraphMutation((current) => updateChoiceOption(current, nodeId, choiceId, patch), {
      mergeKey: `choice:${nodeId}:${choiceId}:${Object.keys(patch).sort().join(",")}`,
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
    setAppliedLayoutRevision(layoutConflict.current.revision);
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
    setLayoutSaveError(null);
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
    const dirtyGenerationRecipes = risk.planes.includes("generation")
      ? Object.fromEntries(
          Object.entries(generationRecipes)
            .filter(([, record]) => record.dirty)
            .map(([key, record]) => [key, record.recipe])
        )
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
      generationRecipes: dirtyGenerationRecipes,
    });
    setPendingLeaveRisk(risk);
    setRecoveryExported(true);
  }, [generationRecipes, projectId, readLeaveRisk, workspaceId]);

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

  // Full-screen surfaces are reserved for a true cold start. Authority-key
  // rotations (run head transitions, realtime reconnects, refetch cycles) keep
  // the previous snapshot mounted — the XYFlow viewport, the assistant layer
  // with any in-flight chat stream, and composer drafts all survive — while
  // `projectionAuthority` "checking"/"unavailable" latches writes via the edit
  // policy above.
  const projectionSurface = resolveStoryCanvasProjectionSurface(
    projectionAuthority,
    workbenchProjection !== undefined && layoutProjection !== undefined
  );
  if (workspaceLoading || projectionSurface === "loading") return <CanvasLoading />;
  if (projectionSurface === "error" || !workspaceId || !project || !content || !model) {
    return (
      <>
        <CanvasError
          message={storyApiErrorMessage(
            workbenchQuery.error ?? layoutQuery.error ?? agentRunController.authorityError,
            commonT("errors.generic")
          )}
          onBackNavigate={guardBackNavigation}
          onRetry={() => {
            if (agentRunController.authorityState === "ready") {
              void workbenchQuery.refetch();
              void layoutQuery.refetch();
              return;
            }
            // Projection queries are enabled only after the active-run head is
            // fresh. Retrying them concurrently would reopen the mount race this
            // boundary intentionally closes.
            void agentRunController.refresh().catch(() => undefined);
          }}
        />
        {leaveDialog}
      </>
    );
  }

  const displaySaveState = mergeSaveStates(saveState, layoutSaveState);
  const locallyConfirmedCurrentDraftPublished = Boolean(
    (saveState === "idle" || saveState === "saved") &&
    publication.lastSucceeded?.sourceDraftRevision === draftRevision &&
    publication.lastSucceeded.build.videoSnapshotHash === video?.snapshotHash
  );
  const authorityConfirmedCurrentDraftPublished =
    (saveState === "idle" || saveState === "saved") &&
    isExactCurrentStoryRelease(currentReleaseQuery.data, {
      draftRevision,
      videoSnapshotHash: video?.snapshotHash ?? "",
    });
  const agentStatusMessage =
    agentPhase === "checking"
      ? t("emptyAgent.agentRun.checkingCurrent")
      : agentPhase === "takeover-pending"
        ? t("emptyAgent.agentRun.takingOver")
        : agentPhase === "applying"
          ? t("emptyAgent.agentRun.applying")
          : agentPhase === "reconciling"
            ? t("emptyAgent.agentRun.reconciling")
            : agentPhase === "unavailable"
              ? t("emptyAgent.agentRun.currentUnavailable")
              : null;
  const agentStatusCanRetry =
    agentRunController.authorityState === "error" ||
    agentPhase === "unavailable" ||
    (agentPhase === "reconciling" && (workbenchQuery.isError || layoutQuery.isError));
  return (
    <main className="relative h-screen min-w-[1120px] overflow-hidden bg-[oklch(0.18_0_0)] text-white">
      <StoryAgentRunAura
        active={
          agentPhase === "takeover-pending" ||
          agentPhase === "applying" ||
          agentPhase === "reconciling"
        }
      />
      <StoryCanvasAssistantLayer
        key={`${workspaceId}:${projectId}`}
        projectId={projectId}
        workspaceId={workspaceId}
        hasNodes={model.nodes.length > 0}
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        agentRunController={canvasAgentRunController}
        canManageAgentRuns={Boolean(
          project.status === "active" && project.capabilities.includes("story.edit")
        )}
      >
        {agentStatusMessage ? (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "absolute top-[4.75rem] left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-[oklch(0.18_0_0/0.94)] px-3.5 py-2 text-[11px] font-medium text-white/76 shadow-[0_14px_42px_rgba(0,0,0,0.42)] backdrop-blur-2xl",
              agentStatusCanRetry ? "pointer-events-auto" : "pointer-events-none"
            )}
          >
            {agentRunController.authorityState === "error" || agentPhase === "unavailable" ? (
              <IconAlertTriangle className="size-3.5 text-[#ff9b9e]" stroke={1.8} />
            ) : agentPhase === "applying" ? (
              <IconSparkles className="size-3.5 text-[#9d8cff]" stroke={1.8} />
            ) : (
              <IconLoader2 className="size-3.5 animate-spin text-[#9d8cff]" stroke={1.8} />
            )}
            {agentStatusMessage}
            {agentStatusCanRetry ? (
              <button
                type="button"
                className="ml-1 rounded-full bg-white/[0.09] px-2 py-1 text-[10px] font-semibold text-white/72 transition hover:bg-white/[0.15] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
                onClick={() => {
                  void agentRunController.refresh().catch(() => undefined);
                  // A failed projection read now surfaces here (the canvas keeps
                  // rendering its previous snapshot instead of unmounting into
                  // the full-screen error), so retry must also re-issue it.
                  if (
                    workbenchQuery.isError ||
                    layoutQuery.isError ||
                    agentPhase === "reconciling" ||
                    projectionTarget
                  ) {
                    void workbenchQuery.refetch();
                    void layoutQuery.refetch();
                  }
                }}
              >
                {t("emptyAgent.agentRun.retry")}
              </button>
            ) : null}
          </div>
        ) : null}
        <CanvasHeader
          title={project.title}
          revision={draftRevision}
          saveState={displaySaveState}
          saveError={saveError ?? layoutSaveError}
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
            currentReleaseQuery.isLoading
              ? t("publish.statusChecking")
              : (agentStatusMessage ?? publication.disabledReason)
          }
          onPreview={() => void openWorkingPreview()}
          onPublish={publication.open}
          onShowFoundation={showStoryWorldInspector}
          onTidy={canEdit ? tidyCanvas : undefined}
          assistantOpen={assistantOpen}
          agentRunStatus={agentRunController.run?.status ?? null}
          onToggleAssistant={() => setAssistantOpen((current) => !current)}
          onBackNavigate={guardBackNavigation}
        />

        {leaveDialog}

        <StoryPublicationDialog
          state={publication.state}
          draftRevision={draftRevision}
          canMutate={editPolicy.canPublish}
          disabledReason={agentStatusMessage ?? publication.disabledReason}
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
          // The left inspector is a floating overlay (below): the canvas keeps
          // its full width whether the inspector is open or not, so opening it
          // never resizes the React Flow container or jumps the viewport. Only
          // the RIGHT assistant rail (StoryCanvasAssistantLayer) squeezes the
          // page, which is intended.
          className="absolute top-16 right-0 bottom-0 left-0"
          onDoubleClick={(event) => {
            if (!mutationBarrier.permits("layout") || !isCanvasPaneTarget(event.target)) {
              return;
            }
            event.preventDefault();
            openCreatorMenuAtClientPosition({ x: event.clientX, y: event.clientY });
          }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundColor: "oklch(0.18 0 0)",
              backgroundImage:
                "radial-gradient(circle, rgb(255 255 255 / 0.13) 1px, transparent 1.2px)",
              backgroundSize: "20px 20px",
            }}
          />
          <MediaHoverPreviewProvider>
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
                  if (!mutationBarrier.permits("layout")) {
                    dragStartHistorySnapshotRef.current = null;
                    return;
                  }
                  const movedNodes = new Map(
                    [...draggedNodes, draggedNode].map((node) => [node.id, node])
                  );
                  const nextLayout = canvasLayoutPayload(
                    canvasNodes.map((node) => movedNodes.get(node.id) ?? node),
                    storyWorldNodePresent
                  );
                  const positions = nextLayout.nodePositions;
                  const beforeDrag = dragStartHistorySnapshotRef.current;
                  dragStartHistorySnapshotRef.current = null;
                  if (
                    beforeDrag &&
                    layoutPositionSignature(beforeDrag.nodePositions) !==
                      layoutPositionSignature(positions)
                  ) {
                    history.capture(beforeDrag);
                    refreshHistoryState();
                  }
                  if (layoutPayloadSignature(nextLayout) === layoutSavedSignatureRef.current)
                    return;
                  setLayoutSaveState("dirty");
                  void persistLayoutRef.current(nextLayout);
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
                  // Explicit click is the ONLY path that opens the node inspector.
                  requestedCanvasFocusRef.current = outcome.nodeId;
                  setInspectorTarget(storyNodeInspectorTarget(outcome.nodeId));
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
                  className={cn(
                    "bottom-5! overflow-hidden rounded-full bg-[oklch(0.24_0_0/0.82)]! p-1! shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-[30px]! backdrop-saturate-150! [&_button]:size-9!",
                    // Clear the full-width canvas's left inspector overlay.
                    inspectorOpen ? "left-[392px]!" : "left-5!"
                  )}
                />
              </StoryCanvasReactFlow>
            </StoryCanvasFocusContext.Provider>
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
            locale={authoringLocale}
            selectedNode={focusedNode}
            clipMedia={
              focusedNode?.data.kind === "clip"
                ? {
                    clip: focusedClipVideo ?? null,
                    canEdit: canManageClipMedia,
                    disabledReason: clipMediaDisabledReason,
                    onUpload: uploadSelectedClipVideo,
                  }
                : undefined
            }
            clipGeneration={clipGeneration ?? undefined}
            trailerGeneration={trailerGeneration ?? undefined}
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
            showFoundation={inspectorTarget.kind === "world"}
            canEdit={canMutateCanvasLayout}
            onUpdateFoundation={updateFoundation}
            onUpdateCharacter={(characterId, patch) =>
              applyGraphMutation((current) => updateStoryCharacter(current, characterId, patch), {
                mergeKey: `character:${characterId}:${Object.keys(patch).sort().join(",")}`,
              })
            }
            onDeleteCharacter={deleteCharacter}
            onCloseNode={() => selectCanvasNodeExclusively(null)}
            onUpdateChoiceExit={(nodeId, patch) =>
              applyGraphMutation((current) => updateChoiceExit(current, nodeId, patch), {
                mergeKey: `choice-exit:${nodeId}:${Object.keys(patch).sort().join(",")}`,
              })
            }
            onAddChoice={addChoice}
            onUpdateChoice={updateChoice}
            onMoveChoice={(nodeId, choiceId, direction) =>
              applyGraphMutation((current) =>
                moveChoiceOption(current, nodeId, choiceId, direction)
              )
            }
            onRemoveChoice={(nodeId, choiceId) =>
              applyGraphMutation((current) => removeChoiceOption(current, nodeId, choiceId))
            }
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
    </main>
  );
}

function CanvasHeader({
  title,
  revision,
  saveState,
  saveError,
  canEdit,
  previewPending,
  publishPending,
  published,
  canPublish,
  publishDisabledReason,
  onPreview,
  onPublish,
  onShowFoundation,
  onTidy,
  assistantOpen,
  agentRunStatus,
  onToggleAssistant,
  onBackNavigate,
}: {
  title: string;
  revision: number;
  saveState: SaveState;
  saveError: string | null;
  canEdit: boolean;
  previewPending: boolean;
  publishPending: boolean;
  published: boolean;
  canPublish: boolean;
  publishDisabledReason: string | null;
  onPreview: () => void;
  onPublish: () => void;
  onShowFoundation: () => void;
  onTidy?: () => void;
  assistantOpen: boolean;
  agentRunStatus: StoryAgentRunStatus | null;
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
      className="h-9 gap-2 rounded-xl bg-white/[0.07] px-3 font-semibold text-white/66 hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed"
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
      <FrostedPanel className="pointer-events-auto flex h-12 min-w-0 items-center gap-3 rounded-[20px] bg-[oklch(0.205_0_0/0.72)] px-2.5 pr-4 shadow-[0_14px_50px_rgba(0,0,0,0.3)] backdrop-blur-[60px]">
        <Link
          href="/story-studio"
          onNavigate={onBackNavigate}
          aria-label={t("back")}
          className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/[0.07] text-white/68 transition hover:bg-white/[0.12] hover:text-white"
        >
          <IconArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="max-w-[420px] truncate text-[15px] font-semibold tracking-[-0.01em]">
              {title}
            </h1>
            <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-white/52 uppercase">
              {t("mode")}
            </span>
          </div>
          <p
            className={cn(
              "mt-0.5 max-w-[520px] truncate text-[11px] text-white/40",
              (saveState === "error" || saveState === "conflict") && "text-[#ff9b9e]"
            )}
            title={saveError ?? undefined}
          >
            {t(`saveState.${saveState}`, { revision })}
          </p>
        </div>
      </FrostedPanel>

      <FrostedPanel className="pointer-events-auto flex h-12 shrink-0 items-center gap-1.5 rounded-[20px] bg-[oklch(0.205_0_0/0.72)] p-1.5 shadow-[0_14px_50px_rgba(0,0,0,0.3)] backdrop-blur-[60px]">
        <button
          type="button"
          aria-pressed={assistantOpen}
          aria-label={
            agentRunStatus === "proposed"
              ? `${t("assistant.action")}: ${t("emptyAgent.agentRun.proposal")}`
              : undefined
          }
          onClick={onToggleAssistant}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
            assistantOpen
              ? "bg-white/[0.14] text-white"
              : "bg-white/[0.07] text-white/66 hover:bg-white/[0.12] hover:text-white"
          )}
        >
          <IconSparkles className="size-4" />
          {t("assistant.action")}
          {agentRunStatus === "proposed" ? (
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-[#9d8cff] shadow-[0_0_10px_rgba(157,140,255,0.88)]"
            />
          ) : null}
        </button>
        <button
          type="button"
          onClick={onShowFoundation}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-white/[0.07] px-3 text-xs font-semibold text-white/66 transition hover:bg-white/[0.12] hover:text-white"
        >
          <IconBook2 className="size-4" />
          {t("world.action")}
        </button>
        {onTidy ? (
          <button
            type="button"
            onClick={onTidy}
            title={t("tidy.action")}
            aria-label={t("tidy.action")}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-white/[0.07] px-3 text-xs font-semibold text-white/66 transition hover:bg-white/[0.12] hover:text-white"
          >
            <IconLayoutGrid className="size-4" />
            {t("tidy.action")}
          </button>
        ) : null}
        {/* Playtest hidden for now — the working-preview flow isn't a good fit
            yet. Re-enable by restoring this button once it's reworked. */}
        {false ? (
          <button
            type="button"
            onClick={onPreview}
            disabled={previewPending}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-white/[0.07] px-3 text-xs font-semibold text-white/66 transition hover:bg-white/[0.12] hover:text-white disabled:cursor-wait disabled:opacity-50"
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
                className="inline-flex rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-white/55 [&>button]:pointer-events-none"
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
          <span className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-3 text-[11px] font-semibold text-black">
            {t("readOnly")}
          </span>
        ) : null}
      </FrostedPanel>
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
  const isRoot = data.kind === "root";
  const isEnding = data.kind === "ending";
  const isDecision = data.kind === "decision";
  const isCharacter = data.kind === "character";
  const productionTarget = data.kind === "root" ? data.trailerVideo : data.clipVideo;
  const { currentVideo, generation, generationActive } = resolveStoryVideoState(productionTarget);
  const currentVideoAsset = currentVideo?.asset;
  const currentVideoSource: StudioVideoSource | undefined = currentVideoAsset?.previewUrl
    ? {
        src: currentVideoAsset.previewUrl,
        type: currentVideoAsset.contentType,
      }
    : undefined;
  const mediaPreview = useMediaHoverPreview({
    ownerId: id,
    enabled: Boolean(currentVideoSource) && !generationActive,
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
          isDecision && "w-[290px]",
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
            generation={generation}
            generationLabel={
              generationActive && generation ? t(`production.statuses.${generation.status}`) : null
            }
            generationFailedLabel={t("production.node.generationFailed")}
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
            data.title ? (
              <h2
                className={cn(
                  CANVAS_NODE_DRAG_HANDLE_CLASS,
                  "-mx-1 truncate rounded px-1 text-[15px] font-semibold text-white/90"
                )}
              >
                {data.title}
              </h2>
            ) : null
          ) : (
            <div
              className={cn(
                CANVAS_NODE_DRAG_HANDLE_CLASS,
                "-mx-1 flex items-start justify-between gap-3 rounded px-1"
              )}
            >
              <div className="min-w-0">
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
          {data.kind === "root" ? (
            <StoryVideoPreview
              source={currentVideoSource}
              interactive={previewFocused}
              frameAspectRatio={data.frameAspectRatio}
              ariaLabel={t("trailer.node.videoPreview")}
              emptyLabel={t("trailer.node.noVideo")}
              generation={generation}
              generationLabel={
                generationActive && generation
                  ? t(`production.statuses.${generation.status}`)
                  : null
              }
              generationFailedLabel={t("production.node.generationFailed")}
              autoPreviewActive={mediaPreview.isAutoPreviewActive}
              manualPlaybackOwned={mediaPreview.isManualPlaybackOwner}
              onManualPlaybackStart={mediaPreview.acquireManualPlayback}
              onManualPlaybackStop={mediaPreview.releaseManualPlayback}
              className="mt-3 rounded-[16px]"
            />
          ) : null}
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
            <div className="mt-3 space-y-1.5">
              {(data.choices ?? []).map((choice) => (
                <div
                  key={choice.choiceId}
                  className="relative flex items-center justify-between gap-3 rounded-xl bg-black/18 px-2.5 py-2 pr-3.5 text-[10px]"
                >
                  <span className="truncate text-white/62">{choice.label}</span>
                  <span className="shrink-0 text-white/28">→ {choice.targetNodeId}</span>
                  <StoryPortHandle
                    id={`choice:${choice.choiceId}`}
                    type="source"
                    position={Position.Right}
                    isConnectable={isConnectable}
                    color={STORY_PORT_COLORS.choice}
                    label={t("ports.choiceOption", { label: choice.label })}
                    className="-right-[23px]!"
                  />
                </div>
              ))}
              {(data.choices?.length ?? 0) < 6 ? (
                <div className="relative flex h-8 items-center rounded-xl bg-[rgba(91,157,255,0.08)] px-2.5 text-[10px] font-semibold text-[#84b7ff]/72">
                  {t("ports.newChoice")}
                  <StoryPortHandle
                    id="choice-new"
                    type="source"
                    position={Position.Right}
                    isConnectable={isConnectable}
                    color={STORY_PORT_COLORS.choice}
                    label={t("ports.newChoice")}
                    className="-right-[23px]!"
                  />
                </div>
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
  generation,
  generationLabel,
  generationFailedLabel,
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
  generation: StoryVideoGeneration | null | undefined;
  generationLabel: string | null;
  generationFailedLabel: string;
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
      {isActiveVideoGeneration(generation) ? (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-black/52 backdrop-blur-[2px]">
          <span className="flex items-center gap-2 rounded-full bg-black/52 px-3 py-2 text-[9px] font-semibold text-white/84 backdrop-blur-md">
            <IconLoader2 className="size-3.5 animate-spin" />
            {generationLabel}
          </span>
        </div>
      ) : generation?.status === "failed" ? (
        <span className="pointer-events-none absolute top-2 right-2 z-40 flex max-w-[70%] items-center gap-1.5 rounded-full bg-black/72 px-2 py-1 text-[8px] font-semibold text-[#ffb2b4] backdrop-blur-md">
          <IconAlertTriangle className="size-3 shrink-0" />
          <span className="truncate">
            {storyGenerationError(generation) ?? generationFailedLabel}
          </span>
        </span>
      ) : null}
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

function mergeSaveStates(draft: SaveState, layout: SaveState): SaveState {
  const priority: Record<SaveState, number> = {
    idle: 0,
    saved: 1,
    dirty: 2,
    saving: 3,
    error: 4,
    conflict: 5,
  };
  return priority[layout] > priority[draft] ? layout : draft;
}
