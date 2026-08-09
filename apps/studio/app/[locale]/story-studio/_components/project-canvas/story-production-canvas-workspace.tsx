"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { ReactFlowProvider, type NodeChange } from "@xyflow/react";
import {
  IconArrowLeft,
  IconBookmark,
  IconBookmarkFilled,
  IconBookmarkPlus,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import {
  usePersistedCanvasGraph,
  type PersistedCanvasAdapter,
  type PersistedCanvasStatus,
} from "@/components/canvas/use-persisted-canvas-graph";
import { CanvasGraphProvider, type CanvasGraphStore } from "@/lib/canvas-core/canvas-graph-context";
import {
  getStoryProductionCanvas,
  putStoryProductionCanvas,
  storyApiErrorMessage,
  type StoryProductionCanvasContent,
  type StoryProductionCanvasGroup,
  type StoryProductionCanvasGroupColor,
} from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  CanvasMediaActionsProvider,
  type CanvasMediaActionsResolver,
} from "@/components/canvas/authoring/media-actions-context";
import { useAiCatalog } from "@/lib/canvas-authoring/use-ai-catalog";
import { CanvasGenerationProvider } from "@/lib/canvas-authoring/use-canvas-generation";
import {
  addNodesToCanvasGroup,
  canvasGroupingAction,
  groupCanvasNodes,
  reconcileCanvasGroups,
  removeNodesFromCanvasGroups,
  sameCanvasGroups,
  setCanvasGroupColor,
  ungroupCanvasNodes,
} from "@/components/canvas/groups/canvas-groups";
import type { CanvasGroupingController } from "@/components/canvas/groups/canvas-grouping";
import { MediaAuthoringCanvas } from "@/components/canvas/authoring/media-authoring-canvas";
import { CanvasBackdrop } from "@/components/canvas/canvas-backdrop";
import type { StoryCandidateAssetsController } from "./use-story-candidate-assets";
import { StoryCandidateAssetsPanel } from "./story-candidate-assets-panel";

const EXIT_DURATION_MS = 220;
const STORY_UPLOAD_KINDS = ["image", "video", "audio"] as const;

function storyCanvasStatusLabel(
  status: PersistedCanvasStatus,
  t: ReturnType<typeof useTranslations>
) {
  if (status === "loading") return t("status.loading");
  if (status === "saving") return t("status.saving");
  if (status === "error") return t("status.error");
  return t("status.saved");
}

export interface StoryProductionCanvasContext {
  projectId: string;
  workspaceId: string;
  sessionId: string;
  canEdit: boolean;
  canGenerate: boolean;
}

interface StoryProductionCanvasWorkspaceProps {
  context: StoryProductionCanvasContext;
  candidates: StoryCandidateAssetsController;
  onClose: () => void;
}

function ProductionCanvasDocument({
  context,
  candidates,
  onFlushReady,
  onDrawerInsetChange,
}: {
  context: StoryProductionCanvasContext;
  candidates: StoryCandidateAssetsController;
  onFlushReady: (flush: (request?: { keepalive?: boolean }) => Promise<void>) => void;
  onDrawerInsetChange: (inset: number) => void;
}) {
  const t = useTranslations("storyStudio.canvas.productionCanvas.candidates");
  const [groups, setGroupsState] = useState<StoryProductionCanvasGroup[]>([]);
  const groupsRef = useRef<StoryProductionCanvasGroup[]>([]);
  const applyGroups = useCallback((value: SetStateAction<StoryProductionCanvasGroup[]>) => {
    const next = typeof value === "function" ? value(groupsRef.current) : value;
    groupsRef.current = next;
    setGroupsState(next);
  }, []);
  const adapter = useMemo<PersistedCanvasAdapter<StoryProductionCanvasContent>>(
    () => ({
      load: async (signal) => {
        return (await getStoryProductionCanvas(context.workspaceId, context.projectId, signal))
          .content;
      },
      save: async (snapshot, request) => {
        await putStoryProductionCanvas(
          context.workspaceId,
          context.projectId,
          snapshot,
          context.sessionId,
          request
        );
      },
    }),
    [context.projectId, context.sessionId, context.workspaceId]
  );
  const extendSnapshot = useCallback(
    (graph: Omit<StoryProductionCanvasContent, "groups">): StoryProductionCanvasContent => ({
      ...graph,
      groups: reconcileCanvasGroups(
        groupsRef.current,
        graph.nodes.map((node) => node.id)
      ),
    }),
    []
  );
  const onApplySnapshot = useCallback(
    (snapshot: StoryProductionCanvasContent) => applyGroups(snapshot.groups),
    [applyGroups]
  );
  const { graph, status, error, retry, flush, requestSave, commitSnapshotUpdate, isNodePersisted } =
    usePersistedCanvasGraph<StoryProductionCanvasContent>({
      adapter,
      canEdit: context.canEdit,
      extendSnapshot,
      onApplySnapshot,
    });

  useEffect(() => {
    onFlushReady(flush);
  }, [flush, onFlushReady]);

  const toggleGroup = useCallback(
    (nodeIds: string[]) => {
      let selectedGroupId: string | null = null;
      const changed = commitSnapshotUpdate((snapshot) => {
        const persistedNodeIds = new Set(snapshot.nodes.map((node) => node.id));
        const action = canvasGroupingAction(
          snapshot.groups,
          nodeIds.filter((nodeId) => persistedNodeIds.has(nodeId))
        );
        if (!action) return null;
        let nextGroups: StoryProductionCanvasGroup[];
        if (action.type === "ungroup") {
          nextGroups = ungroupCanvasNodes(snapshot.groups, action.groupId);
        } else {
          selectedGroupId = `group-${crypto.randomUUID()}`;
          nextGroups = groupCanvasNodes(snapshot.groups, selectedGroupId, action.nodeIds);
        }
        if (sameCanvasGroups(snapshot.groups, nextGroups)) return null;
        return { ...snapshot, groups: nextGroups };
      });
      if (!changed) return null;
      graph.selectNodes([]);
      return selectedGroupId;
    },
    [commitSnapshotUpdate, graph]
  );

  const updateGroupColor = useCallback(
    (groupId: string, color: StoryProductionCanvasGroupColor) => {
      commitSnapshotUpdate((snapshot) => {
        const group = snapshot.groups.find((candidate) => candidate.id === groupId);
        if (!group || group.color === color) return null;
        return {
          ...snapshot,
          groups: setCanvasGroupColor(snapshot.groups, groupId, color),
        };
      });
    },
    [commitSnapshotUpdate]
  );

  const addNodesToGroup = useCallback(
    (groupId: string, nodeIds: string[]) =>
      commitSnapshotUpdate((snapshot) => {
        const persistedNodeIds = new Set(snapshot.nodes.map((node) => node.id));
        const nextGroups = addNodesToCanvasGroup(
          snapshot.groups,
          groupId,
          nodeIds.filter((nodeId) => persistedNodeIds.has(nodeId))
        );
        if (sameCanvasGroups(snapshot.groups, nextGroups)) return null;
        return { ...snapshot, groups: nextGroups };
      }),
    [commitSnapshotUpdate]
  );

  const removeNodesFromGroups = useCallback(
    (nodeIds: string[]) =>
      commitSnapshotUpdate((snapshot) => {
        const persistedNodeIds = new Set(snapshot.nodes.map((node) => node.id));
        const nextGroups = removeNodesFromCanvasGroups(
          snapshot.groups,
          nodeIds.filter((nodeId) => persistedNodeIds.has(nodeId))
        );
        if (sameCanvasGroups(snapshot.groups, nextGroups)) return null;
        return { ...snapshot, groups: nextGroups };
      }),
    [commitSnapshotUpdate]
  );

  const groupedGraph = useMemo<CanvasGraphStore>(() => {
    const remove = (nodeIds: string[]) => {
      if (nodeIds.length === 0) return false;
      const next = removeNodesFromCanvasGroups(groupsRef.current, nodeIds);
      if (sameCanvasGroups(groupsRef.current, next)) return false;
      applyGroups(next);
      return true;
    };
    return {
      ...graph,
      onNodesChange: (changes: NodeChange[]) => {
        graph.onNodesChange(changes);
        const groupsChanged = remove(
          changes
            .filter(
              (change): change is Extract<NodeChange, { type: "remove" }> =>
                change.type === "remove"
            )
            .map((change) => change.id)
        );
        if (groupsChanged) requestSave();
      },
      removeNode: (id) => {
        graph.removeNode(id);
        if (remove([id])) requestSave();
      },
    };
  }, [applyGroups, graph, requestSave]);
  const resolveMediaActions = useCallback<CanvasMediaActionsResolver>(
    (media) => {
      if (!candidates.canEdit) return [];
      const active = candidates.candidateIds.has(media.mediaAssetId);
      const pending = candidates.pendingIds.has(media.mediaAssetId);
      return [
        {
          id: "story-candidate",
          label: active ? t("remove") : t("add"),
          icon: pending ? (
            <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
          ) : active ? (
            <IconBookmarkFilled className="size-4" stroke={1.8} />
          ) : (
            <IconBookmarkPlus className="size-4" stroke={1.8} />
          ),
          active,
          pending,
          onSelect: () => {
            void candidates.toggle(media.mediaAssetId);
          },
        },
      ];
    },
    [candidates, t]
  );

  return (
    <CanvasMediaActionsProvider value={resolveMediaActions}>
      <CanvasGraphProvider value={groupedGraph}>
        <StoryProductionCanvasCatalogBoundary
          context={context}
          candidates={candidates}
          groups={groups}
          onToggleGroup={toggleGroup}
          onAddNodesToGroup={addNodesToGroup}
          onRemoveNodesFromGroups={removeNodesFromGroups}
          onSetGroupColor={updateGroupColor}
          isNodePersisted={isNodePersisted}
          status={status}
          error={error}
          retry={retry}
          onDrawerInsetChange={onDrawerInsetChange}
        />
      </CanvasGraphProvider>
    </CanvasMediaActionsProvider>
  );
}

function StoryProductionCanvasCatalogBoundary({
  context,
  candidates,
  groups,
  onToggleGroup,
  onAddNodesToGroup,
  onRemoveNodesFromGroups,
  onSetGroupColor,
  isNodePersisted,
  status,
  error,
  retry,
  onDrawerInsetChange,
}: {
  context: StoryProductionCanvasContext;
  candidates: StoryCandidateAssetsController;
  groups: readonly StoryProductionCanvasGroup[];
  onToggleGroup: (nodeIds: string[]) => string | null;
  onAddNodesToGroup: (groupId: string, nodeIds: string[]) => boolean;
  onRemoveNodesFromGroups: (nodeIds: string[]) => boolean;
  onSetGroupColor: (groupId: string, color: StoryProductionCanvasGroupColor) => void;
  isNodePersisted: (id: string) => boolean;
  status: PersistedCanvasStatus;
  error: string | null;
  retry: () => void;
  onDrawerInsetChange: (inset: number) => void;
}) {
  const t = useTranslations("storyStudio.canvas");
  const tp = useTranslations("storyStudio.canvas.productionCanvas");
  const { data: catalog } = useAiCatalog();
  const grouping = useMemo<CanvasGroupingController>(
    () => ({
      groups,
      toggleGroup: onToggleGroup,
      addNodesToGroup: onAddNodesToGroup,
      removeNodesFromGroups: onRemoveNodesFromGroups,
      setGroupColor: onSetGroupColor,
      isNodeGroupable: isNodePersisted,
    }),
    [
      groups,
      isNodePersisted,
      onAddNodesToGroup,
      onRemoveNodesFromGroups,
      onSetGroupColor,
      onToggleGroup,
    ]
  );
  const secondaryDrawer = useMemo(
    () => ({
      label: tp("candidates.open"),
      Icon: IconBookmark,
      render: (close: () => void) => (
        <StoryCandidateAssetsPanel controller={candidates} onClose={close} />
      ),
    }),
    [candidates, tp]
  );
  const statusLabel = storyCanvasStatusLabel(status, tp);

  return (
    <CanvasGenerationProvider
      catalog={catalog}
      context={{ sourceSurface: "story-studio-production-canvas" }}
      canGenerate={context.canGenerate}
      disabledReason={context.canGenerate ? null : t("production.disabled.permission")}
    >
      <MediaAuthoringCanvas
        canEdit={context.canEdit}
        ready={status === "ready" || status === "saved"}
        workspaceId={context.workspaceId}
        scopeKey={context.sessionId}
        uploadKinds={STORY_UPLOAD_KINDS}
        fitEmptyCanvas
        tidySelection
        grouping={grouping}
        secondaryDrawer={secondaryDrawer}
        onDrawerInsetChange={onDrawerInsetChange}
        statusOverlay={({ groupDropTarget }) => {
          const dropActive = groupDropTarget !== null;
          return (
            <div
              role="status"
              aria-live="polite"
              aria-label={dropActive ? tp("groupDropHint") : `${tp("identity")} · ${statusLabel}`}
              className="pointer-events-none absolute top-4 left-1/2 z-[70] max-w-[calc(100%-20rem)] -translate-x-1/2"
            >
              <div className="flex items-center gap-2 whitespace-nowrap drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
                {dropActive ? (
                  <span
                    data-testid="story-group-drop-hint"
                    className="truncate text-[11px] font-medium tracking-[0.03em] text-white/82"
                  >
                    {tp("groupDropHint")}
                  </span>
                ) : (
                  <>
                    <span className="truncate text-[11px] font-medium tracking-[0.03em] text-white/58">
                      {tp("identity")}
                    </span>
                    <span aria-hidden className="text-[10px] text-white/20">
                      ·
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[10px] font-medium text-white/34",
                        status === "error" && "text-destructive"
                      )}
                    >
                      {statusLabel}
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        }}
        loadingOverlay={
          status === "loading" ? (
            <div className="absolute inset-0 z-50 grid place-items-center">
              <CanvasBackdrop />
              <IconLoader2 className="relative size-7 animate-spin text-white/38" stroke={1.5} />
            </div>
          ) : null
        }
        renderErrorOverlay={(nodes) =>
          status === "error" && nodes.length === 0 ? (
            <div className="absolute inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
              <CanvasBackdrop className="opacity-90" />
              <div className="relative flex max-w-sm flex-col items-center gap-3 text-center">
                <p className="text-sm font-medium text-white/78">{tp("loadError")}</p>
                {error ? <p className="text-xs leading-5 text-white/42">{error}</p> : null}
                <button
                  type="button"
                  onClick={retry}
                  className="flex h-9 items-center gap-2 rounded-xl bg-white/[0.09] px-3.5 text-xs font-medium text-white/78 transition hover:bg-white/[0.14] hover:text-white"
                >
                  <IconRefresh className="size-4" stroke={1.8} />
                  {tp("retry")}
                </button>
              </div>
            </div>
          ) : null
        }
      />
    </CanvasGenerationProvider>
  );
}

/**
 * Project-wide media-authoring canvas. The opener node is navigation context;
 * every chapter enters the same persisted graph so assets and visual lineage
 * remain reusable across the story.
 */
export function StoryProductionCanvasWorkspace({
  context,
  candidates,
  onClose,
}: StoryProductionCanvasWorkspaceProps) {
  const t = useTranslations("storyStudio.canvas.productionCanvas");
  const [presented, setPresented] = useState(false);
  const [closing, setClosing] = useState(false);
  const [drawerInset, setDrawerInset] = useState(0);
  const closingRef = useRef(false);
  const flushRef = useRef<(request?: { keepalive?: boolean }) => Promise<void>>(
    async () => undefined
  );
  const openerRef = useRef<HTMLElement | null>(null);
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const exitTimerRef = useRef<number | null>(null);

  const registerFlush = useCallback(
    (flush: (request?: { keepalive?: boolean }) => Promise<void>) => {
      flushRef.current = flush;
    },
    []
  );

  const requestClose = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    try {
      await flushRef.current({ keepalive: true });
    } catch (error) {
      closingRef.current = false;
      setClosing(false);
      toast.error(storyApiErrorMessage(error, t("closeSaveError")));
      return;
    }
    setPresented(false);
    exitTimerRef.current = window.setTimeout(onClose, EXIT_DURATION_MS);
  }, [onClose, t]);

  useEffect(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      setPresented(true);
      backButtonRef.current?.focus({ preventScroll: true });
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) void requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
      openerRef.current?.focus({ preventScroll: true });
    };
  }, [requestClose]);

  return (
    <section
      data-testid="story-production-canvas-workspace"
      data-story-canvas-level="production"
      role="region"
      aria-label={t("workspaceLabel")}
      className={cn(
        "absolute inset-0 z-[120] min-h-0 min-w-0 origin-center overflow-hidden transition-[opacity,transform] duration-300 ease-out",
        presented ? "scale-100 opacity-100" : "scale-[1.012] opacity-0"
      )}
      style={{ backgroundColor: "var(--canvas-background)" }}
    >
      <ReactFlowProvider>
        <ProductionCanvasDocument
          context={context}
          candidates={candidates}
          onFlushReady={registerFlush}
          onDrawerInsetChange={setDrawerInset}
        />
      </ReactFlowProvider>
      <button
        ref={backButtonRef}
        type="button"
        onClick={() => void requestClose()}
        disabled={closing}
        aria-label={t("backToChapter")}
        className="absolute top-3 z-[80] grid size-10 place-items-center rounded-2xl bg-[oklch(0.22_0_0/0.9)] text-white/68 shadow-[0_10px_32px_rgba(0,0,0,0.36)] backdrop-blur-2xl transition-[left,background-color,color] duration-200 ease-out hover:bg-[oklch(0.28_0_0/0.94)] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:cursor-wait disabled:opacity-60"
        style={{ left: 12 + drawerInset }}
      >
        {closing ? (
          <IconLoader2 className="size-4.5 animate-spin" stroke={1.8} />
        ) : (
          <IconArrowLeft className="size-4.5" stroke={1.8} />
        )}
      </button>
    </section>
  );
}
