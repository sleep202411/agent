"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useReactFlow } from "@xyflow/react";
import { useRouter } from "@/i18n/navigation";
import {
  createStoryProject,
  draftPipelineState,
  draftRevisionConflict,
  getStoryProject,
  putStoryDraft,
  type DraftRevisionConflict,
  type StoryStudioAnalysis,
} from "@/lib/story-projects-api";
import { buildNodesAndEdgesFromAnalysis } from "./analysis-to-canvas";
import { buildStoryCanvasSnapshot, isRecord, parseStoryCanvasSnapshot } from "./snapshot";
import type { NarrativeEdge, NarrativeNode, StoryCanvasSnapshot } from "./types";

export type CanvasSaveState = "idle" | "saving" | "saved" | "error";

type UseStoryDraftArgs = {
  /** The projectId from the URL — null for the projectless editor. */
  projectId?: string | null;
  nodes: NarrativeNode[];
  edges: NarrativeEdge[];
  storySpec: Record<string, unknown> | null;
  /** Mid staged-draw the canvas is intentionally partial — persistence holds off. */
  isAiDrawing: boolean;
  setNodes: Dispatch<SetStateAction<NarrativeNode[]>>;
  setEdges: Dispatch<SetStateAction<NarrativeEdge[]>>;
  setStorySpec: (spec: Record<string, unknown> | null) => void;
  setCanvasTitle: (title: string) => void;
};

/**
 * Owns the draft persistence lifecycle: hydrate-on-open (including the
 * generation-resume and rebuild-from-analysis branches), the debounced CAS
 * autosave, the projectless lazy create, and stale-write conflict
 * resolution. The generation flow mutates the exposed refs (revision /
 * snapshot base / active project) when it materializes a project itself.
 */
export function useStoryDraft({
  projectId,
  nodes,
  edges,
  storySpec,
  isAiDrawing,
  setNodes,
  setEdges,
  setStorySpec,
  setCanvasTitle,
}: UseStoryDraftArgs) {
  const reactFlow = useReactFlow<NarrativeNode, NarrativeEdge>();
  const router = useRouter();

  /** The live story project id — set by hydrate (the prop's project) or by
   *  the lazy create. Null until a project is actually loaded/created. */
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isCanvasLoading, setIsCanvasLoading] = useState(Boolean(projectId));
  const [hasHydratedCanvas, setHasHydratedCanvas] = useState(false);
  const [canvasLoadError, setCanvasLoadError] = useState<string | null>(null);
  const [canvasSaveState, setCanvasSaveState] = useState<CanvasSaveState>("idle");
  const [canvasSaveError, setCanvasSaveError] = useState<string | null>(null);
  /** Unresolved stale-write conflict (someone else's session updated the
   *  draft) — autosave pauses until the user picks a side. */
  const [draftConflict, setDraftConflict] = useState<DraftRevisionConflict | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);
  /** Set when hydration finds a generation still running server-side — the
   *  generation hook resumes the poll (survives refresh mid-generation). */
  const [pendingResumeProjectId, setPendingResumeProjectId] = useState<string | null>(null);

  const snapshotBaseRef = useRef<StoryCanvasSnapshot>({});
  const lastSavedSnapshotRef = useRef("");
  /** CAS token — the last draft revision this client read or received. */
  const revisionRef = useRef(0);
  /** Per-mount save session — lets the server tell us when a conflicting
   *  revision was in fact our own racing write (adopt silently). */
  const [sessionId] = useState(() => crypto.randomUUID());
  /** Mirrors activeProjectId so the hydrate effect can skip re-fetching the
   *  project we just lazily created (router.replace re-runs the page). Only
   *  ever set AFTER a successful hydrate or lazy create — never from the prop,
   *  or the initial load would be skipped. */
  const activeProjectIdRef = useRef<string | null>(null);
  /** Single-flight lock for the lazy create. */
  const lazyCreateInFlightRef = useRef(false);

  useEffect(() => {
    let isCancelled = false;

    async function hydrateCanvas() {
      // The lazy-create path already holds the live state for this project —
      // router.replace re-runs the page with the new projectId, and re-fetching
      // here would clobber edits made between create and navigation.
      if (projectId && projectId === activeProjectIdRef.current) return;

      setCanvasLoadError(null);
      setCanvasSaveError(null);
      setCanvasSaveState("idle");
      setDraftConflict(null);
      setHasHydratedCanvas(false);

      if (!projectId) {
        // Projectless editor: fully in-memory until the first meaningful
        // action lazily creates the story project (see the effect below).
        const emptySnapshot = buildStoryCanvasSnapshot({}, [], [], null);
        snapshotBaseRef.current = {};
        lastSavedSnapshotRef.current = JSON.stringify(emptySnapshot);
        revisionRef.current = 0;
        activeProjectIdRef.current = null;
        setActiveProjectId(null);
        setStorySpec(null);
        setCanvasTitle("未命名故事");
        setNodes([]);
        setEdges([]);
        setIsCanvasLoading(false);
        setHasHydratedCanvas(true);
        return;
      }

      setIsCanvasLoading(true);

      try {
        const project = await getStoryProject(projectId);

        if (isCancelled) return;

        const parsed = parseStoryCanvasSnapshot(project.draft.content);
        const parsedSpec = isRecord(parsed.base.storySpec)
          ? (parsed.base.storySpec as Record<string, unknown>)
          : null;
        const title =
          typeof parsed.base.title === "string" && parsed.base.title.trim()
            ? parsed.base.title
            : project.title;
        const snapshotForSignature = buildStoryCanvasSnapshot(
          parsed.base,
          parsed.nodes,
          parsed.edges,
          parsedSpec
        );

        snapshotBaseRef.current = parsed.base;
        lastSavedSnapshotRef.current = JSON.stringify(snapshotForSignature);
        revisionRef.current = project.draft.revision;
        activeProjectIdRef.current = project.id;
        setActiveProjectId(project.id);
        setStorySpec(parsedSpec);
        setCanvasTitle(title || "未命名故事");

        // Pipeline resume: the generation stage persists its state into the
        // draft server-side. Still RUNNING → re-enter the waiting experience
        // and poll (the run continues regardless of tabs). DONE but never
        // painted (timeout / closed tab) → rebuild the canvas from the
        // persisted analysis instead of re-burning the model; the next
        // autosave persists the painted canvas.
        const pipeline = draftPipelineState(project.draft.content);
        const persistedAnalysis = parsed.base.storyAnalysis;
        let paintedCount = parsed.nodes.length;
        if (parsed.nodes.length === 0 && pipeline?.status === "running") {
          setNodes([]);
          setEdges([]);
          setPendingResumeProjectId(project.id);
        } else if (
          parsed.nodes.length === 0 &&
          isRecord(persistedAnalysis) &&
          Array.isArray(persistedAnalysis.plots) &&
          persistedAnalysis.plots.length > 0
        ) {
          const rebuilt = buildNodesAndEdgesFromAnalysis(
            persistedAnalysis as unknown as StoryStudioAnalysis
          );
          paintedCount = rebuilt.nodes.length;
          setNodes(rebuilt.nodes);
          setEdges(rebuilt.edges);
        } else {
          setNodes(parsed.nodes);
          setEdges(parsed.edges);
        }
        // Frame the hydrated story once the nodes have been measured.
        window.setTimeout(() => {
          if (!isCancelled && paintedCount > 0) {
            void reactFlow.fitView({ padding: 0.1, maxZoom: 0.7 });
          }
        }, 80);
      } catch (error) {
        if (isCancelled) return;
        activeProjectIdRef.current = null;
        setActiveProjectId(null);
        setCanvasTitle("未命名故事");
        setNodes([]);
        setEdges([]);
        setCanvasLoadError(error instanceof Error ? error.message : "无法读取项目画布");
      } finally {
        if (!isCancelled) {
          setIsCanvasLoading(false);
          setHasHydratedCanvas(true);
        }
      }
    }

    void hydrateCanvas();

    return () => {
      isCancelled = true;
    };
  }, [projectId, reactFlow, setCanvasTitle, setEdges, setNodes, setStorySpec]);

  /** Adopt server draft state into the local tracking refs + canvas. */
  const adoptServerDraft = useCallback(
    (content: Record<string, unknown>, revision: number) => {
      const parsed = parseStoryCanvasSnapshot(content);
      const parsedSpec = isRecord(parsed.base.storySpec)
        ? (parsed.base.storySpec as Record<string, unknown>)
        : null;
      snapshotBaseRef.current = parsed.base;
      lastSavedSnapshotRef.current = JSON.stringify(
        buildStoryCanvasSnapshot(parsed.base, parsed.nodes, parsed.edges, parsedSpec)
      );
      revisionRef.current = revision;
      setStorySpec(parsedSpec);
      if (typeof parsed.base.title === "string" && parsed.base.title.trim()) {
        setCanvasTitle(parsed.base.title);
      }
      setNodes(parsed.nodes);
      setEdges(parsed.edges);
    },
    [setCanvasTitle, setEdges, setNodes, setStorySpec]
  );

  // Debounced CAS autosave to the sovereign story-draft route.
  useEffect(() => {
    if (!hasHydratedCanvas || isCanvasLoading || !activeProjectId) return;
    // A stale-write conflict pauses autosave until the user picks a side —
    // retrying with a poisoned revision would just 409 every 700ms.
    if (draftConflict) return;
    // Mid staged-draw the canvas is intentionally partial — save once the
    // full analyzed story has landed.
    if (isAiDrawing) return;

    const timer = window.setTimeout(async () => {
      // Snapshot + signature are computed INSIDE the debounce window: doing
      // it per render tick would stringify the whole canvas on every drag
      // frame for nothing.
      const nextSnapshot = buildStoryCanvasSnapshot(
        snapshotBaseRef.current,
        nodes,
        edges,
        storySpec
      );
      const nextSignature = JSON.stringify(nextSnapshot);
      if (nextSignature === lastSavedSnapshotRef.current) return;

      setCanvasSaveState("saving");
      setCanvasSaveError(null);

      try {
        const saved = await putStoryDraft(activeProjectId, {
          content: nextSnapshot,
          revision: revisionRef.current,
          sessionId,
        });

        snapshotBaseRef.current = nextSnapshot;
        lastSavedSnapshotRef.current = nextSignature;
        revisionRef.current = saved.revision;
        setCanvasSaveState("saved");
      } catch (error) {
        const conflict = draftRevisionConflict(error);
        if (conflict) {
          if (conflict.updatedBySessionId === sessionId) {
            // Our own racing write already landed (e.g. a retried request) —
            // adopt the revision silently and re-save the latest local state.
            try {
              const retried = await putStoryDraft(activeProjectId, {
                content: nextSnapshot,
                revision: conflict.currentRevision,
                sessionId,
              });
              snapshotBaseRef.current = nextSnapshot;
              lastSavedSnapshotRef.current = nextSignature;
              revisionRef.current = retried.revision;
              setCanvasSaveState("saved");
              return;
            } catch (retryError) {
              const retryConflict = draftRevisionConflict(retryError);
              if (retryConflict && retryConflict.updatedBySessionId !== sessionId) {
                setDraftConflict(retryConflict);
                setCanvasSaveState("error");
                return;
              }
              setCanvasSaveState("error");
              setCanvasSaveError(
                retryError instanceof Error ? retryError.message : "Failed to save the canvas"
              );
              return;
            }
          }
          // Someone else's session updated the draft — surface the banner.
          setDraftConflict(conflict);
          setCanvasSaveState("error");
          return;
        }
        setCanvasSaveState("error");
        setCanvasSaveError(error instanceof Error ? error.message : "Failed to save the canvas");
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [
    activeProjectId,
    draftConflict,
    edges,
    hasHydratedCanvas,
    isAiDrawing,
    isCanvasLoading,
    nodes,
    sessionId,
    storySpec,
  ]);

  // Lazy create (projectless editor ONLY): on the first meaningful action —
  // the AI analyze completing or the first node added by any path — persist
  // the in-memory canvas as a real story project and put its id in the URL.
  // A project that FAILED to hydrate must never silently fork into a new one,
  // hence the `projectId` (prop) guard.
  useEffect(() => {
    if (!hasHydratedCanvas || isCanvasLoading || projectId) return;
    if (activeProjectId || nodes.length === 0) return;
    // The staged draw is one meaningful action — create once it completes,
    // with the full analyzed canvas, not a mid-animation slice.
    if (isAiDrawing) return;
    if (lazyCreateInFlightRef.current) return;
    lazyCreateInFlightRef.current = true;

    const content = buildStoryCanvasSnapshot(snapshotBaseRef.current, nodes, edges, storySpec);
    const signature = JSON.stringify(content);

    void createStoryProject({ content })
      .then((project) => {
        lastSavedSnapshotRef.current = signature;
        revisionRef.current = project.draft.revision;
        activeProjectIdRef.current = project.id;
        setActiveProjectId(project.id);
        setCanvasSaveState("saved");
        // Reflect the project in the URL; the hydrate effect skips re-fetching
        // (activeProjectIdRef already points at this project).
        router.replace(`/story-studio/editor?projectId=${project.id}`);
      })
      .catch((error: unknown) => {
        // Stay in-memory ("Not saved yet"); the next edit retries the create.
        setCanvasSaveError(error instanceof Error ? error.message : "Failed to save the canvas");
        setCanvasSaveState("error");
      })
      .finally(() => {
        lazyCreateInFlightRef.current = false;
      });
  }, [
    activeProjectId,
    edges,
    hasHydratedCanvas,
    isAiDrawing,
    isCanvasLoading,
    nodes,
    projectId,
    router,
    storySpec,
  ]);

  /** Conflict banner: discard local edits and load the server's draft. */
  const resolveConflictLoadLatest = useCallback(() => {
    if (!draftConflict || conflictBusy) return;
    adoptServerDraft(draftConflict.content, draftConflict.currentRevision);
    setDraftConflict(null);
    setCanvasSaveState("saved");
    setCanvasSaveError(null);
  }, [adoptServerDraft, conflictBusy, draftConflict]);

  /** Conflict banner: keep local edits — retry the save on top of the server
   *  revision (a deliberate overwrite, not a blind CAS retry). */
  const resolveConflictOverwrite = useCallback(async () => {
    if (!draftConflict || conflictBusy || !activeProjectId) return;
    setConflictBusy(true);
    setCanvasSaveState("saving");
    try {
      const content = buildStoryCanvasSnapshot(snapshotBaseRef.current, nodes, edges, storySpec);
      const saved = await putStoryDraft(activeProjectId, {
        content,
        revision: draftConflict.currentRevision,
        sessionId,
      });
      snapshotBaseRef.current = content;
      lastSavedSnapshotRef.current = JSON.stringify(content);
      revisionRef.current = saved.revision;
      setDraftConflict(null);
      setCanvasSaveState("saved");
      setCanvasSaveError(null);
    } catch (error) {
      // The draft moved again mid-resolution — refresh the banner's baseline.
      const conflict = draftRevisionConflict(error);
      if (conflict) {
        setDraftConflict(conflict);
      } else {
        setCanvasSaveError(error instanceof Error ? error.message : "Failed to save the canvas");
      }
      setCanvasSaveState("error");
    } finally {
      setConflictBusy(false);
    }
  }, [activeProjectId, conflictBusy, draftConflict, edges, nodes, sessionId, storySpec]);

  const clearPendingResume = useCallback(() => {
    setPendingResumeProjectId(null);
  }, []);

  return {
    activeProjectId,
    setActiveProjectId,
    activeProjectIdRef,
    revisionRef,
    snapshotBaseRef,
    sessionId,
    isCanvasLoading,
    hasHydratedCanvas,
    canvasLoadError,
    canvasSaveState,
    canvasSaveError,
    draftConflict,
    conflictBusy,
    resolveConflictLoadLatest,
    resolveConflictOverwrite,
    pendingResumeProjectId,
    clearPendingResume,
  };
}

export type StoryDraftController = ReturnType<typeof useStoryDraft>;
