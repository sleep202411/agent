"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useReactFlow, useUpdateNodeInternals } from "@xyflow/react";
import { useRouter } from "@/i18n/navigation";
import {
  createStoryProject,
  pollStoryAnalysis,
  startStoryAnalysis,
  type StoryDraft,
  type StoryStudioAnalysis,
} from "@/lib/story-projects-api";
import { fetchRandomIpSeeds, type IpStarterSeed } from "@/lib/ip-seeds-api";
import { buildNodesAndEdgesFromAnalysis } from "./analysis-to-canvas";
import { isRecord } from "./snapshot";
import type { NarrativeEdge, NarrativeNode } from "./types";
import type { StoryDraftController } from "./use-story-draft";

export type EmptyCanvasStarter = {
  key: string;
  title: string;
  description: string;
  prompt: string;
  image?: string | null;
};

type UseStoryGenerationArgs = {
  draft: StoryDraftController;
  isAiDrawing: boolean;
  setIsAiDrawing: (drawing: boolean) => void;
  setNodes: Dispatch<SetStateAction<NarrativeNode[]>>;
  setEdges: Dispatch<SetStateAction<NarrativeEdge[]>>;
  setStorySpec: (spec: Record<string, unknown> | null) => void;
  setCanvasTitle: (title: string) => void;
};

/**
 * Owns the StoryOS generation flow: the empty-canvas intake state, the
 * async start→poll pipeline (including refresh-resume via the draft hook's
 * pendingResumeProjectId), and the staged "AI is drawing" reveal.
 */
export function useStoryGeneration({
  draft,
  isAiDrawing,
  setIsAiDrawing,
  setNodes,
  setEdges,
  setStorySpec,
  setCanvasTitle,
}: UseStoryGenerationArgs) {
  // Destructured so callbacks can depend on the STABLE pieces (refs, state
  // setters, primitives) instead of the per-render controller object.
  const {
    activeProjectId,
    setActiveProjectId,
    activeProjectIdRef,
    revisionRef,
    snapshotBaseRef,
    sessionId,
    pendingResumeProjectId,
    clearPendingResume,
  } = draft;

  const reactFlow = useReactFlow<NarrativeNode, NarrativeEdge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const router = useRouter();

  const [emptyCanvasPrompt, setEmptyCanvasPrompt] = useState("");
  const [emptyCanvasUploadName, setEmptyCanvasUploadName] = useState<string | null>(null);
  const [emptyCanvasUploadContent, setEmptyCanvasUploadContent] = useState<string | null>(null);
  const [emptyCanvasAnalyzeState, setEmptyCanvasAnalyzeState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [emptyCanvasAnalyzeError, setEmptyCanvasAnalyzeError] = useState<string | null>(null);
  /** Random public IPs backing the intake starter cards (null → curated
   *  fallback while loading / when the plaza pool is empty). */
  const [ipStarters, setIpStarters] = useState<IpStarterSeed[] | null>(null);
  const aiDrawTokenRef = useRef(0);
  const emptyCanvasUploadRef = useRef<HTMLInputElement | null>(null);
  const emptyCanvasInputRef = useRef<HTMLInputElement | null>(null);

  // Feed the intake starter cards with REAL plaza IPs, randomly picked.
  useEffect(() => {
    let cancelled = false;
    const locale =
      typeof window === "undefined"
        ? undefined
        : window.location.pathname.split("/").filter(Boolean)[0];
    fetchRandomIpSeeds(4, locale)
      .then((items) => {
        if (!cancelled && items.length > 0) setIpStarters(items);
      })
      .catch(() => {
        // Plaza unreachable / empty — the intake simply shows no seed cards.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const emptyCanvasStarters = useMemo<EmptyCanvasStarter[]>(
    () =>
      ipStarters && ipStarters.length > 0
        ? ipStarters.map((seed) => ({
            key: seed.id,
            title: seed.title,
            description: "Generate with StoryOS",
            prompt:
              `Turn the IP "${seed.title}" into a playable text story with a clear story root, ` +
              `plot spine, clues, characters, and endings.` +
              (seed.summary ? ` Synopsis: ${seed.summary}` : ""),
            image: seed.coverUrl,
          }))
        : [],
    [ipStarters]
  );

  /** The "AI is drawing" reveal: stage the analyzed story onto the canvas
   *  element by element — root first, then cast/plots/clues/endings in the
   *  builder's order, each edge appearing once both endpoints exist. The
   *  data is the REAL analysis result, only its arrival is choreographed.
   *  Resolves after the last element (and its entrance) has settled. */
  const playAiDrawing = useCallback(
    async (generated: { nodes: NarrativeNode[]; edges: NarrativeEdge[] }) => {
      const token = ++aiDrawTokenRef.current;
      const alive = () => aiDrawTokenRef.current === token;
      const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
      // The whole reveal targets ~5s regardless of story size.
      const stepMs = Math.max(
        110,
        Math.min(320, Math.floor(4600 / Math.max(1, generated.nodes.length)))
      );

      setIsAiDrawing(true);
      setNodes([]);
      setEdges([]);
      // Frame the fan (root + lane heads) while it draws; the exact fit
      // happens once the last element has landed.
      reactFlow.setViewport({ x: 60, y: 330, zoom: 0.4 });

      const placed = new Set<string>();
      let pendingEdges = [...generated.edges];
      try {
        for (const node of generated.nodes) {
          if (!alive()) return;
          placed.add(node.id);
          setNodes((current) => [...current, { ...node, className: "fizz-node-enter" }]);
          const ready = pendingEdges.filter(
            (edge) => placed.has(edge.source) && placed.has(edge.target)
          );
          if (ready.length > 0) {
            pendingEdges = pendingEdges.filter((edge) => !ready.includes(edge));
            setEdges((current) => [
              ...current,
              ...ready.map((edge) => ({ ...edge, className: "fizz-edge-enter" })),
            ]);
          }
          await sleep(stepMs);
        }
        if (!alive()) return;
        // Safety net: edges whose endpoints never both appeared (malformed
        // analysis) still land rather than silently vanishing.
        if (pendingEdges.length > 0) {
          setEdges((current) => [...current, ...pendingEdges]);
        }
        await sleep(380);
        if (!alive()) return;
        // Drop the entrance classes so the settled canvas is clean.
        setNodes((current) =>
          current.map((node) => (node.className ? { ...node, className: undefined } : node))
        );
        setEdges((current) =>
          current.map((edge) => (edge.className ? { ...edge, className: undefined } : edge))
        );
        // Re-measure handles now that the scale-in animation has settled —
        // React Flow captures handle offsets when a node mounts, i.e. while
        // `fizz-node-enter` still has it scaled down; without this pass the
        // edges stay anchored at the shrunken positions.
        window.requestAnimationFrame(() => {
          updateNodeInternals(generated.nodes.map((node) => node.id));
        });
        void reactFlow.fitView({ padding: 0.1, duration: 700, maxZoom: 0.7 });
      } finally {
        if (alive()) setIsAiDrawing(false);
      }
    },
    [reactFlow, setEdges, setIsAiDrawing, setNodes, updateNodeInternals]
  );

  /** Terminal-state painter shared by the click flow and refresh-resume:
   *  adopt the persisted draft (revision + spec), sync the snapshot base,
   *  then stage the analyzed story onto the canvas. */
  const adoptGeneratedAnalysis = useCallback(
    async (analysis: StoryStudioAnalysis, draftState: StoryDraft) => {
      revisionRef.current = draftState.revision;
      setStorySpec(
        isRecord(draftState.content.storySpec)
          ? (draftState.content.storySpec as Record<string, unknown>)
          : null
      );
      snapshotBaseRef.current = {
        ...snapshotBaseRef.current,
        title: analysis.title,
        summary: analysis.summary,
        storyAnalysis: analysis as unknown as Record<string, unknown>,
      };
      setCanvasTitle(analysis.title);
      setEmptyCanvasAnalyzeState("idle");
      setEmptyCanvasAnalyzeError(null);
      await playAiDrawing(buildNodesAndEdgesFromAnalysis(analysis));
    },
    [playAiDrawing, revisionRef, setCanvasTitle, setStorySpec, snapshotBaseRef]
  );

  // Refresh-resume: hydration found a generation still running server-side —
  // poll the draft to its terminal state and paint exactly like a live run.
  // While the poll runs, `showAnalyzeLoading` derives the waiting UI from
  // pendingResumeProjectId — no analyze-state write needed here.
  useEffect(() => {
    if (!pendingResumeProjectId) return;
    let cancelled = false;

    void (async () => {
      try {
        const { analysis, draft: draftState } = await pollStoryAnalysis(pendingResumeProjectId);
        if (cancelled) return;
        await adoptGeneratedAnalysis(analysis, draftState);
      } catch (error) {
        if (cancelled) return;
        setEmptyCanvasAnalyzeState("error");
        setEmptyCanvasAnalyzeError(error instanceof Error ? error.message : "Analyze failed.");
      } finally {
        if (!cancelled) clearPendingResume();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adoptGeneratedAnalysis, clearPendingResume, pendingResumeProjectId]);

  const createStoryRootFromEmptyState = useCallback(async () => {
    const prompt = emptyCanvasPrompt.trim();

    if (!prompt && !emptyCanvasUploadContent) {
      setEmptyCanvasAnalyzeState("error");
      setEmptyCanvasAnalyzeError("Please describe the story or upload a text document first.");
      emptyCanvasInputRef.current?.focus();
      return;
    }

    setEmptyCanvasAnalyzeState("loading");
    setEmptyCanvasAnalyzeError(null);

    try {
      const locale =
        typeof window === "undefined"
          ? "en-US"
          : (window.location.pathname.split("/").filter(Boolean)[0] ?? "en-US");

      // Starting generation IS the first meaningful action — materialize the
      // project up front so the server-side stage has a draft to persist into
      // (resumable pipeline, docs/story-studio-creator-v3-refactor.md §D3).
      let projectId = activeProjectId;
      if (!projectId) {
        const project = await createStoryProject({ locale });
        projectId = project.id;
        activeProjectIdRef.current = project.id;
        setActiveProjectId(project.id);
        revisionRef.current = project.draft.revision;
        router.replace(`/story-studio/editor?projectId=${project.id}`);
      }

      // Async stage: start returns immediately (proxy-timeout-proof); the
      // model run persists into the draft and we poll for the terminal state.
      await startStoryAnalysis(projectId, {
        prompt: prompt || undefined,
        uploadedFileName: emptyCanvasUploadName ?? undefined,
        uploadedContent: emptyCanvasUploadContent ?? undefined,
        locale,
        sessionId,
      });
      const { analysis, draft: draftState } = await pollStoryAnalysis(projectId);
      await adoptGeneratedAnalysis(analysis, draftState);
    } catch (error) {
      setEmptyCanvasAnalyzeState("error");
      setEmptyCanvasAnalyzeError(error instanceof Error ? error.message : "Analyze failed.");
    }
  }, [
    activeProjectId,
    activeProjectIdRef,
    adoptGeneratedAnalysis,
    emptyCanvasPrompt,
    emptyCanvasUploadContent,
    emptyCanvasUploadName,
    revisionRef,
    router,
    sessionId,
    setActiveProjectId,
  ]);

  /** Intake file picker: read the selected text document into the prompt
   *  payload (truncated to the analyze route's input cap). */
  const handleUploadChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setEmptyCanvasAnalyzeError(null);
    setEmptyCanvasUploadName(file?.name ?? null);
    setEmptyCanvasUploadContent(null);

    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setEmptyCanvasUploadContent(
        typeof reader.result === "string" ? reader.result.slice(0, 80000) : ""
      );
    };
    reader.onerror = () => {
      setEmptyCanvasAnalyzeState("error");
      setEmptyCanvasAnalyzeError("Could not read the selected text document.");
    };
    reader.readAsText(file);
  }, []);

  /** Intake starter card: seed the prompt (never clobbering typed input). */
  const applyStarterPrompt = useCallback((starter: EmptyCanvasStarter) => {
    setEmptyCanvasPrompt((current) => current || starter.prompt);
    setEmptyCanvasAnalyzeError(null);
    window.setTimeout(() => emptyCanvasInputRef.current?.focus(), 0);
  }, []);

  /** True from the hydrate commit that detected a running generation until
   *  the resume effect takes over — keeps the glow/intake state seamless. */
  const isResuming = Boolean(pendingResumeProjectId);
  const showAnalyzeLoading = emptyCanvasAnalyzeState === "loading" || isResuming;

  return {
    isAiDrawing,
    emptyCanvasPrompt,
    setEmptyCanvasPrompt,
    emptyCanvasUploadName,
    emptyCanvasAnalyzeState,
    emptyCanvasAnalyzeError,
    emptyCanvasStarters,
    emptyCanvasUploadRef,
    emptyCanvasInputRef,
    createStoryRootFromEmptyState,
    handleUploadChange,
    applyStarterPrompt,
    showAnalyzeLoading,
  };
}

export type StoryGenerationController = ReturnType<typeof useStoryGeneration>;
