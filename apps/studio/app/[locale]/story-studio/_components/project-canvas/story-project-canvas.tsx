"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  IconCheck,
  IconFocusCentered,
  IconGitBranch,
  IconLayoutDashboard,
  IconLoader2,
  IconMovie,
  IconPlayerPlay,
  IconRefresh,
  IconRoute,
  IconSparkles,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useWorkspace } from "@/app/_components/workspace-context";
import { Button } from "@/components/ui/button";
import { CanvasControls } from "@/components/canvas/canvas-controls";
import { CanvasNativePointerOwner } from "@/components/canvas/canvas-native-pointer-owner";
import { CanvasReactFlow, type CanvasReactFlowProps } from "@/components/canvas/canvas-react-flow";
import { CANVAS_NODE_DRAG_HANDLE_CLASS } from "@/components/canvas/canvas-interaction-policy";
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
import { Link } from "@/i18n/navigation";
import { canonicalJsonString } from "@/lib/canonical-json";
import { cn } from "@/lib/utils";
import {
  canvasLayoutRevisionConflict,
  createFilmClipGeneration,
  createFilmTrailerGeneration,
  draftRevisionConflict,
  getStoryCanvasLayout,
  getStoryWorkingPreview,
  getStoryWorkbench,
  prepareFilmClip,
  putFilmClipCurrentVideo,
  putStoryCanvasLayout,
  putStoryDraft,
  putFilmClipReferences,
  putFilmTrailerCurrentVideo,
  putFilmTrailerReferences,
  storyApiErrorMessage,
  type CanvasLayoutRevisionConflict,
  type DraftRevisionConflict,
  type InteractiveFilmDraftContent,
  type FilmVideoGeneration,
  type StoryVideoLibraryItem,
  type StoryCanvasPosition,
  type StoryWorkingPreview,
  type StoryWorkbench,
} from "@/lib/story-projects-api";
import {
  STORY_ROOT_NODE_ID,
  buildStoryCanvasModel,
  normalizeStoryClipPromptDrafts,
  syntheticDecisionNodeId,
  syntheticEndingNodeId,
  type StoryCanvasEdge,
  type StoryCanvasNode,
} from "./story-project-canvas-model";
import {
  nextStoryCanvasFocusedNodeId,
  reconcileStoryCanvasSelectedIds,
} from "./story-project-canvas-selection";
import {
  coalesceQueuedLayout,
  layoutPositionSignature,
  layoutRetryDelay,
  selectLatestLayoutPayload,
} from "./story-canvas-layout-retry";
import { createConnectedClipForBlankDrop } from "./story-project-canvas-drop";
import {
  addChoiceOption,
  connectClipContinuation,
  connectAutoRoute,
  connectChoiceTarget,
  convertClipExitToCheckpoint,
  convertClipExitToChoice,
  convertClipExitToEnding,
  convertExitToAuto,
  createClipNode,
  createEndingNode,
  createRouterNode,
  createTrailerPrompt,
  deleteEndingNode,
  deleteGraphNode,
  disconnectAutoRoute,
  disconnectStoryBranch,
  duplicateClipNode,
  duplicateRouterNode,
  moveChoiceOption,
  removeChoiceOption,
  replaceClipPrompt,
  replaceTrailerPrompt,
  setClipPromptTargetDuration,
  setEntryNode,
  updateChoiceExit,
  updateChoiceOption,
  updateCheckpointTarget,
  updateAutoRoute,
  updateAutoRouteTarget,
  updateEndingNode,
} from "./story-project-canvas-mutations";
import {
  StoryConnectionCreator,
  type StoryConnectionCreationKind,
} from "./story-connection-creator";
import { StoryNodeCreator, type StoryNodeCreationKind } from "./story-node-creator";
import type { StoryReferenceBindingInput } from "./story-clip-reference-bindings-model";
import { StoryNodeInspector } from "./story-node-inspector";
import { StoryShotComposer, type StoryVideoComposerProps } from "./story-shot-composer";
import {
  projectLockedTrailerPrompt,
  StoryProductionActionGate,
  StorySubmissionKeyRegistry,
} from "./story-trailer-production-model";
import {
  addWorldTextItem,
  createStoryCharacter,
  createStoryStateVariable,
  deleteStoryCharacter,
  deleteStoryStateVariable,
  removeWorldTextItem,
  replaceStoryStateVariable,
  updateStoryCharacter,
  updateWorldTextItem,
  type StoryWorldTextField,
} from "./story-world-mutations";
import { StoryDraftSnapshotCoordinator } from "./story-draft-snapshot-coordinator";
import { shouldPrepareStoryClip, StoryClipPreparationGate } from "./story-clip-preparation-gate";
import { StoryWorkingPreviewDialog } from "./story-working-preview-dialog";
import {
  filmGenerationError,
  isActiveVideoGeneration,
  resolveStoryVideoState,
  workbenchHasActiveGeneration,
} from "./story-video-state";
import {
  projectConfirmedClipCurrentVideo,
  projectConfirmedTrailerCurrentVideo,
} from "./story-workbench-current-video";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
type FoundationField = "logline" | "synopsis" | "worldview";
type PersistDraftOptions = {
  bypassSnapshotBarrier?: boolean;
  propagateError?: boolean;
};
type StoryClipGenerationRequest = {
  requestId: string;
  graphNodeId: string;
  variationNote?: string;
  modelId?: string;
};
type StoryClipPreparationUiState = {
  attemptKey: string;
  status: "preparing" | "error";
  error: string | null;
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
  route: "#e0a45c",
  ending: "#E52227",
} as const;
const STORY_REFERENCE_API_CONNECTED = true;

type StoryProductionUiContextValue = {
  graphNodeId: string;
  composer: StoryVideoComposerProps;
};

type StoryTrailerUiContextValue = {
  composer: StoryVideoComposerProps | null;
};

const StoryProductionUiContext = createContext<StoryProductionUiContextValue | null>(null);
const StoryTrailerUiContext = createContext<StoryTrailerUiContextValue | null>(null);
const StoryCanvasFocusContext = createContext<string | null>(null);

function StoryCanvasReactFlow(props: CanvasReactFlowProps<StoryCanvasNode, StoryCanvasEdge>) {
  const interruptHoverPreview = useMediaHoverPreviewInterruption();
  return <CanvasReactFlow {...props} onInteractionStart={interruptHoverPreview} />;
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
  const interfaceLocale = useLocale();
  const { fitView, screenToFlowPosition } = useReactFlow<StoryCanvasNode, StoryCanvasEdge>();
  const queryClient = useQueryClient();
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const [content, setContent] = useState<InteractiveFilmDraftContent | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [pendingCompletionDrop, setPendingCompletionDrop] = useState<PendingCompletionDrop | null>(
    null
  );
  const [graphError, setGraphError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<DraftRevisionConflict | null>(null);
  const [layoutConflict, setLayoutConflict] = useState<CanvasLayoutRevisionConflict | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const [layoutSaveState, setLayoutSaveState] = useState<SaveState>("idle");
  const [layoutSaveError, setLayoutSaveError] = useState<string | null>(null);
  const [productionPendingKey, setProductionPendingKey] = useState<string | null>(null);
  const [productionError, setProductionError] = useState<string | null>(null);
  const [clipPreparationStates, setClipPreparationStates] = useState<
    Record<string, StoryClipPreparationUiState>
  >({});
  const [clipGenerationRequest, setClipGenerationRequest] =
    useState<StoryClipGenerationRequest | null>(null);
  const [workingPreviewOpen, setWorkingPreviewOpen] = useState(false);
  const [workingPreviewPending, setWorkingPreviewPending] = useState(false);
  const [workingPreviewError, setWorkingPreviewError] = useState<string | null>(null);
  const [workingPreview, setWorkingPreview] = useState<StoryWorkingPreview | null>(null);
  const [productionActionGate] = useState(() => new StoryProductionActionGate());
  const [draftSnapshotCoordinator] = useState(() => new StoryDraftSnapshotCoordinator());
  const [clipPreparationGate] = useState(() => new StoryClipPreparationGate());
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
  const hydratedRef = useRef(false);
  const revisionRef = useRef(0);
  const savedSignatureRef = useRef("");
  const latestContentRef = useRef<InteractiveFilmDraftContent | null>(null);
  const conflictRef = useRef<DraftRevisionConflict | null>(null);
  const disposedRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const inFlightSignatureRef = useRef<string | null>(null);
  const inFlightContentRef = useRef<InteractiveFilmDraftContent | null>(null);
  const queuedContentRef = useRef<InteractiveFilmDraftContent | null>(null);
  const recoveryContentRef = useRef<InteractiveFilmDraftContent | null>(null);
  const saveDebounceTimerRef = useRef<number | null>(null);
  const saveRetryTimerRef = useRef<number | null>(null);
  const saveRetryAttemptRef = useRef(0);
  const finalFlushActiveRef = useRef(false);
  const finalFlushGenerationRef = useRef(0);
  const persistRef = useRef<
    (next: InteractiveFilmDraftContent, options?: PersistDraftOptions) => Promise<void>
  >(async () => {});
  const saveSettledWaitersRef = useRef(new Set<() => void>());
  const draftSnapshotBarrierRef = useRef(false);
  const layoutHydratedRef = useRef(false);
  const layoutRevisionRef = useRef(0);
  const layoutSavedSignatureRef = useRef("");
  const layoutConflictRef = useRef<CanvasLayoutRevisionConflict | null>(null);
  const layoutSaveInFlightRef = useRef(false);
  const layoutInFlightSignatureRef = useRef<string | null>(null);
  const queuedLayoutRef = useRef<Record<string, StoryCanvasPosition> | null>(null);
  const recoveryLayoutRef = useRef<Record<string, StoryCanvasPosition> | null>(null);
  const layoutRetryTimerRef = useRef<number | null>(null);
  const layoutRetryAttemptRef = useRef(0);
  const persistLayoutRef = useRef<(next: Record<string, StoryCanvasPosition>) => Promise<void>>(
    async () => {}
  );
  const canvasNodesRef = useRef<StoryCanvasNode[]>([]);
  const pendingCanvasSelectionRef = useRef<string | null>(null);
  const requestedCanvasFocusRef = useRef<string | null>(null);
  const marqueeSelectionActiveRef = useRef(false);
  const latestCanvasSelectionRef = useRef<string[]>([]);
  const pendingNodePositionsRef = useRef(new Map<string, StoryCanvasPosition>());

  const onCanvasNodesChange = useCallback(
    (changes: NodeChange<StoryCanvasNode>[]) => {
      setCanvasNodes((current) => {
        const next = applyNodeChanges(changes, current);
        canvasNodesRef.current = next;
        return next;
      });
    },
    [setCanvasNodes]
  );

  const selectCanvasNodeExclusively = useCallback(
    (nodeId: string | null) => {
      pendingCanvasSelectionRef.current = nodeId;
      requestedCanvasFocusRef.current = null;
      setFocusedNodeId(nodeId);
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
    setFocusedNodeId((current) =>
      nextStoryCanvasFocusedNodeId(current, selectedNodeIds, preferredNodeId)
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

  const workbenchQuery = useQuery({
    queryKey: ["story-studio", "workbench", workspaceId, projectId],
    queryFn: () => getStoryWorkbench(workspaceId as string, projectId),
    enabled: Boolean(workspaceId),
    retry: false,
    refetchInterval: (query) => (workbenchHasActiveGeneration(query.state.data) ? 2_000 : false),
  });
  const refetchWorkbench = workbenchQuery.refetch;
  const layoutQuery = useQuery({
    queryKey: ["story-studio", "canvas-layout", workspaceId, projectId],
    queryFn: () => getStoryCanvasLayout(workspaceId as string, projectId),
    enabled: Boolean(workspaceId),
    retry: false,
  });
  const project = workbenchQuery.data?.project ?? null;
  const film = workbenchQuery.data?.film ?? null;
  const selectedRevision = workbenchQuery.data?.selectedRevision ?? null;
  const selectedRevisionId = film?.spec?.revisionId ?? null;
  const currentDraftProductionRevisionId =
    (saveState === "idle" || saveState === "saved") &&
    selectedRevision?.sourceDraftRevision === draftRevision
      ? selectedRevisionId
      : null;

  const cacheSavedDraft = useCallback(
    (saved: StoryWorkbench["draft"]) => {
      if (!workspaceId) return;
      queryClient.setQueryData<StoryWorkbench>(
        ["story-studio", "workbench", workspaceId, projectId],
        (current) =>
          current && saved.revision >= current.draft.revision
            ? { ...current, draft: saved }
            : current
      );
    },
    [projectId, queryClient, workspaceId]
  );

  useEffect(() => {
    if (!workbenchQuery.data) return;
    const workbench = workbenchQuery.data;
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
    const normalizedContent = normalizeStoryClipPromptDrafts(workbench.draft.content);
    savedSignatureRef.current = canonicalJsonString(workbench.draft.content);
    latestContentRef.current = normalizedContent;
    setContent(normalizedContent);
    setSaveState("idle");
  }, [workbenchQuery.data]);

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
    async (next: InteractiveFilmDraftContent, options: PersistDraftOptions = {}) => {
      if (!workspaceId || conflictRef.current || disposedRef.current) return;
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
          recoveryContentRef.current = null;
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

  const loadWorkingPreview = useCallback(async () => {
    if (!workspaceId) return;
    setWorkingPreviewOpen(true);
    setWorkingPreviewPending(true);
    setWorkingPreviewError(null);
    try {
      const preview = await withSavedDraftSnapshot((expectedDraftRevision) =>
        getStoryWorkingPreview(workspaceId, projectId, expectedDraftRevision)
      );
      if (!disposedRef.current) setWorkingPreview(preview);
    } catch (error) {
      if (!disposedRef.current) {
        setWorkingPreviewError(storyApiErrorMessage(error, t("workingPreview.errorFallback")));
      }
    } finally {
      if (!disposedRef.current) setWorkingPreviewPending(false);
    }
  }, [projectId, t, withSavedDraftSnapshot, workspaceId]);

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
  }, [clearSaveRetry, conflict, content]);

  const flushDraftBeforeLeaving = useCallback(
    (keepalive: boolean) => {
      if (
        !workspaceId ||
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

      const saveOnce = async (next: InteractiveFilmDraftContent, expected: number) => {
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
        next: InteractiveFilmDraftContent,
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
            recoveryContentRef.current = null;
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
    [cacheSavedDraft, clearSaveRetry, commonT, projectId, scheduleSaveRetry, sessionId, workspaceId]
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
      flushDraftBeforeLeaving(keepalive);
    };
    const hasUnsavedContent = () => {
      const latest = latestContentRef.current;
      return Boolean(
        recoveryContentRef.current ||
        saveInFlightRef.current ||
        (latest && canonicalJsonString(latest) !== savedSignatureRef.current)
      );
    };
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedContent()) return;
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
      finalFlushGenerationRef.current += 1;
      finalFlushActiveRef.current = false;
      clearSaveRetry();
      const recovery = recoveryContentRef.current;
      const latest = latestContentRef.current;
      if (recovery) {
        queuedContentRef.current =
          latest && canonicalJsonString(latest) !== canonicalJsonString(recovery) ? latest : null;
        if (!saveInFlightRef.current) void persistRef.current(recovery);
      } else if (latest && canonicalJsonString(latest) !== savedSignatureRef.current) {
        void persistRef.current(latest);
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
  }, [clearSaveRetry, flushDraftBeforeLeaving]);

  const projectionCopy = {
    rootTitle: t("projection.rootTitle"),
    rootEyebrow: t("projection.rootEyebrow"),
    rootSummary: t("projection.rootSummary"),
    clip: t("projection.clip"),
    decision: t("projection.decision"),
    router: t("projection.router"),
    ending: t("projection.ending"),
  };
  const model = useMemo(
    () =>
      content
        ? buildStoryCanvasModel(
            content,
            project?.defaultLocale ?? "en-US",
            film?.clips ?? [],
            projectionCopy,
            project?.frameProfile,
            film?.trailer ?? null
          )
        : null,
    // Translation values are primitives. Depending on them keeps the model
    // stable across ordinary renders while still refreshing after a locale change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      content,
      film?.clips,
      film?.trailer,
      project?.defaultLocale,
      project?.frameProfile,
      projectionCopy.rootTitle,
      projectionCopy.rootEyebrow,
      projectionCopy.rootSummary,
      projectionCopy.clip,
      projectionCopy.decision,
      projectionCopy.router,
      projectionCopy.ending,
    ]
  );
  const canEdit = Boolean(
    !conflict && project?.status === "active" && project.capabilities.includes("story.edit")
  );

  useEffect(() => {
    canvasNodesRef.current = canvasNodes;
  }, [canvasNodes]);

  useEffect(() => {
    if (!model || !layoutQuery.data) return;
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
      setFocusedNodeId((current) => nextStoryCanvasFocusedNodeId(current, nextSelectedNodeIds));
    };

    if (!layoutHydratedRef.current) {
      const initialNodes = model.nodes.map((node) => ({
        ...node,
        position: layoutQuery.data.nodePositions[node.id] ?? node.position,
        selected: selectedNodeIds.has(node.id),
      }));
      layoutHydratedRef.current = true;
      layoutRevisionRef.current = layoutQuery.data.revision;
      layoutSavedSignatureRef.current = layoutPositionSignature(nodePositions(initialNodes));
      setLayoutSaveState("idle");
      canvasNodesRef.current = initialNodes;
      setCanvasNodes(initialNodes);
      reconcileFocusAfterModel(initialNodes);
      return;
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
          currentById.get(node.id)?.position ??
          layoutQuery.data.nodePositions[node.id] ??
          node.position,
      };
    });
    placedNodeIds.forEach((nodeId) => pendingNodePositionsRef.current.delete(nodeId));
    canvasNodesRef.current = nextNodes;
    setCanvasNodes(nextNodes);
    reconcileFocusAfterModel(nextNodes);
    if (placedNodeIds.length > 0) {
      const positions = nodePositions(nextNodes);
      setLayoutSaveState("dirty");
      void persistLayoutRef.current(positions);
    }
  }, [layoutQuery.data, model, setCanvasNodes]);

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
        void persistLayoutRef.current(recovery);
      }
    }, delay);
  }, []);

  const persistLayout = useCallback(
    async (next: Record<string, StoryCanvasPosition>) => {
      if (!workspaceId || layoutConflictRef.current) return;
      const signature = layoutPositionSignature(next);
      if (layoutSaveInFlightRef.current) {
        queuedLayoutRef.current = coalesceQueuedLayout(layoutInFlightSignatureRef.current, next);
        recoveryLayoutRef.current = next;
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
      layoutInFlightSignatureRef.current = signature;
      setLayoutSaveState("saving");
      setLayoutSaveError(null);
      let requestFailed = false;
      let requestConflicted = false;
      try {
        const saved = await putStoryCanvasLayout(workspaceId, projectId, {
          expectedRevision: layoutRevisionRef.current,
          nodePositions: next,
          sessionId,
        });
        layoutRevisionRef.current = saved.revision;
        layoutSavedSignatureRef.current = signature;
        recoveryLayoutRef.current = null;
        clearLayoutSaveRetry(true);
        setLayoutSaveState("saved");
      } catch (error) {
        const nextConflict = canvasLayoutRevisionConflict(error);
        if (nextConflict) {
          requestConflicted = true;
          layoutConflictRef.current = nextConflict;
          queuedLayoutRef.current = null;
          recoveryLayoutRef.current = null;
          clearLayoutSaveRetry(true);
          setLayoutConflict(nextConflict);
          setLayoutSaveState("conflict");
        } else {
          requestFailed = true;
          recoveryLayoutRef.current = next;
          setLayoutSaveState("error");
          setLayoutSaveError(storyApiErrorMessage(error, commonT("errors.generic")));
        }
      } finally {
        layoutSaveInFlightRef.current = false;
        layoutInFlightSignatureRef.current = null;
        const queued = queuedLayoutRef.current;
        queuedLayoutRef.current = null;
        if (!requestConflicted) {
          if (queued) {
            recoveryLayoutRef.current = selectLatestLayoutPayload(next, queued);
            void persistLayoutRef.current(queued);
          } else if (requestFailed) {
            scheduleLayoutSaveRetry();
          }
        }
      }
    },
    [clearLayoutSaveRetry, commonT, projectId, scheduleLayoutSaveRetry, sessionId, workspaceId]
  );

  useEffect(() => {
    persistLayoutRef.current = persistLayout;
  }, [persistLayout]);

  useEffect(() => () => clearLayoutSaveRetry(), [clearLayoutSaveRetry]);

  const focusedNode = useMemo(
    () => model?.nodes.find((node) => node.id === focusedNodeId) ?? null,
    [focusedNodeId, model?.nodes]
  );
  const focusedFilmClip =
    focusedNode?.data.kind === "clip" ? (focusedNode.data.filmClip ?? null) : null;
  const focusedDirectorPrompt =
    focusedNode?.data.kind === "clip" ? (focusedNode.data.directorPrompt ?? null) : null;
  const focusedGraphNodeId = focusedNode?.data.kind === "clip" ? focusedNode.data.nodeId : null;
  const currentFocusedFilmClip = currentDraftProductionRevisionId ? focusedFilmClip : null;

  const refreshProduction = useCallback(async () => {
    await workbenchQuery.refetch();
  }, [workbenchQuery]);

  useEffect(() => {
    if (!workspaceId) return;
    if (
      !shouldPrepareStoryClip({
        graphNodeId: focusedGraphNodeId,
        hasMaterializedClip: Boolean(currentFocusedFilmClip),
        masterDirection: focusedDirectorPrompt?.masterDirection ?? null,
        canGenerate: Boolean(project?.capabilities.includes("story.generate")),
        draftSettled: saveState === "idle" || saveState === "saved",
        draftRevision,
      })
    ) {
      return;
    }

    const graphNodeId = focusedGraphNodeId as string;
    const triggerKey = canonicalJsonString({ draftRevision, modelId: null });
    let scheduled = true;

    queueMicrotask(() => {
      if (!scheduled || !clipPreparationGate.tryStart(graphNodeId, triggerKey)) return;
      let activeKey = triggerKey;
      setClipPreparationStates((current) => ({
        ...current,
        [graphNodeId]: { attemptKey: activeKey, status: "preparing", error: null },
      }));

      void withSavedDraftSnapshot((expectedDraftRevision) => {
        const exactKey = canonicalJsonString({
          draftRevision: expectedDraftRevision,
          modelId: null,
        });
        if (exactKey !== activeKey) {
          const previousKey = activeKey;
          if (clipPreparationGate.rekey(graphNodeId, previousKey, exactKey)) {
            activeKey = exactKey;
            if (!disposedRef.current) {
              setClipPreparationStates((current) =>
                current[graphNodeId]?.attemptKey === previousKey
                  ? {
                      ...current,
                      [graphNodeId]: {
                        attemptKey: exactKey,
                        status: "preparing",
                        error: null,
                      },
                    }
                  : current
              );
            }
          }
        }
        return prepareFilmClip(workspaceId, projectId, graphNodeId, {
          expectedDraftRevision,
        });
      })
        .then(async () => {
          await refetchWorkbench();
          clipPreparationGate.settle(graphNodeId, activeKey, "succeeded");
          if (disposedRef.current) return;
          setClipPreparationStates((current) => {
            if (current[graphNodeId]?.attemptKey !== activeKey) return current;
            const next = { ...current };
            delete next[graphNodeId];
            return next;
          });
        })
        .catch((error: unknown) => {
          clipPreparationGate.settle(graphNodeId, activeKey, "failed");
          if (disposedRef.current) return;
          setClipPreparationStates((current) =>
            current[graphNodeId]?.attemptKey === activeKey
              ? {
                  ...current,
                  [graphNodeId]: {
                    attemptKey: activeKey,
                    status: "error",
                    error: storyApiErrorMessage(error, t("production.errors.prepare")),
                  },
                }
              : current
          );
        });
    });

    return () => {
      scheduled = false;
    };
  }, [
    clipPreparationGate,
    currentFocusedFilmClip,
    draftRevision,
    project?.capabilities,
    projectId,
    refetchWorkbench,
    saveState,
    focusedDirectorPrompt?.masterDirection,
    focusedGraphNodeId,
    t,
    withSavedDraftSnapshot,
    workspaceId,
  ]);

  const runProductionAction = useCallback(
    async (key: string, action: () => Promise<unknown>): Promise<boolean> => {
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
          // Draft generation can materialize the current production snapshot
          // before precise reference validation fails. Refresh so the creator
          // can immediately resolve those reference slots without reloading.
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
    [productionActionGate, refreshProduction, t]
  );

  const generateSelectedClip = useCallback(
    (variationNote?: string, modelId?: string) => {
      if (!focusedGraphNodeId) return;
      setClipPreparationStates((current) => {
        if (!current[focusedGraphNodeId]) return current;
        const next = { ...current };
        delete next[focusedGraphNodeId];
        return next;
      });
      setClipGenerationRequest({
        requestId: globalThis.crypto.randomUUID(),
        graphNodeId: focusedGraphNodeId,
        variationNote,
        modelId,
      });
    },
    [focusedGraphNodeId]
  );

  useEffect(() => {
    if (!workspaceId || !clipGenerationRequest) return;
    const request = clipGenerationRequest;
    const slot = `clip:create:${request.graphNodeId}`;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      void runProductionAction("generate", () =>
        withSavedDraftSnapshot((expectedDraftRevision) => {
          const fingerprint = canonicalJsonString({
            graphNodeId: request.graphNodeId,
            expectedDraftRevision,
            modelId: request.modelId ?? null,
            variationNote: request.variationNote?.trim() || null,
          });
          const idempotencyKey = productionSubmissionKeys.keyFor(slot, fingerprint, () =>
            globalThis.crypto.randomUUID()
          );
          return createFilmClipGeneration(
            workspaceId,
            projectId,
            request.graphNodeId,
            {
              expectedDraftRevision,
              modelId: request.modelId,
              variationNote: request.variationNote,
            },
            idempotencyKey
          ).then((generation) => {
            productionSubmissionKeys.confirm(slot, fingerprint);
            return generation;
          });
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
    clipGenerationRequest,
    productionSubmissionKeys,
    projectId,
    runProductionAction,
    withSavedDraftSnapshot,
    workspaceId,
  ]);

  const updateSelectedReferenceBindings = useCallback(
    (bindings: StoryReferenceBindingInput[]) => {
      if (
        !STORY_REFERENCE_API_CONNECTED ||
        !workspaceId ||
        !currentDraftProductionRevisionId ||
        !currentFocusedFilmClip ||
        !film
      ) {
        return;
      }
      void runProductionAction("reference-bindings", () =>
        putFilmClipReferences(
          workspaceId,
          projectId,
          currentDraftProductionRevisionId,
          currentFocusedFilmClip.id,
          {
            expectedClipVersion: currentFocusedFilmClip.version,
            expectedProductionRevision: film.productionRevision,
            bindings,
          }
        )
      );
    },
    [
      currentDraftProductionRevisionId,
      currentFocusedFilmClip,
      film,
      projectId,
      runProductionAction,
      workspaceId,
    ]
  );

  const clipGenerationActive = isActiveVideoGeneration(currentFocusedFilmClip?.generation);
  const productionDisabledReason = !project?.capabilities.includes("story.generate")
    ? t("production.disabled.permission")
    : !focusedDirectorPrompt?.masterDirection.trim()
      ? t("production.disabled.promptRequired")
      : clipGenerationActive
        ? t("production.disabled.generating")
        : null;
  const selectExistingClipVideo = useCallback(
    async (item: StoryVideoLibraryItem) => {
      if (!workspaceId || !focusedGraphNodeId || !currentFocusedFilmClip) {
        throw new Error(t("production.errors.action"));
      }
      const confirmedClip = await withSavedDraftSnapshot((expectedDraftRevision) =>
        putFilmClipCurrentVideo(workspaceId, projectId, focusedGraphNodeId, {
          expectedDraftRevision,
          expectedCurrentVideoRevision: currentFocusedFilmClip.currentVideoRevision,
          assetId: item.asset.id,
          variantId: item.variantId,
        })
      );
      queryClient.setQueryData<StoryWorkbench>(
        ["story-studio", "workbench", workspaceId, projectId],
        (current) => projectConfirmedClipCurrentVideo(current, confirmedClip)
      );
      void refetchWorkbench();
    },
    [
      currentFocusedFilmClip,
      focusedGraphNodeId,
      projectId,
      queryClient,
      refetchWorkbench,
      t,
      withSavedDraftSnapshot,
      workspaceId,
    ]
  );
  const selectedClipPreparation =
    focusedGraphNodeId && !currentFocusedFilmClip
      ? (clipPreparationStates[focusedGraphNodeId] ?? null)
      : null;
  const productionComposer: StoryVideoComposerProps | null =
    focusedNode?.data.kind === "clip" && focusedDirectorPrompt
      ? {
          clip: currentFocusedFilmClip,
          prompt: focusedDirectorPrompt,
          references: film?.references ?? [],
          defaultModel: film?.defaultModel,
          frameProfile: project?.frameProfile ?? "landscape_16_9",
          canGenerate: productionDisabledReason === null,
          disabledReason: productionDisabledReason,
          preparingInputs: selectedClipPreparation?.status === "preparing",
          pendingKey: productionPendingKey ?? (clipGenerationActive ? "generate" : null),
          error:
            productionError ??
            selectedClipPreparation?.error ??
            filmGenerationError(currentFocusedFilmClip?.generation),
          onGenerate: generateSelectedClip,
          onModeChange: (mode) => {
            if (!focusedGraphNodeId || !focusedDirectorPrompt) return;
            const nextControl =
              mode === "omni_reference"
                ? ({ mode: "omni_reference" } as const)
                : ({ mode: "frame_lock", frameMode: "first_last_frame" } as const);
            if (
              JSON.stringify(nextControl) ===
              JSON.stringify(focusedDirectorPrompt.generationControl)
            ) {
              return;
            }
            applyGraphMutation((current) =>
              replaceClipPrompt(current, focusedGraphNodeId, {
                ...focusedDirectorPrompt,
                generationControl: nextControl,
              })
            );
          },
          onPromptCommit: (next) => {
            if (
              !focusedGraphNodeId ||
              !focusedDirectorPrompt ||
              next === focusedDirectorPrompt.masterDirection
            ) {
              return;
            }
            applyGraphMutation((current) =>
              replaceClipPrompt(current, focusedGraphNodeId, {
                ...focusedDirectorPrompt,
                masterDirection: next,
              })
            );
          },
          onDurationCommit: (durationMs) => {
            if (!focusedGraphNodeId || !focusedDirectorPrompt) return;
            applyGraphMutation((current) =>
              replaceClipPrompt(
                current,
                focusedGraphNodeId,
                setClipPromptTargetDuration(focusedDirectorPrompt, durationMs)
              )
            );
          },
          maxDurationMs: film?.spec?.duration.maxGeneratedClipMs,
          referenceApiConnected: STORY_REFERENCE_API_CONNECTED,
          referenceBindingsPending: productionPendingKey === "reference-bindings",
          onUpdateReferenceBindings: updateSelectedReferenceBindings,
          videoLibrary:
            workspaceId && currentFocusedFilmClip
              ? {
                  workspaceId,
                  projectId,
                  disabled: !project?.capabilities.includes("story.generate"),
                  disabledReason: !project?.capabilities.includes("story.generate")
                    ? t("production.disabled.permission")
                    : null,
                  onSelect: selectExistingClipVideo,
                }
              : undefined,
        }
      : null;
  /* eslint-disable react-hooks/refs -- the composer's commit closures reach
     latestContentRef only inside event handlers; these objects carry no ref
     reads at render time. */
  const productionUi: StoryProductionUiContextValue | null =
    focusedGraphNodeId && productionComposer
      ? { graphNodeId: focusedGraphNodeId, composer: productionComposer }
      : null;
  const inspectorProduction = productionComposer ?? undefined;
  /* eslint-enable react-hooks/refs */
  const focusedIsRoot = focusedNode?.data.kind === "root";
  const selectedTrailer =
    focusedIsRoot && currentDraftProductionRevisionId ? (film?.trailer ?? null) : null;

  const refreshTrailerProduction = useCallback(async () => {
    await workbenchQuery.refetch();
  }, [workbenchQuery]);

  const runTrailerAction = useCallback(
    async (key: string, action: () => Promise<unknown>): Promise<boolean> => {
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
    [refreshTrailerProduction, t, trailerActionGate]
  );

  const canGenerateTrailer = Boolean(project?.capabilities.includes("story.generate"));

  const generateTrailer = useCallback(
    (variationNote?: string, modelId?: string) => {
      if (!workspaceId || !selectedRevisionId || !selectedTrailer || !canGenerateTrailer) return;
      const slot = `trailer:create:${selectedTrailer.id}`;
      const fingerprint = canonicalJsonString({
        trailerId: selectedTrailer.id,
        trailerVersion: selectedTrailer.version,
        modelId: modelId ?? null,
        variationNote: variationNote?.trim() || null,
      });
      const idempotencyKey = trailerSubmissionKeys.keyFor(slot, fingerprint, () =>
        globalThis.crypto.randomUUID()
      );
      void runTrailerAction("generate", () =>
        createFilmTrailerGeneration(
          workspaceId,
          projectId,
          selectedRevisionId,
          {
            expectedTrailerVersion: selectedTrailer.version,
            modelId,
            variationNote,
          },
          idempotencyKey
        ).then((generation) => {
          trailerSubmissionKeys.confirm(slot, fingerprint);
          return generation;
        })
      );
    },
    [
      canGenerateTrailer,
      projectId,
      runTrailerAction,
      selectedRevisionId,
      selectedTrailer,
      trailerSubmissionKeys,
      workspaceId,
    ]
  );

  const updateTrailerReferenceBindings = useCallback(
    (bindings: StoryReferenceBindingInput[]) => {
      if (!workspaceId || !selectedRevisionId || !selectedTrailer) return;
      void runTrailerAction("reference-bindings", () =>
        putFilmTrailerReferences(workspaceId, projectId, selectedRevisionId, {
          expectedTrailerVersion: selectedTrailer.version,
          bindings,
        })
      );
    },
    [projectId, runTrailerAction, selectedRevisionId, selectedTrailer, workspaceId]
  );

  const trailerGenerationActive = isActiveVideoGeneration(selectedTrailer?.generation);
  const trailerDisabledReason = !canGenerateTrailer
    ? t("trailer.production.disabled.permission")
    : trailerGenerationActive
      ? t("production.disabled.generating")
      : null;
  const selectExistingTrailerVideo = useCallback(
    async (item: StoryVideoLibraryItem) => {
      if (!workspaceId || !selectedRevisionId || !selectedTrailer) {
        throw new Error(t("trailer.production.errors.action"));
      }
      const confirmedTrailer = await putFilmTrailerCurrentVideo(
        workspaceId,
        projectId,
        selectedRevisionId,
        {
          expectedCurrentVideoRevision: selectedTrailer.currentVideoRevision,
          assetId: item.asset.id,
          variantId: item.variantId,
        }
      );
      queryClient.setQueryData<StoryWorkbench>(
        ["story-studio", "workbench", workspaceId, projectId],
        (current) => projectConfirmedTrailerCurrentVideo(current, confirmedTrailer)
      );
      void refetchWorkbench();
    },
    [projectId, queryClient, refetchWorkbench, selectedRevisionId, selectedTrailer, t, workspaceId]
  );
  // Like productionUi, this stays a plain per-render object: the composer
  // closures reach through applyGraphMutation, which the hooks lint forbids
  // inside memoized values that are read during render.
  const trailerUi: StoryTrailerUiContextValue | null =
    focusedIsRoot && selectedTrailer
      ? {
          composer: {
            subject: "trailer",
            clip: selectedTrailer,
            prompt: content?.trailerPrompt ?? projectLockedTrailerPrompt(selectedTrailer),
            references: film?.references ?? [],
            defaultModel: film?.defaultModel,
            frameProfile: project?.frameProfile ?? "landscape_16_9",
            canGenerate: trailerDisabledReason === null,
            disabledReason: trailerDisabledReason,
            pendingKey: trailerPendingKey ?? (trailerGenerationActive ? "generate" : null),
            error: trailerError ?? filmGenerationError(selectedTrailer.generation),
            onGenerate: generateTrailer,
            onPromptCommit: (next: string) => {
              const base = content?.trailerPrompt ?? projectLockedTrailerPrompt(selectedTrailer);
              if (!base || next === base.masterDirection) return;
              applyGraphMutation((current) =>
                replaceTrailerPrompt(current, {
                  ...(current.trailerPrompt ?? base),
                  masterDirection: next,
                })
              );
            },
            onDurationCommit: (durationMs: number) => {
              const base = content?.trailerPrompt ?? projectLockedTrailerPrompt(selectedTrailer);
              if (!base) return;
              applyGraphMutation((current) =>
                replaceTrailerPrompt(
                  current,
                  setClipPromptTargetDuration(current.trailerPrompt ?? base, durationMs)
                )
              );
            },
            maxDurationMs: film?.spec?.duration.maxGeneratedClipMs,
            referenceApiConnected: STORY_REFERENCE_API_CONNECTED,
            referenceBindingsPending: trailerPendingKey === "reference-bindings",
            onUpdateReferenceBindings: updateTrailerReferenceBindings,
            videoLibrary:
              workspaceId && selectedTrailer
                ? {
                    workspaceId,
                    projectId,
                    disabled: !canGenerateTrailer,
                    disabledReason: !canGenerateTrailer
                      ? t("trailer.production.disabled.permission")
                      : null,
                    onSelect: selectExistingTrailerVideo,
                  }
                : undefined,
          },
        }
      : null;
  const inspectorTrailerProduction = trailerUi?.composer ?? undefined;
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
        const sourceKind = model?.nodes.find((node) => node.id === edge.source)?.data.kind;
        return {
          ...edge,
          zIndex: related ? 2 : 0,
          style: {
            ...DEFAULT_EDGE_OPTIONS.style,
            opacity: related ? 1 : 0.18,
            stroke:
              edge.data.kind === "root"
                ? STORY_PORT_COLORS.entry
                : edge.data.kind === "choice" || edge.data.kind === "decision"
                  ? STORY_PORT_COLORS.choice
                  : edge.data.kind === "checkpoint"
                    ? STORY_PORT_COLORS.checkpoint
                    : edge.data.kind === "ending"
                      ? STORY_PORT_COLORS.ending
                      : sourceKind === "router"
                        ? STORY_PORT_COLORS.route
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
    if (!canvasNodes.length) return;
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.16, duration: 420, maxZoom: 0.78 });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [canvasNodes.length, fitView]);

  const commitContent = (next: InteractiveFilmDraftContent) => {
    latestContentRef.current = next;
    setContent(next);
  };

  const updateFoundation = (field: FoundationField, value: string) => {
    if (!content || !canEdit) return;
    commitContent({
      ...content,
      storyBible: { ...content.storyBible, [field]: value },
    });
  };

  const applyGraphMutation = (
    mutation: (current: InteractiveFilmDraftContent) => InteractiveFilmDraftContent
  ): boolean => {
    if (!content || !canEdit) return false;
    try {
      const next = mutation(content);
      setGraphError(null);
      commitContent(next);
      return true;
    } catch {
      setGraphError(t("graphError.generic"));
      return false;
    }
  };

  const createStoryElement = (kind: StoryNodeCreationKind) => {
    if (!content || !canEdit) return;
    try {
      if (kind === "clip") {
        const result = createClipNode(content);
        commitContent(result.content);
        selectCanvasNodeExclusively(result.created.nodeId);
      } else if (kind === "router") {
        const result = createRouterNode(content);
        commitContent(result.content);
        selectCanvasNodeExclusively(result.created.nodeId);
      } else if (kind === "ending") {
        const result = createEndingNode(content, { locale: authoringLocale });
        commitContent(result.content);
        selectCanvasNodeExclusively(syntheticEndingNodeId(result.created.id));
      }
      setGraphError(null);
    } catch {
      setGraphError(t("graphError.generic"));
    }
  };

  const connectStoryNodes = (connection: Connection) => {
    if (!connection.source || !connection.target || !content || !model) return;
    const source = model.nodes.find((node) => node.id === connection.source);
    const target = model.nodes.find((node) => node.id === connection.target);
    if (!source || !target) return;
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
        return convertClipExitToEnding(current, source.data.nodeId, target.data.endingId);
      }
      if (
        source.data.kind === "clip" &&
        source.data.exitKind === "auto" &&
        connection.sourceHandle === "completion"
      ) {
        return connectClipContinuation(current, source.data.nodeId, target.data.nodeId);
      }
      const routeHandle = connection.sourceHandle?.match(/^route:(\d+)$/u);
      if (routeHandle) {
        return updateAutoRouteTarget(
          current,
          source.data.nodeId,
          Number(routeHandle[1]),
          target.data.nodeId
        );
      }
      return connectAutoRoute(current, source.data.nodeId, target.data.nodeId);
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
      !canEdit
    ) {
      return;
    }

    const source = model.nodes.find((node) => node.id === connectionState.fromNode?.id);
    const clientPosition = connectionDropClientPosition(event);
    if (!source || !clientPosition) return;
    const sourceHandleId = connectionState.fromHandle.id ?? "";
    const dropPosition = screenToFlowPosition(clientPosition);

    if (
      source.data.kind === "clip" &&
      source.data.exitKind === "auto" &&
      sourceHandleId === "completion"
    ) {
      setCreatorOpen(false);
      setPendingCompletionDrop({
        sourceCanvasNodeId: source.id,
        sourceHandleId,
        clientPosition,
        flowPosition: dropPosition,
      });
      return;
    }

    try {
      const created = createConnectedClipForBlankDrop(
        content,
        source.data,
        sourceHandleId,
        authoringLocale
      );
      if (!created) return;

      pendingNodePositionsRef.current.set(created.createdNodeId, {
        // The newly-created clip's input handle lands beside the release
        // point instead of placing the whole card underneath the pointer.
        x: dropPosition.x + 18,
        y: dropPosition.y - 108,
      });
      setGraphError(null);
      commitContent(created.content);
      selectCanvasNodeExclusively(created.createdNodeId);
      setCreatorOpen(false);
    } catch {
      setGraphError(t("graphError.generic"));
    }
  };

  const createCompletionStep = (kind: StoryConnectionCreationKind) => {
    const pending = pendingCompletionDrop;
    if (!pending || !content || !model || !canEdit) return;
    const source = model.nodes.find((node) => node.id === pending.sourceCanvasNodeId);
    if (!source || source.data.kind !== "clip" || source.data.exitKind !== "auto") {
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
        commitContent(convertClipExitToChoice(content, source.data.nodeId, authoringLocale));
        selectCanvasNodeExclusively(decisionNodeId);
      } else {
        const created = createConnectedClipForBlankDrop(
          content,
          source.data,
          pending.sourceHandleId,
          authoringLocale
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
    if (source.data.kind === "root") {
      return (
        connection.sourceHandle === "entry" &&
        connection.targetHandle === "in" &&
        (target.data.kind === "clip" || target.data.kind === "router")
      );
    }
    if (source.data.kind === "decision") {
      return (
        (connection.sourceHandle === "choice-new" ||
          Boolean(connection.sourceHandle?.startsWith("choice:"))) &&
        connection.targetHandle === "in" &&
        (target.data.kind === "clip" || target.data.kind === "router")
      );
    }
    if (target.data.kind === "ending") {
      return (
        source.data.kind === "clip" &&
        source.data.exitKind === "auto" &&
        !source.data.continuationTargetNodeId &&
        connection.sourceHandle === "completion" &&
        connection.targetHandle === "ending-in"
      );
    }
    if (connection.targetHandle !== "in") return false;
    if (source.data.kind === "clip") {
      return (
        source.data.exitKind === "auto" &&
        !source.data.continuationTargetNodeId &&
        connection.sourceHandle === "completion" &&
        (target.data.kind === "clip" || target.data.kind === "router")
      );
    }
    return (
      source.data.kind === "router" &&
      (connection.sourceHandle === "route-new" ||
        Boolean(connection.sourceHandle?.match(/^route:\d+$/u)))
    );
  };

  const deleteStoryEdges = (edges: StoryCanvasEdge[]) => {
    const deletedDecisionSources = new Set(
      edges.flatMap((edge) => (edge.data.kind === "decision" ? [edge.data.sourceNodeId] : []))
    );
    const normalizedEdges = edges.filter((edge) => {
      if (edge.data.kind !== "choice") return true;
      const sourceProjection = model?.nodes.find((node) => node.id === edge.source);
      return (
        !sourceProjection?.data.sourceNodeId ||
        !deletedDecisionSources.has(sourceProjection.data.sourceNodeId)
      );
    });
    const orderedEdges = [...normalizedEdges].sort((left, right) => {
      if (left.source === right.source && left.data.kind === "auto" && right.data.kind === "auto") {
        return right.data.routeIndex - left.data.routeIndex;
      }
      return left.id.localeCompare(right.id);
    });
    applyGraphMutation((current) =>
      orderedEdges.reduce((next, edge) => {
        if (edge.data.kind === "root") return setEntryNode(next, null);
        if (edge.data.kind === "continuation") {
          return disconnectStoryBranch(next, {
            kind: "continuation",
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
          });
        }
        if (edge.data.kind === "auto") {
          return disconnectStoryBranch(next, {
            kind: "auto",
            sourceNodeId: edge.source,
            routeIndex: edge.data.routeIndex,
            targetNodeId: edge.target,
            priority: edge.data.priority,
          });
        }
        if (edge.data.kind === "decision") {
          return disconnectStoryBranch(next, {
            kind: "decision",
            sourceNodeId: edge.data.sourceNodeId,
          });
        }
        if (edge.data.kind === "choice") {
          const sourceProjection = model?.nodes.find((node) => node.id === edge.source);
          if (!sourceProjection?.data.sourceNodeId) return next;
          return disconnectStoryBranch(next, {
            kind: "choice",
            sourceNodeId: sourceProjection.data.sourceNodeId,
            choiceId: edge.data.choiceId,
          });
        }
        if (edge.data.kind === "checkpoint") {
          return disconnectStoryBranch(next, {
            kind: "checkpoint",
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
          });
        }
        return disconnectStoryBranch(next, {
          kind: "ending",
          sourceNodeId: edge.source,
          endingId: edge.data.endingId,
        });
      }, current)
    );
  };

  const deleteStoryNodes = (nodes: StoryCanvasNode[]) => {
    const deletedNodeIds = new Set(nodes.map((node) => node.id));
    const remainingSelectedNodeIds = latestCanvasSelectionRef.current.filter(
      (nodeId) => !deletedNodeIds.has(nodeId)
    );
    const deleted = applyGraphMutation((current) =>
      nodes.reduce((next, node) => {
        if (node.data.kind === "root") return next;
        if (node.data.kind === "decision" && node.data.sourceNodeId) {
          return convertExitToAuto(next, node.data.sourceNodeId);
        }
        if (node.data.kind === "ending" && node.data.endingId) {
          return deleteEndingNode(next, node.data.endingId);
        }
        return deleteGraphNode(next, node.data.nodeId);
      }, current)
    );
    if (!deleted) return;
    pendingCanvasSelectionRef.current = null;
    requestedCanvasFocusRef.current = null;
    latestCanvasSelectionRef.current = remainingSelectedNodeIds;
    setFocusedNodeId((current) => nextStoryCanvasFocusedNodeId(current, remainingSelectedNodeIds));
  };

  const changeExitKind = (
    nodeId: string,
    kind: "auto" | "choice" | "checkpoint" | "ending",
    targetId?: string
  ) => {
    applyGraphMutation((current) => {
      const node = current.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
      if (!node || node.kind !== "clip") return current;
      if (node.exit.kind === kind) {
        if (node.exit.kind === "ending" && node.exit.endingId !== targetId) {
          return targetId ? convertClipExitToEnding(current, nodeId, targetId) : current;
        }
        if (node.exit.kind === "checkpoint" && node.exit.nextNodeId !== targetId) {
          return targetId ? updateCheckpointTarget(current, nodeId, targetId) : current;
        }
        return current;
      }
      if (kind === "auto") return convertExitToAuto(current, nodeId);
      if (kind === "choice") {
        return convertClipExitToChoice(current, nodeId, authoringLocale);
      }
      if (!targetId) return current;
      return kind === "checkpoint"
        ? convertClipExitToCheckpoint(current, nodeId, targetId)
        : convertClipExitToEnding(current, nodeId, targetId);
    });
  };

  const addChoice = (nodeId: string, targetNodeId: string) => {
    applyGraphMutation(
      (current) => addChoiceOption(current, nodeId, targetNodeId, authoringLocale).content
    );
  };

  const updateChoice = (
    nodeId: string,
    choiceId: string,
    patch: Parameters<typeof updateChoiceOption>[3] & { nextNodeId?: string }
  ) => {
    applyGraphMutation((current) => {
      let next = current;
      const { nextNodeId, ...optionPatch } = patch;
      if (Object.keys(optionPatch).length > 0) {
        next = updateChoiceOption(next, nodeId, choiceId, optionPatch);
      }
      if (nextNodeId !== undefined) {
        next = connectChoiceTarget(next, nodeId, choiceId, nextNodeId);
      }
      return next;
    });
  };

  const updateEnding = (
    endingId: string,
    patch: Partial<InteractiveFilmDraftContent["storyBible"]["endings"][number]>
  ) => {
    applyGraphMutation((current) =>
      updateEndingNode(current, endingId, {
        ...(patch.summary
          ? {
              summary: {
                locale: authoringLocale,
                value: patch.summary[authoringLocale] ?? "",
              },
            }
          : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.title
          ? { title: { locale: authoringLocale, value: patch.title[authoringLocale] ?? "" } }
          : {}),
      })
    );
  };

  const createCharacter = (): string | null => {
    if (!content || !canEdit) return null;
    try {
      const result = createStoryCharacter(content, { locale: authoringLocale });
      commitContent(result.content);
      setGraphError(null);
      return result.created.id;
    } catch {
      setGraphError(t("graphError.generic"));
      return null;
    }
  };

  const createStateVariable = (
    type: InteractiveFilmDraftContent["storyBible"]["stateVariables"][number]["type"]
  ): string | null => {
    if (!content || !canEdit) return null;
    try {
      const result = createStoryStateVariable(content, { type });
      commitContent(result.content);
      setGraphError(null);
      return result.created.key;
    } catch {
      setGraphError(t("graphError.generic"));
      return null;
    }
  };

  const addWorldItem = (field: StoryWorldTextField) => {
    applyGraphMutation((current) => addWorldTextItem(current, field, ""));
  };

  const duplicateNode = (nodeId: string) => {
    if (!content) return;
    const source = content.graph.nodes.find((candidate) => candidate.nodeId === nodeId);
    if (!source) return;
    try {
      const result =
        source.kind === "clip"
          ? duplicateClipNode(content, nodeId)
          : duplicateRouterNode(content, nodeId);
      commitContent(result.content);
      selectCanvasNodeExclusively(result.created.nodeId);
      setGraphError(null);
    } catch {
      setGraphError(t("graphError.generic"));
    }
  };

  const loadLatestAfterConflict = () => {
    if (!conflict) return;
    const normalizedContent = normalizeStoryClipPromptDrafts(conflict.current.content);
    conflictRef.current = null;
    clearSaveRetry(true);
    revisionRef.current = conflict.current.revision;
    setDraftRevision(conflict.current.revision);
    savedSignatureRef.current = canonicalJsonString(conflict.current.content);
    latestContentRef.current = normalizedContent;
    queuedContentRef.current = null;
    recoveryContentRef.current = null;
    setContent(normalizedContent);
    setConflict(null);
    setSaveError(null);
    setSaveState("idle");
  };

  const loadLatestLayoutAfterConflict = () => {
    if (!layoutConflict || !model) return;
    const currentById = new Map(canvasNodesRef.current.map((node) => [node.id, node]));
    const latestNodes = model.nodes.map((node) => ({
      ...node,
      selected: Boolean(currentById.get(node.id)?.selected),
      position: layoutConflict.current.nodePositions[node.id] ?? node.position,
    }));
    layoutConflictRef.current = null;
    recoveryLayoutRef.current = null;
    queuedLayoutRef.current = null;
    clearLayoutSaveRetry(true);
    layoutRevisionRef.current = layoutConflict.current.revision;
    layoutSavedSignatureRef.current = layoutPositionSignature(nodePositions(latestNodes));
    canvasNodesRef.current = latestNodes;
    const selectedNodeIds = latestNodes.filter((node) => node.selected).map((node) => node.id);
    latestCanvasSelectionRef.current = selectedNodeIds;
    setFocusedNodeId((current) => nextStoryCanvasFocusedNodeId(current, selectedNodeIds));
    setCanvasNodes(latestNodes);
    setLayoutConflict(null);
    setLayoutSaveError(null);
    setLayoutSaveState("idle");
  };

  const isLoading =
    workspaceLoading ||
    (Boolean(workspaceId) && (workbenchQuery.isLoading || layoutQuery.isLoading));
  if (isLoading) return <CanvasLoading />;
  const workbenchUnavailable = workbenchQuery.isError && !workbenchQuery.data;
  const layoutUnavailable = layoutQuery.isError && !layoutQuery.data;
  if (workbenchUnavailable || layoutUnavailable || !project || !content || !model) {
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

  const displaySaveState = mergeSaveStates(saveState, layoutSaveState);
  return (
    <main className="relative h-screen min-w-[1120px] overflow-hidden bg-[oklch(0.18_0_0)] text-white">
      <CanvasHeader
        projectId={projectId}
        title={project.title}
        revision={draftRevision}
        saveState={displaySaveState}
        saveError={saveError ?? layoutSaveError}
        canEdit={canEdit}
        previewPending={workingPreviewPending}
        onPreview={() => void loadWorkingPreview()}
        onFit={() => void fitView({ padding: 0.16, duration: 420, maxZoom: 0.78 })}
        onShowFoundation={() => selectCanvasNodeExclusively(null)}
      />

      <StoryWorkingPreviewDialog
        open={workingPreviewOpen}
        onOpenChange={setWorkingPreviewOpen}
        preview={workingPreview}
        pending={workingPreviewPending}
        error={workingPreviewError}
        locale={interfaceLocale}
        frameProfile={project.frameProfile}
        onRetry={() => void loadWorkingPreview()}
      />

      <section className="absolute inset-x-0 top-16 bottom-0 right-[380px]">
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
          <StoryTrailerUiContext.Provider value={trailerUi}>
            <StoryProductionUiContext.Provider value={productionUi}>
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
                  isValidConnection={isValidStoryConnection}
                  onEdgesDelete={deleteStoryEdges}
                  onNodesDelete={deleteStoryNodes}
                  onSelectionChange={onCanvasSelectionChange}
                  onSelectionStart={onCanvasSelectionStart}
                  onSelectionEnd={onCanvasSelectionEnd}
                  onNodeDragStop={(_event, draggedNode, draggedNodes) => {
                    const movedNodes = new Map(
                      [...draggedNodes, draggedNode].map((node) => [node.id, node])
                    );
                    const positions = nodePositions(
                      canvasNodes.map((node) => movedNodes.get(node.id) ?? node)
                    );
                    if (layoutPositionSignature(positions) === layoutSavedSignatureRef.current)
                      return;
                    setLayoutSaveState("dirty");
                    void persistLayoutRef.current(positions);
                  }}
                  onNodeClick={(event, node) => {
                    if (event.shiftKey && node.selected) {
                      requestedCanvasFocusRef.current = null;
                      const remainingNodeIds = latestCanvasSelectionRef.current.filter(
                        (nodeId) => nodeId !== node.id
                      );
                      latestCanvasSelectionRef.current = remainingNodeIds;
                      reconcileCanvasFocus(remainingNodeIds);
                      return;
                    }
                    requestedCanvasFocusRef.current = node.id;
                    setFocusedNodeId(node.id);
                  }}
                  onPaneClick={() => {
                    selectCanvasNodeExclusively(null);
                    setCreatorOpen(false);
                  }}
                  nodeTypes={NODE_TYPES}
                  defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
                  colorMode="dark"
                  proOptions={{ hideAttribution: true }}
                  minZoom={0.16}
                  maxZoom={1.4}
                  defaultViewport={{ x: 80, y: 160, zoom: 0.48 }}
                  nodesDraggable={canEdit}
                  nodesConnectable={canEdit}
                  edgesReconnectable={false}
                  edgesFocusable={canEdit}
                  deleteKeyCode={canEdit ? ["Backspace", "Delete"] : null}
                  selectNodesOnDrag
                  zoomOnDoubleClick={false}
                  fitView={canvasNodes.length > 0}
                  fitViewOptions={{ padding: 0.16, maxZoom: 0.78 }}
                  className="relative z-10"
                  style={{ backgroundColor: "transparent" }}
                >
                  <MiniMap
                    pannable
                    position="bottom-left"
                    className="canvas-wheel-zoom bottom-5! left-20! m-0! overflow-hidden rounded-[18px] bg-[oklch(0.24_0_0/0.82)]! shadow-[0_18px_60px_rgba(0,0,0,0.4)] backdrop-blur-[30px]! backdrop-saturate-150!"
                    bgColor="oklch(0.24 0 0 / 0.82)"
                    maskColor="rgba(0,0,0,0.46)"
                    nodeColor="rgba(255,255,255,0.42)"
                    nodeStrokeWidth={0}
                  />
                  <CanvasControls
                    position="bottom-left"
                    className="bottom-5! left-5! overflow-hidden rounded-full bg-[oklch(0.24_0_0/0.82)]! p-1! shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-[30px]! backdrop-saturate-150! [&_button]:size-9!"
                  />
                </StoryCanvasReactFlow>
              </StoryCanvasFocusContext.Provider>
            </StoryProductionUiContext.Provider>
          </StoryTrailerUiContext.Provider>
        </MediaHoverPreviewProvider>

        {canEdit ? (
          <StoryNodeCreator
            open={creatorOpen}
            onOpenChange={setCreatorOpen}
            onCreate={createStoryElement}
          />
        ) : null}
      </section>

      {pendingCompletionDrop ? (
        <StoryConnectionCreator
          position={pendingCompletionDrop.clientPosition}
          onCreate={createCompletionStep}
          onCancel={() => setPendingCompletionDrop(null)}
        />
      ) : null}

      <StoryNodeInspector
        content={content}
        locale={authoringLocale}
        selectedNode={focusedNode}
        production={inspectorProduction}
        filmTrailer={film?.trailer ?? null}
        trailerProduction={inspectorTrailerProduction}
        onCreateTrailerPrompt={() =>
          applyGraphMutation((current) =>
            createTrailerPrompt(current, t("trailer.authoring.defaultTitle"))
          )
        }
        onReplaceTrailerPrompt={(prompt) =>
          applyGraphMutation((current) => replaceTrailerPrompt(current, prompt))
        }
        showFoundation={focusedNodeId === null}
        canEdit={canEdit}
        onShowFoundation={() => selectCanvasNodeExclusively(null)}
        onUpdateFoundation={updateFoundation}
        onCreateCharacter={createCharacter}
        onUpdateCharacter={(characterId, patch) =>
          applyGraphMutation((current) => updateStoryCharacter(current, characterId, patch))
        }
        onDeleteCharacter={(characterId) =>
          applyGraphMutation((current) => deleteStoryCharacter(current, characterId))
        }
        onAddWorldTextItem={addWorldItem}
        onUpdateWorldTextItem={(field, index, value) =>
          applyGraphMutation((current) => updateWorldTextItem(current, field, index, value))
        }
        onRemoveWorldTextItem={(field, index) =>
          applyGraphMutation((current) => removeWorldTextItem(current, field, index))
        }
        onCreateStateVariable={createStateVariable}
        onReplaceStateVariable={(key, next) =>
          applyGraphMutation((current) => replaceStoryStateVariable(current, key, next))
        }
        onDeleteStateVariable={(key) =>
          applyGraphMutation((current) => deleteStoryStateVariable(current, key))
        }
        onReplaceClipPrompt={(graphNodeId, next) =>
          applyGraphMutation((current) => replaceClipPrompt(current, graphNodeId, next))
        }
        onCloseNode={() => selectCanvasNodeExclusively(null)}
        onSetEntry={(nodeId) => applyGraphMutation((current) => setEntryNode(current, nodeId))}
        onChangeExitKind={changeExitKind}
        onUpdateClipContinuation={(nodeId, targetNodeId) =>
          applyGraphMutation((current) => connectClipContinuation(current, nodeId, targetNodeId))
        }
        onUpdateCheckpointTarget={(nodeId, targetNodeId) =>
          applyGraphMutation((current) => updateCheckpointTarget(current, nodeId, targetNodeId))
        }
        onAddAutoRoute={(nodeId, targetNodeId) =>
          applyGraphMutation((current) => connectAutoRoute(current, nodeId, targetNodeId))
        }
        onUpdateAutoRoute={(nodeId, routeIndex, patch) =>
          applyGraphMutation((current) => updateAutoRoute(current, nodeId, routeIndex, patch))
        }
        onRemoveAutoRoute={(nodeId, routeIndex) =>
          applyGraphMutation((current) => disconnectAutoRoute(current, nodeId, { routeIndex }))
        }
        onUpdateChoiceExit={(nodeId, patch) =>
          applyGraphMutation((current) => updateChoiceExit(current, nodeId, patch))
        }
        onAddChoice={addChoice}
        onUpdateChoice={updateChoice}
        onMoveChoice={(nodeId, choiceId, direction) =>
          applyGraphMutation((current) => moveChoiceOption(current, nodeId, choiceId, direction))
        }
        onRemoveChoice={(nodeId, choiceId) =>
          applyGraphMutation((current) => removeChoiceOption(current, nodeId, choiceId))
        }
        onUpdateEnding={updateEnding}
        onDuplicateNode={duplicateNode}
        onDeleteSelected={() => {
          if (focusedNode) deleteStoryNodes([focusedNode]);
        }}
      />

      {graphError ? (
        <FrostedPanel className="absolute right-[396px] bottom-5 z-50 flex max-w-[520px] items-center gap-3 rounded-[16px] bg-[oklch(0.24_0_0/0.9)] px-4 py-3 shadow-[0_20px_70px_rgba(0,0,0,0.48)] backdrop-blur-[30px]">
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

      {conflict ? <ConflictBanner onLoadLatest={loadLatestAfterConflict} /> : null}
      {!conflict && layoutConflict ? (
        <ConflictBanner
          description={t("layoutConflict.description")}
          onLoadLatest={loadLatestLayoutAfterConflict}
        />
      ) : null}
    </main>
  );
}

function CanvasHeader({
  projectId,
  title,
  revision,
  saveState,
  saveError,
  canEdit,
  previewPending,
  onPreview,
  onFit,
  onShowFoundation,
}: {
  projectId: string;
  title: string;
  revision: number;
  saveState: SaveState;
  saveError: string | null;
  canEdit: boolean;
  previewPending: boolean;
  onPreview: () => void;
  onFit: () => void;
  onShowFoundation: () => void;
}) {
  const t = useTranslations("storyStudio.canvas");
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-40 flex h-16 items-center justify-between gap-3 px-3 py-2">
      <FrostedPanel className="pointer-events-auto flex h-12 min-w-0 items-center gap-3 rounded-[20px] bg-[oklch(0.205_0_0/0.72)] px-2.5 pr-4 shadow-[0_14px_50px_rgba(0,0,0,0.3)] backdrop-blur-[60px]">
        <Link
          href="/story-studio"
          aria-label={t("back")}
          className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/[0.07] text-white/68 transition hover:bg-white/[0.12] hover:text-white"
        >
          <IconArrowLeft className="size-5" />
        </Link>
        <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/[0.08] text-white/78">
          <IconGitBranch className="size-5" stroke={1.7} />
        </div>
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
          onClick={onShowFoundation}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-white/[0.07] px-3 text-xs font-semibold text-white/66 transition hover:bg-white/[0.12] hover:text-white"
        >
          <IconBook2 className="size-4" />
          {t("foundation.action")}
        </button>
        <Link
          href={`/story-studio/projects/${projectId}/overview`}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-white/[0.07] px-3 text-xs font-semibold text-white/66 transition hover:bg-white/[0.12] hover:text-white"
        >
          <IconLayoutDashboard className="size-4" />
          {t("workbench")}
        </Link>
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
        <button
          type="button"
          onClick={onFit}
          className="grid size-9 place-items-center rounded-xl bg-white/[0.07] text-white/66 transition hover:bg-white/[0.12] hover:text-white"
          aria-label={t("fit")}
          title={t("fit")}
        >
          <IconFocusCentered className="size-4" />
        </button>
        <span className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-3 text-[11px] font-semibold text-black">
          {saveState === "saving" ? (
            <IconLoader2 className="size-3.5 animate-spin" />
          ) : (
            <IconCheck className="size-3.5" />
          )}
          {canEdit ? t("autosave") : t("readOnly")}
        </span>
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
  const productionUi = useContext(StoryProductionUiContext);
  const trailerUi = useContext(StoryTrailerUiContext);
  const focusedNodeId = useContext(StoryCanvasFocusContext);
  const isRoot = data.kind === "root";
  const isEnding = data.kind === "ending";
  const isRouter = data.kind === "router";
  const isDecision = data.kind === "decision";
  const productionTarget = data.kind === "root" ? data.filmTrailer : data.filmClip;
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
        : data.kind === "router"
          ? { background: "rgba(224,164,92,0.30)", iconBackground: "rgba(224,164,92,0.54)" }
          : data.kind === "ending"
            ? { background: "rgba(229,34,39,0.36)", iconBackground: "rgba(229,34,39,0.60)" }
            : { background: "rgba(255,255,255,0.14)", iconBackground: "rgba(255,255,255,0.22)" };
  return (
    <div className="relative pt-10">
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
          {isDecision ? <IconGitBranch className="size-3.5" stroke={2} /> : null}
          {isRouter ? <IconRoute className="size-3.5" stroke={2} /> : null}
          {isEnding ? <IconSparkles className="size-3.5" stroke={2} /> : null}
        </span>
        {t(`nodeKinds.${data.kind}`)}
      </FrostedPanel>
      <article
        {...mediaPreview.hoverProps}
        className={cn(
          "relative w-[310px] overflow-visible rounded-[22px] bg-[oklch(0.205_0_0/0.72)] shadow-[0_22px_70px_rgba(0,0,0,0.38)] backdrop-blur-xl backdrop-saturate-150 transition",
          isRoot && "w-[360px]",
          isRouter && "w-[250px]",
          isDecision && "w-[290px]",
          isEnding && "w-[280px]",
          selected && "bg-[oklch(0.24_0_0/0.86)] shadow-[0_28px_100px_rgba(0,0,0,0.55)]"
        )}
      >
        <GlassRim width="1px" />
        {!isRoot ? (
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
                  : isRouter
                    ? STORY_PORT_COLORS.route
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
        {data.kind === "clip" ? (
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
            outdated={Boolean(currentVideo?.outdated)}
            outdatedLabel={t("production.node.earlierDirection")}
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
                  {data.eyebrow}
                </p>
                <h2 className="mt-1 truncate text-[15px] font-semibold text-white/90">
                  {data.title}
                </h2>
              </div>
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-white/58">
                {isDecision ? <IconGitBranch className="size-4" /> : null}
                {isRouter ? <IconRoute className="size-4" /> : null}
                {isEnding ? <IconSparkles className="size-4" /> : null}
                {isRoot ? <IconWorld className="size-4" /> : null}
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
              outdated={Boolean(currentVideo?.outdated)}
              outdatedLabel={t("production.node.earlierDirection")}
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
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              <NodeStat label={t("metrics.characters")} value={data.rootStats.characters} />
              <NodeStat label={t("metrics.locations")} value={data.rootStats.locations} />
              <NodeStat label={t("metrics.props")} value={data.rootStats.props} />
              <NodeStat label={t("metrics.rules")} value={data.rootStats.rules} />
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
          {isRouter && data.exitKind === "auto" ? (
            <div className="mt-3 space-y-1.5">
              {(data.autoRoutes ?? []).map((route) => (
                <div
                  key={`${route.routeIndex}:${route.targetNodeId}`}
                  className="relative flex items-center justify-between gap-3 rounded-xl bg-black/18 px-2.5 py-2 pr-3.5 text-[10px]"
                >
                  <span className="truncate text-white/54">
                    {route.hasCondition
                      ? t("ports.priority", { priority: route.priority })
                      : t("ports.auto")}
                  </span>
                  <span className="shrink-0 text-white/28">→ {route.targetNodeId}</span>
                  <StoryPortHandle
                    id={`route:${route.routeIndex}`}
                    type="source"
                    position={Position.Right}
                    isConnectable={isConnectable}
                    color={STORY_PORT_COLORS.route}
                    label={t("ports.route", { target: route.targetNodeId })}
                    className="-right-[23px]!"
                  />
                </div>
              ))}
              {(data.autoRoutes?.length ?? 0) < 20 ? (
                <div className="relative flex h-8 items-center rounded-xl bg-[rgba(224,164,92,0.08)] px-2.5 text-[10px] font-semibold text-[#e0a45c]/74">
                  {t("ports.newRoute")}
                  <StoryPortHandle
                    id="route-new"
                    type="source"
                    position={Position.Right}
                    isConnectable={isConnectable}
                    color={STORY_PORT_COLORS.route}
                    label={t("ports.newRoute")}
                    className="-right-[23px]!"
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </article>
      {selected &&
      data.kind === "clip" &&
      data.directorPrompt &&
      productionUi?.graphNodeId === data.nodeId ? (
        <StoryShotComposer {...productionUi.composer} />
      ) : null}
      {selected && data.kind === "root" && trailerUi?.composer ? (
        <StoryShotComposer {...trailerUi.composer} />
      ) : null}
    </div>
  );
}

function StoryVideoPreview({
  source,
  interactive,
  frameAspectRatio,
  ariaLabel,
  emptyLabel,
  outdated,
  outdatedLabel,
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
  outdated: boolean;
  outdatedLabel: string;
  generation: FilmVideoGeneration | null | undefined;
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
          <span className="text-[8px] tabular-nums text-white/18">
            {frameAspectRatio ?? "16:9"}
          </span>
        </div>
      )}
      {outdated ? (
        <span className="pointer-events-none absolute top-2 left-2 z-30 rounded-full bg-black/62 px-2 py-1 text-[8px] font-semibold text-white/78 backdrop-blur-sm">
          {outdatedLabel}
        </span>
      ) : null}
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
            {filmGenerationError(generation) ?? generationFailedLabel}
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
  onLoadLatest,
}: {
  description?: string;
  onLoadLatest: () => void;
}) {
  const t = useTranslations("storyStudio.canvas");
  return (
    <FrostedPanel className="absolute top-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 bg-[oklch(0.24_0_0/0.82)] px-4 py-3 shadow-[0_20px_70px_rgba(0,0,0,0.52)] backdrop-blur-[30px]">
      <IconAlertTriangle className="size-4 shrink-0 text-[#ff9b9e]" />
      <p className="text-xs text-white/72">{description ?? t("conflict.description")}</p>
      <Button size="sm" variant="secondary" onClick={onLoadLatest}>
        <IconRefresh className="size-3.5" />
        {t("conflict.loadLatest")}
      </Button>
    </FrostedPanel>
  );
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

function CanvasError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTranslations("storyStudio.canvas");
  return (
    <main className="grid h-screen place-items-center bg-[oklch(0.105_0_0)] px-6 text-white">
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
