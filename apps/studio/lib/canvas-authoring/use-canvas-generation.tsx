"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/app/_components/auth-provider";
import { ComputeRechargeDialog } from "@/app/_components/compute-recharge-dialog";
import type { CanvasAsset } from "@/lib/canvas-core/types";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import { ApiRequestError } from "@/lib/api";
import { getAssetsRealtimeKernel } from "./assets-realtime-kernel";
import { outputKindForType } from "./reference-routing";
import { routeTargetReferenceField } from "./canvas-wiring";
import { SHOT_NODE_TYPE } from "./shot-node";
import { isGenerationNodeType } from "./generation-node-types";
import {
  computeWalletBalanceQueryKey,
  useComputeWalletBalance,
} from "@/app/_components/credits-badge";
import { useProjectPayerWorkspace } from "@/app/[locale]/project/_components/project-context";
import {
  ReferenceInputError,
  buildReferenceInputForMode,
  buildPromptDocument,
  buildPromptReferenceBindingsForMode,
  cancelFizzAiJob,
  compactFizzAiInput,
  defaultMode,
  estimateModelSellPoints,
  filterFizzAiInput,
  generationIdempotencyKey,
  generationInputHasBlockingIssues,
  generationStateFromJob,
  generationStatusFromRaw,
  getFizzAiJob,
  listFizzAiJobs,
  isTerminalGenerationStatus,
  mediaSnapshotsForMode,
  normalizeModelSettings,
  promptRequired,
  normalizeFizzAiError,
  referenceFieldsForMode,
  submitFizzAiJob,
  validateModelGenerationInput,
  type FizzAiCatalog,
  type FizzAiJobView,
  type FizzAiSourceSurface,
  type FizzAiSubmitJobInput,
  type GenerationState,
  type ValidationIssue,
} from "./generation-api";
import {
  acceptsSubmissionResponse,
  isUncertainSubmission,
  matchesCanvasJob,
  needsJobRecovery,
} from "./canvas-job-recovery";
import { probeMediaDurationSeconds } from "./probe-media-duration";
import {
  compatibleProjectSkillInstallations,
  composePromptWithProjectSkills,
  generationSkillScope,
  resolveEffectiveProjectSkills,
  sanitizeProjectSkillSelection,
  type CanvasProjectSkillSelection,
} from "@/lib/project-skill-runtime";
import type {
  ProjectSkillInstallation,
  ProjectSkillInstallationsResponse,
  ProjectSkillSelection,
} from "@/lib/project-skills-api";

/** Reconcile cadence while a card is running — slower when realtime is healthy. */
const DISCONNECTED_FALLBACK_INTERVAL_MS = 5_000;
const CONNECTED_RECONCILE_INTERVAL_MS = 15_000;

/** Minimal shape this orchestrator reads off a generation node's data. */
type GenNodeData = {
  prompt?: string;
  modelId?: string;
  mode?: string;
  settings?: Record<string, string | number | boolean>;
  references?: Record<
    string,
    {
      id: string;
      url: string;
      kind?: "image" | "video" | "audio";
      name?: string;
      assetId?: string;
      edgeId?: string;
      sourceNodeId?: string;
      uploading?: boolean;
      durationSeconds?: number | null;
      bytes?: number | null;
      width?: number | null;
      height?: number | null;
    }[]
  >;
  generation?: GenerationState;
  skillSelection?: CanvasProjectSkillSelection;
};

/** An equirectangular (~2:1) image output is a panorama. */
function isPanoramaOutput(out: { type: string; width?: number; height?: number } | undefined) {
  return (
    out?.type === "image" &&
    !!out.width &&
    !!out.height &&
    Math.abs(out.width / out.height - 2) < 0.15
  );
}

function removeMediaAssetFromGeneration(
  generation: GenerationState | undefined,
  mediaAssetId: string,
  unavailableMessage: string
): GenerationState | undefined {
  if (!generation?.outputs?.length) return generation;
  const outputs = generation.outputs.filter((output) => output.assetId !== mediaAssetId);
  if (outputs.length === generation.outputs.length) return generation;
  return {
    ...generation,
    outputs,
    status: outputs.length > 0 ? generation.status : "failed",
    error: outputs.length > 0 ? generation.error : unavailableMessage,
  };
}

/**
 * Structural equality over JSON-ish values; `undefined` properties count as
 * absent (a state freshly built by `generationStateFromJob` carries explicit
 * `progress: undefined` etc., while the same state read back from the Y.Doc
 * simply lacks the key — those must compare equal).
 */
function isSameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => isSameJsonValue(item, b[i]));
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keysA = Object.keys(ra).filter((k) => ra[k] !== undefined);
    const keysB = Object.keys(rb).filter((k) => rb[k] !== undefined);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => isSameJsonValue(ra[k], rb[k]));
  }
  return false;
}

function removeReferencesFromSources(
  references: GenNodeData["references"],
  sourceNodeIds: Set<string>
): GenNodeData["references"] {
  if (!references || sourceNodeIds.size === 0) return references;
  let changed = false;
  const next: NonNullable<GenNodeData["references"]> = {};
  for (const [field, list] of Object.entries(references)) {
    const filtered = list.filter((reference) => !sourceNodeIds.has(reference.sourceNodeId ?? ""));
    if (filtered.length !== list.length) changed = true;
    if (filtered.length > 0) next[field] = filtered;
  }
  return changed ? next : references;
}

type GenerationContextValue = {
  submit: (nodeId: string) => void;
  cancel: (nodeId: string) => void;
  canSubmit: boolean;
  disabledReason: string | null;
  /** Catalog-driven preflight issues for a node (cleared on successful submit path). */
  preflightIssues: (nodeId: string) => ValidationIssue[];
  clearPreflightIssues: (nodeId: string) => void;
};

type RechargePromptState = {
  available?: bigint | null;
  modelName?: string;
  required?: number | null;
};

const GenerationContext = createContext<GenerationContextValue | null>(null);

/** Cards call this to submit / cancel themselves; no-ops outside a provider. */
export function useGeneration(): GenerationContextValue {
  return (
    useContext(GenerationContext) ?? {
      submit: () => {},
      cancel: () => {},
      canSubmit: false,
      disabledReason: null,
      preflightIssues: () => [],
      clearPreflightIssues: () => {},
    }
  );
}

function generationCost(model: FizzAiCatalog["models"][number], data: GenNodeData): number | null {
  const mode = data.mode ?? defaultMode(model);
  const settings = normalizeModelSettings(model, data.settings ?? {});
  const refFields = referenceFieldsForMode(model, mode);
  const uploadedReferenceCount = refFields
    .filter((field) => field.kind === "image")
    .reduce((count, field) => count + (data.references?.[field.field]?.length ?? 0), 0);
  const referenceVideoSeconds = refFields
    .filter((field) => field.kind === "video")
    .reduce(
      (seconds, field) =>
        seconds +
        (data.references?.[field.field] ?? []).reduce(
          (fieldSeconds, reference) =>
            fieldSeconds +
            (typeof reference.durationSeconds === "number" &&
            Number.isFinite(reference.durationSeconds)
              ? reference.durationSeconds
              : 0),
          0
        ),
      0
    );
  return (
    estimateModelSellPoints(model, {
      text: data.prompt,
      numOutputs: Number(settings.numOutputs ?? settings.n ?? 1) || 1,
      resolution: settings.resolution != null ? String(settings.resolution) : undefined,
      quality: settings.quality != null ? String(settings.quality) : undefined,
      duration: settings.duration != null ? String(settings.duration) : undefined,
      durationSeconds:
        typeof settings.durationSeconds === "number" ? settings.durationSeconds : undefined,
      generateAudio:
        typeof settings.generateAudio === "boolean" ? settings.generateAudio : undefined,
      referenceImageCount: uploadedReferenceCount || undefined,
      referenceVideoSeconds: referenceVideoSeconds || undefined,
    })?.sellPoints ?? null
  );
}

function insufficientComputePointDetails(
  error: unknown
): { available?: bigint; required?: number } | null {
  const text = error instanceof Error ? error.message : "";
  let parsed: unknown;
  if (error instanceof ApiRequestError && error.responseBody) {
    try {
      parsed = JSON.parse(error.responseBody);
    } catch {
      parsed = undefined;
    }
  }
  const envelopes = [
    parsed,
    parsed && typeof parsed === "object" ? (parsed as { message?: unknown }).message : null,
  ].filter((value): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object")
  );
  const code = envelopes
    .map((value) => value.code)
    .find((value): value is string => typeof value === "string");
  const isInsufficient =
    code === "INSUFFICIENT_COMPUTE_POINTS" ||
    code === "INSUFFICIENT_UNEXPIRED_COMPUTE_POINTS" ||
    /not enough (usable )?compute points/i.test(text) ||
    /insufficient.*compute/i.test(text);
  if (!isInsufficient) return null;
  const detail = envelopes.find((value) => value.requiredAmount || value.availableBalance);
  const requiredRaw = detail?.requiredAmount;
  const availableRaw = detail?.availableBalance;
  return {
    required:
      typeof requiredRaw === "string" && /^\d+$/.test(requiredRaw)
        ? Number(requiredRaw)
        : undefined,
    available:
      typeof availableRaw === "string" && /^-?\d+$/.test(availableRaw)
        ? BigInt(availableRaw)
        : undefined,
  };
}

/**
 * Owns the canvas's generation loop: one realtime subscription routes every
 * `ai_job_update` to the node whose `generation.jobId` matches, and `submit`
 * sends a card's prompt + schema settings to `/aurora/ai/jobs` bound to its
 * block. Lives at the canvas level (it writes back to nodes); cards only call
 * `submit(nodeId)` via context.
 */
export function CanvasGenerationProvider({
  catalog,
  context,
  projectSkills,
  canGenerate = true,
  disabledReason = null,
  children,
}: {
  catalog: FizzAiCatalog | undefined;
  context: {
    projectId?: string;
    storyProjectId?: string;
    documentId?: string;
    sourceSurface: FizzAiSourceSurface;
  };
  projectSkills: {
    data: ProjectSkillInstallationsResponse | undefined;
    loading: boolean;
    error: boolean;
  };
  canGenerate?: boolean;
  disabledReason?: string | null;
  children: React.ReactNode;
}) {
  const t = useTranslations("canvasOps");
  const ts = useTranslations("project.skills");
  const generationProjectId = context.projectId;
  const generationStoryProjectId = context.storyProjectId;
  const generationDocumentId = context.documentId;
  const sourceSurface = context.sourceSurface;
  const projectSkillsReady = !projectSkills.loading && !projectSkills.error && !!projectSkills.data;
  const effectiveDisabledReason = projectSkillsReady ? disabledReason : ts("generationUnavailable");
  // Destructured mutators/accessors are individually stable (useCallback in
  // useCanvasGraph), unlike the graph object itself whose identity tracks
  // nodes/edges. Every callback and effect below depends on these — NEVER on
  // the whole graph — so the realtime subscription and the reconcile loop stay
  // armed exactly once instead of re-firing (and re-fetching) per re-derive.
  // `getNodes` reads the document synchronously and is stable per document, so
  // the realtime subscription arms once instead of re-arming on every graph
  // re-derive — and it sees a write made earlier in the same turn. Reading the
  // graph rather than React Flow's store is also what lets a NON-canvas
  // rendering of the same document (the storyboard table) host this provider
  // and get the identical generation loop.
  const {
    addAssets,
    addNode,
    getEdges,
    getNode,
    getNodes,
    nodes,
    patchNodeData,
    removeAssetsByMediaAssetId,
    removeEdge,
    removeNode,
  } = useCanvasGraphContext();
  const queryClient = useQueryClient();
  const { data: wallet } = useComputeWalletBalance();
  const { user } = useAuth();
  const userId = user?.id != null ? String(user.id) : undefined;
  const [rechargePrompt, setRechargePrompt] = useState<RechargePromptState | null>(null);
  const [preflightByNode, setPreflightByNode] = useState<Record<string, ValidationIssue[]>>({});
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("previewRecharge")) return;
    const timer = window.setTimeout(() => {
      setRechargePrompt({ available: BigInt(0), required: 305, modelName: "Seedance 2.0" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  // Latest catalog without re-subscribing the realtime loop on catalog load
  // (the completion back-fill reads it to resolve downstream models).
  const catalogRef = useRef(catalog);
  useEffect(() => {
    catalogRef.current = catalog;
  }, [catalog]);

  const patch = useCallback(
    (nodeId: string, generation: GenerationState) => patchNodeData(nodeId, { generation }),
    [patchNodeData]
  );

  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const reconciling = useRef(false);
  const submittingNodes = useRef(new Set<string>());

  /**
   * Apply one job update to the card whose `generation.jobId` matches. Shared by
   * the realtime push and the reconciler so both converge on identical behavior
   * (panorama conversion, downstream reference back-fill, asset library, wallet
   * refresh). A card that already reached a terminal state is never regressed,
   * so a slow reconcile fetch can't overwrite a newer realtime completion.
   */
  const applyJobUpdate = useCallback(
    (job: FizzAiJobView) => {
      const out = job.outputs?.[0];
      const incoming = generationStatusFromRaw(job.status);

      // Find the node this job belongs to (sync read) so we can decide whether
      // to convert it to a panorama node + drop its now-dangling input wire.
      const match = getNodes().find(
        (n) => isGenerationNodeType(n.type) && matchesCanvasJob(n, job)
      );
      const matchData = match?.data as GenNodeData | undefined;

      // Never downgrade a card that already settled into a terminal state.
      if (
        match &&
        matchData?.generation &&
        isTerminalGenerationStatus(matchData.generation.status) &&
        !isTerminalGenerationStatus(incoming)
      ) {
        return;
      }

      const isPanoCard =
        !!matchData &&
        (matchData.mode === "image_to_panorama" ||
          /hunyuan|panorama|world/i.test(matchData.modelId ?? ""));
      // A finished panorama card becomes a panorama node: a live inline 360
      // view (three.js), no composer — same as a dropped panorama asset.
      const convert =
        !!match && incoming === "done" && isPanoCard && isPanoramaOutput(out) && !!out?.url;

      if (match) {
        if (convert) {
          // Remove + re-add with the same id (preserves position/selection + the
          // input wire — the panorama node has an input handle, so the
          // source→panorama wire stays as provenance instead of being dropped).
          const src = out!.url ?? out!.accessUrl;
          removeNode(match.id);
          addNode({
            id: match.id,
            type: "panorama",
            position: match.position,
            data: { src, mediaAssetId: out?.assetId, label: matchData?.prompt },
          });
        } else {
          const nextGeneration = {
            ...generationStateFromJob(job),
            submissionKey: matchData?.generation?.submissionKey ?? job.idempotencyKey,
          };
          // No-op update (a reconnect/focus reconcile re-fetching a state we
          // already hold): apply nothing. Writing the identical object into
          // the CRDT would broadcast to peers, force a graph re-derive, and —
          // while a card is running — feed a render→reconcile→write loop.
          // Every side effect below already ran when this state first landed.
          if (isSameJsonValue(matchData?.generation, nextGeneration)) return;
          patchNodeData(match.id, { generation: nextGeneration });
          // Back-fill downstream references. A card wired to this node BEFORE it
          // had an output (a preset, or wire-then-generate) binds nothing at
          // connect time. Now that an output exists, push its URL into every card
          // wired from this node — mirroring onConnect's binding so the wire is
          // functional, not just drawn.
          const doneUrl = incoming === "done" ? (out?.url ?? out?.accessUrl) : null;
          const kind = outputKindForType(out?.type);
          if (doneUrl && kind) {
            for (const edge of getEdges()) {
              if (edge.source !== match.id || !edge.target) continue;
              const edgeId = edge.id;
              // Resolve the target slot INSIDE the patch from the node's CURRENT
              // data, so a card wired from multiple sources (or re-modelled
              // meanwhile) routes against fresh state, not a stale snapshot.
              // A target that takes no pictures (or has no room) routes to
              // nothing and is left alone; a shot's frame/clip slot is filled
              // exactly like a card's reference field.
              patchNodeData(edge.target, (node) => {
                const tdata = node.data as GenNodeData;
                const routed = routeTargetReferenceField(node, catalogRef.current, kind, edgeId);
                if (!routed) return {};
                const refs = tdata.references ?? {};
                const list = (refs[routed.field] ?? []).filter((r) => r.edgeId !== edgeId);
                return {
                  references: {
                    ...refs,
                    [routed.field]: [
                      ...list,
                      {
                        id: edgeId,
                        edgeId,
                        sourceNodeId: match.id,
                        url: doneUrl,
                        kind,
                        ...(matchData?.prompt?.trim() ? { name: matchData.prompt.trim() } : {}),
                        ...(out?.assetId ? { assetId: out.assetId } : {}),
                        ...(typeof out?.durationSeconds === "number"
                          ? { durationSeconds: out.durationSeconds }
                          : {}),
                        ...(typeof out?.bytes === "number" ? { bytes: out.bytes } : {}),
                        ...(typeof out?.width === "number" ? { width: out.width } : {}),
                        ...(typeof out?.height === "number" ? { height: out.height } : {}),
                      },
                    ],
                  },
                };
              });
            }
          }
        }
      }

      // A finished job's outputs join the project's persistent asset library
      // (deduped by id, so repeated pushes are harmless).
      if (incoming === "done" && job.outputs?.length) {
        addAssets(
          job.outputs
            .map((output, index): CanvasAsset | null => {
              const url = output.url ?? output.accessUrl;
              if (!url) return null; // never put a urless asset in the shared library
              return {
                id: output.id ?? `${job.id}:${index}`,
                mediaAssetId: output.assetId,
                kind: output.type,
                source: "generated",
                url,
                width: output.width,
                height: output.height,
                durationSeconds: output.durationSeconds,
                bytes: output.bytes,
                panorama: isPanoramaOutput(output),
                prompt: job.prompt,
                createdAt: Date.now(),
                category: "general",
              };
            })
            .filter((asset): asset is CanvasAsset => asset !== null)
        );
      }
      if (["completed", "failed", "cancelled", "canceled", "expired"].includes(job.status)) {
        void queryClient.invalidateQueries({ queryKey: computeWalletBalanceQueryKey });
      }
    },
    [getNodes, getEdges, patchNodeData, addNode, removeNode, addAssets, queryClient]
  );

  /**
   * Catch-up reconciler: fetch the authoritative status of every card still in a
   * non-terminal state and apply it. Covers updates missed while the realtime
   * channel was down (a closed/backgrounded tab overnight) — the canvas persists
   * `generation` in the doc, so without this a missed completion spins forever.
   * Mirrors the studio feed's reconcile.
   */
  const reconcile = useCallback(async () => {
    if (reconciling.current || document.visibilityState === "hidden") return;
    reconciling.current = true;
    const scope = {
      projectId: generationProjectId,
      storyProjectId: generationStoryProjectId,
      documentId: generationDocumentId,
      sourceSurface,
    };
    const readJobs = (filter: Parameters<typeof listFizzAiJobs>[0]) =>
      queryClient.fetchQuery({
        queryKey: ["canvas-jobs", scope, filter],
        queryFn: () => listFizzAiJobs({ ...scope, ...filter }),
        staleTime: 0,
        retry: false,
      });
    try {
      const active = getNodes().filter(
        (node) =>
          isGenerationNodeType(node.type) && needsJobRecovery((node.data as GenNodeData).generation)
      );
      const ids = [
        ...new Set(
          active.flatMap((node) => {
            const id = (node.data as GenNodeData).generation?.jobId;
            return id ? [id] : [];
          })
        ),
      ];
      // One bounded batch per 100 jobs, including completed jobs. A healthy
      // socket is only a latency optimisation, never the source of truth.
      for (let offset = 0; offset < ids.length; offset += 100) {
        const { jobs } = await readJobs({ ids: ids.slice(offset, offset + 100), limit: 100 });
        jobs.forEach(applyJobUpdate);
      }
      for (const node of active) {
        const generation = (node.data as GenNodeData).generation!;
        if (generation.jobId || submittingNodes.current.has(node.id)) continue;
        const { jobs } = await readJobs({
          documentBlockId: node.id,
          idempotencyKey: generation.submissionKey,
          limit: 1,
        });
        const job = jobs.find((candidate) => matchesCanvasJob(node, candidate));
        if (job) applyJobUpdate(job);
        else if (generation.status === "submitting" || generation.status === "uncertain") {
          // No acknowledged job: keep the exact receipt for a safe retry.
          // Old cards without a receipt can be retried after this lookup.
          patchNodeData(node.id, (current) => {
            const state = (current.data as GenNodeData).generation;
            if (!state || state.jobId || state.submissionKey !== generation.submissionKey)
              return {};
            return {
              generation: {
                ...state,
                status: state.submission ? "uncertain" : "failed",
                error: t("submissionUnconfirmed"),
              },
            };
          });
        }
      }
    } catch (error) {
      // Cached jobs stay visible. A disconnected request must not strand an
      // unacknowledged card behind a spinner without a retry action.
      for (const node of getNodes()) {
        const state = (node.data as GenNodeData).generation;
        if (
          state?.status === "submitting" &&
          !state.jobId &&
          !submittingNodes.current.has(node.id)
        ) {
          patch(node.id, {
            ...state,
            status: "uncertain",
            error: normalizeFizzAiError(error, t("submissionUnconfirmed")),
          });
        }
      }
    } finally {
      reconciling.current = false;
    }
  }, [
    getNodes,
    applyJobUpdate,
    generationProjectId,
    generationStoryProjectId,
    generationDocumentId,
    sourceSurface,
    queryClient,
    patchNodeData,
    patch,
    t,
  ]);

  // Realtime: route job updates back to their card by jobId; reconcile on
  // (re)connect so a reconnect after sleep/disconnect back-fills missed updates.
  // Scoped to the project's PAYER workspace, not the global active selection:
  // it is always a workspace I am a member of (so negotiate never 403s), it
  // carries this project's job + wallet channels when I belong to the project's
  // workspace, and it matches the credits badge's socket so they share one.
  const workspaceId = useProjectPayerWorkspace()?.id ?? null;
  useEffect(() => {
    const client = getAssetsRealtimeKernel({
      workspaceId: workspaceId ?? undefined,
    }).subscribe({
      onConnected: () => {
        setRealtimeConnected(true);
        void reconcile();
      },
      onDisconnected: () => setRealtimeConnected(false),
      onEvent: (event) => {
        if (event.kind === "media_asset_moderation_changed") {
          if (event.action !== "blocked") return;
          const currentNodes = getNodes();
          const placedNodeIds = new Set<string>();
          const blockedOutputSourceNodeIds = new Set<string>();
          for (const node of currentNodes) {
            if (
              (node.type === "image" ||
                node.type === "panorama" ||
                node.type === "videoAsset" ||
                node.type === "audioAsset") &&
              (node.data as { mediaAssetId?: string }).mediaAssetId === event.assetId
            ) {
              placedNodeIds.add(node.id);
              continue;
            }
            if (
              isGenerationNodeType(node.type) &&
              (node.data as GenNodeData).generation?.outputs?.some(
                (output) => output.assetId === event.assetId
              )
            ) {
              blockedOutputSourceNodeIds.add(node.id);
            }
          }
          const blockedReferenceSources = new Set([
            ...placedNodeIds,
            ...blockedOutputSourceNodeIds,
          ]);
          removeAssetsByMediaAssetId(event.assetId);
          for (const node of currentNodes) {
            if (placedNodeIds.has(node.id)) {
              removeNode(node.id);
              continue;
            }
            // A shot holds nothing but pictures: drop any slot fed by media
            // that was just taken down, so the board never shows blocked media.
            if (node.type === SHOT_NODE_TYPE) {
              const shotData = node.data as GenNodeData;
              const references = removeReferencesFromSources(
                shotData.references,
                blockedReferenceSources
              );
              if (references !== shotData.references) patchNodeData(node.id, { references });
              continue;
            }
            if (!isGenerationNodeType(node.type)) continue;
            const data = node.data as GenNodeData;
            const generation = removeMediaAssetFromGeneration(
              data.generation,
              event.assetId,
              t("assetUnavailable")
            );
            const references = removeReferencesFromSources(
              data.references,
              blockedReferenceSources
            );
            if (generation !== data.generation || references !== data.references) {
              patchNodeData(node.id, { generation, references });
            }
          }
          if (blockedReferenceSources.size > 0) {
            for (const edge of getEdges()) {
              if (
                placedNodeIds.has(edge.source) ||
                placedNodeIds.has(edge.target) ||
                blockedReferenceSources.has(edge.source)
              ) {
                removeEdge(edge.id);
              }
            }
          }
          return;
        }
        if (event.kind !== "ai_job_update") return;
        applyJobUpdate(event.job as unknown as FizzAiJobView);
      },
    });
    return () => client.close();
    // Deps are all referentially stable (they change only on doc/workspace
    // switch), so this subscription arms once per canvas — NOT per render.
    // Re-arming per render tears the shared socket down (last subscriber
    // closes it) and re-fires onConnected→reconcile each time: that was the
    // /aurora/ai/jobs request storm.
  }, [
    applyJobUpdate,
    reconcile,
    getNodes,
    getEdges,
    patchNodeData,
    removeAssetsByMediaAssetId,
    removeEdge,
    removeNode,
    t,
    workspaceId,
  ]);

  const activeJobIds = useMemo(
    () =>
      nodes
        .filter(
          (node) =>
            isGenerationNodeType(node.type) &&
            needsJobRecovery((node.data as GenNodeData).generation)
        )
        .map((node) => {
          const state = (node.data as GenNodeData).generation!;
          return `${node.id}:${state.jobId ?? state.submissionKey ?? "unacknowledged"}`;
        })
        .sort()
        .join(","),
    [nodes]
  );

  useEffect(() => {
    if (!activeJobIds) return;
    void reconcile();
    const timer = window.setInterval(
      () => void reconcile(),
      realtimeConnected ? CONNECTED_RECONCILE_INTERVAL_MS : DISCONNECTED_FALLBACK_INTERVAL_MS
    );
    return () => window.clearInterval(timer);
  }, [activeJobIds, realtimeConnected, reconcile]);

  // Tab refocus → reconcile (catches anything missed while the tab was hidden).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reconcile();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reconcile]);

  const sendSubmission = useCallback(
    async (nodeId: string, input: FizzAiSubmitJobInput, previous?: GenerationState) => {
      const receipt: GenerationState = {
        status: "submitting",
        submissionKey: input.idempotencyKey,
        submission: input,
        submissionOwnerId: userId,
      };
      patch(nodeId, receipt);
      try {
        const response = await submitFizzAiJob(input);
        patchNodeData(nodeId, (node) => {
          const current = (node.data as GenNodeData).generation;
          if (!acceptsSubmissionResponse(current, input.idempotencyKey) || current?.jobId)
            return {};
          const status = generationStatusFromRaw(response.status);
          return {
            generation: {
              submissionKey: input.idempotencyKey,
              jobId: response.request_id,
              // The receipt has no outputs/error detail. Keep reconciling a
              // completed replay until the full job has actually been loaded.
              status: isTerminalGenerationStatus(status) ? "generating" : status,
              progress: response.progress ?? undefined,
              queuePosition: response.queue_position ?? undefined,
              etaSeconds: response.estimated_total_seconds ?? undefined,
            },
          };
        });
        // A replay may already be completed; hydrate its outputs as well.
        const job = await getFizzAiJob(response.request_id).catch(() => null);
        if (job) applyJobUpdate(job);
        void queryClient.invalidateQueries({ queryKey: computeWalletBalanceQueryKey });
      } catch (error) {
        const current = getNode(nodeId)?.data.generation as GenerationState | undefined;
        if (!acceptsSubmissionResponse(current, input.idempotencyKey) || current?.jobId) return;
        const insufficient = insufficientComputePointDetails(error);
        if (insufficient) {
          patchNodeData(nodeId, { generation: previous });
          setRechargePrompt({
            available: insufficient.available ?? wallet?.available ?? null,
            modelName: catalog?.models.find((model) => model.id === input.modelId)?.name,
            required: insufficient.required ?? null,
          });
          return;
        }
        const message = normalizeFizzAiError(error, t("submissionUnconfirmed"));
        patch(
          nodeId,
          isUncertainSubmission(error)
            ? { ...receipt, status: "uncertain", error: message }
            : { status: "failed", error: message }
        );
        toast.error(message);
      }
    },
    [patch, patchNodeData, getNode, applyJobUpdate, queryClient, wallet, catalog, t, userId]
  );

  const submit = useCallback(
    async (nodeId: string) => {
      if (submittingNodes.current.has(nodeId)) return;
      submittingNodes.current.add(nodeId);
      try {
        if (!canGenerate || !projectSkillsReady) {
          if (effectiveDisabledReason) toast.error(effectiveDisabledReason);
          return;
        }
        // Read source-of-truth from the doc (synchronous) so a card created/edited
        // earlier in the same turn is found even before React Flow's store catches up.
        const node = getNode(nodeId);
        if (!node) return;
        const data = node.data as GenNodeData;
        if (data.generation?.submission && data.generation.status === "uncertain") {
          if (data.generation.submissionOwnerId !== userId) {
            void reconcile();
            toast.error(t("submissionOtherUser"));
            return;
          }
          await sendSubmission(nodeId, data.generation.submission);
          return;
        }
        if (needsJobRecovery(data.generation)) return;
        const model = catalog?.models.find((m) => m.id === data.modelId);
        if (!model) {
          toast.error(t("chooseModelFirst"));
          return;
        }
        // Only block when the model's schema REQUIRES a prompt. Pure transforms
        // (upscale) declare none; ops with an optional prompt (expand) must still
        // run prompt-less.
        if (promptRequired(model) && !data.prompt?.trim()) {
          toast.error(t("writePromptFirst"));
          return;
        }
        const estimatedCost = generationCost(model, data);
        if (
          estimatedCost != null &&
          wallet &&
          wallet.available < BigInt(Math.ceil(estimatedCost))
        ) {
          setRechargePrompt({
            available: wallet.available,
            modelName: model.name,
            required: estimatedCost,
          });
          return;
        }

        // Only the ACTIVE mode's reference fields are submitted — leftover slots
        // from a prior mode must not ride along or Seedance rejects the combo.
        const mode = data.mode ?? defaultMode(model);

        // Backfill missing video/audio durations (wired refs without metadata).
        // Persist onto the card so re-submit and server payload stay consistent.
        let references = data.references;
        const durationPatches: Array<{
          field: string;
          id: string;
          durationSeconds: number;
        }> = [];
        for (const field of referenceFieldsForMode(model, mode)) {
          if (field.kind !== "video" && field.kind !== "audio") continue;
          for (const row of references?.[field.field] ?? []) {
            if (typeof row.durationSeconds === "number" && Number.isFinite(row.durationSeconds)) {
              continue;
            }
            if (!row.url || row.uploading) continue;
            const probed = await probeMediaDurationSeconds(row.url, field.kind);
            if (probed != null) {
              durationPatches.push({
                field: field.field,
                id: row.id,
                durationSeconds: probed,
              });
            }
          }
        }
        if (durationPatches.length > 0) {
          // Merge by ref id only — never replace the whole references map with a
          // snapshot taken before probe await (user/collaborator may have edited).
          patchNodeData(nodeId, (node) => {
            const live = (node.data as GenNodeData).references ?? {};
            const next: NonNullable<GenNodeData["references"]> = { ...live };
            for (const patch of durationPatches) {
              const list = next[patch.field];
              if (!list?.length) continue;
              next[patch.field] = list.map((row) =>
                row.id === patch.id ? { ...row, durationSeconds: patch.durationSeconds } : row
              );
            }
            return { references: next };
          });
          const latest = getNode(nodeId);
          references =
            latest && (latest.data as GenNodeData).references
              ? (latest.data as GenNodeData).references
              : references;
          // Also fold patches into the local submit snapshot when live read fails.
          if (references) {
            const merged: NonNullable<GenNodeData["references"]> = { ...references };
            for (const patch of durationPatches) {
              merged[patch.field] = (merged[patch.field] ?? []).map((row) =>
                row.id === patch.id ? { ...row, durationSeconds: patch.durationSeconds } : row
              );
            }
            references = merged;
          }
        }

        const referenceInput = buildReferenceInputForMode(model, mode, references);
        const referenceBindings = buildPromptReferenceBindingsForMode(model, mode, references);
        const skillScope = generationSkillScope(model.type);
        const compatibleSkills = compatibleProjectSkillInstallations(
          projectSkills.data,
          skillScope
        );
        const skillSelection = sanitizeProjectSkillSelection(data.skillSelection, compatibleSkills);
        const labelForSkill = (installation: ProjectSkillInstallation) =>
          installation.translationKey
            ? ts(`items.${installation.translationKey}.name`)
            : (installation.name ?? installation.slug ?? ts("title"));
        const effectiveSkills = resolveEffectiveProjectSkills({
          projectSkills: projectSkills.data,
          scope: skillScope,
          sourceSurface,
          selection: skillSelection,
          labelFor: labelForSkill,
          promptLength: (data.prompt ?? "").length,
        });
        const promptWithSkills = composePromptWithProjectSkills(data.prompt ?? "", effectiveSkills);
        const requestSkillSelection: ProjectSkillSelection = {
          ...(skillSelection?.includeInstallationIds?.length
            ? { includeInstallationIds: skillSelection.includeInstallationIds }
            : {}),
          ...(skillSelection?.excludeInstallationIds?.length
            ? { excludeInstallationIds: skillSelection.excludeInstallationIds }
            : {}),
        };

        const input = compactFizzAiInput(
          filterFizzAiInput(model, {
            ...(data.settings ?? {}),
            ...referenceInput,
            prompt: data.prompt,
          })
        );

        // Catalog-driven preflight (same kernel as server). No model-specific ifs.
        const media = mediaSnapshotsForMode(model, mode, references);
        const preflight = validateModelGenerationInput(model, input, media);
        if (generationInputHasBlockingIssues(preflight)) {
          // Primary surface is ValidationAlertDialog on the card (not toast).
          setPreflightByNode((prev) => ({ ...prev, [nodeId]: preflight }));
          return;
        }
        setPreflightByNode((prev) => {
          if (!(nodeId in prev)) return prev;
          const next = { ...prev };
          delete next[nodeId];
          return next;
        });

        await sendSubmission(
          nodeId,
          {
            // The job binds to its server-backed project (canvas id === project
            // id) and to its card via the block id. The server resolves the
            // workspace from the project, which is required for billing the
            // project's workspace wallet.
            context: {
              ...(generationProjectId ? { projectId: generationProjectId } : {}),
              ...(generationStoryProjectId ? { storyProjectId: generationStoryProjectId } : {}),
              ...(generationDocumentId ? { documentId: generationDocumentId } : {}),
              documentBlockId: nodeId,
              sourceSurface,
            },
            idempotencyKey: generationIdempotencyKey("canvas"),
            input,
            promptDocument: buildPromptDocument(promptWithSkills, [
              ...referenceBindings,
              ...effectiveSkills.map((skill) => ({
                refId: skill.installation.id,
                label: skill.mention.label,
                nodeType: "skill_ref" as const,
              })),
            ]),
            referenceBindings: referenceBindings.length ? referenceBindings : undefined,
            skillSelection:
              Object.keys(requestSkillSelection).length > 0 ? requestSkillSelection : undefined,
            modelId: model.id,
            schemaVersion: model.schemaVersion,
          },
          data.generation
        );
      } catch (error) {
        toast.error(
          error instanceof ReferenceInputError
            ? t(error.messageKey)
            : normalizeFizzAiError(error, t("generationFailed"))
        );
      } finally {
        submittingNodes.current.delete(nodeId);
      }
    },
    [
      getNode,
      catalog,
      wallet,
      generationProjectId,
      generationStoryProjectId,
      generationDocumentId,
      sourceSurface,
      canGenerate,
      sendSubmission,
      userId,
      reconcile,
      projectSkills.data,
      projectSkillsReady,
      effectiveDisabledReason,
      patchNodeData,
      t,
      ts,
    ]
  );

  const cancel = useCallback(
    async (nodeId: string) => {
      const node = getNode(nodeId);
      if (!node) return;
      const generation = (node.data as GenNodeData).generation;
      if (!generation?.jobId) return;
      try {
        applyJobUpdate(await cancelFizzAiJob(generation.jobId));
      } catch (error) {
        toast.error(normalizeFizzAiError(error, t("generationFailed")));
      }
    },
    [getNode, applyJobUpdate, t]
  );

  const preflightIssues = useCallback(
    (nodeId: string) => preflightByNode[nodeId] ?? [],
    [preflightByNode]
  );
  const clearPreflightIssues = useCallback((nodeId: string) => {
    setPreflightByNode((prev) => {
      if (!(nodeId in prev)) return prev;
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  }, []);

  const value = useMemo<GenerationContextValue>(
    () => ({
      submit: (id) => void submit(id),
      cancel: (id) => void cancel(id),
      canSubmit: canGenerate && projectSkillsReady,
      disabledReason: effectiveDisabledReason,
      preflightIssues,
      clearPreflightIssues,
    }),
    [
      submit,
      cancel,
      canGenerate,
      projectSkillsReady,
      effectiveDisabledReason,
      preflightIssues,
      clearPreflightIssues,
    ]
  );

  return (
    <GenerationContext.Provider value={value}>
      {children}
      <ComputeRechargeDialog
        open={rechargePrompt !== null}
        available={rechargePrompt?.available}
        required={rechargePrompt?.required}
        modelName={rechargePrompt?.modelName}
        onOpenChange={(next) => {
          if (!next) setRechargePrompt(null);
        }}
      />
    </GenerationContext.Provider>
  );
}
