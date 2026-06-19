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
import { useReactFlow, useStore } from "@xyflow/react";
import { toast } from "sonner";
import type { CanvasAsset } from "@/lib/collab/canvas-doc";
import { useCanvasGraphContext } from "@/lib/collab/canvas-graph-context";
import { openAssetsRealtime } from "./assets-realtime";
import { outputKindForType, routeReferenceField } from "./reference-routing";
import { computeWalletBalanceQueryKey } from "@/app/_components/credits-badge";
import {
  cancelFizzAiJob,
  compactFizzAiInput,
  filterFizzAiInput,
  generationIdempotencyKey,
  generationStateFromJob,
  generationStatusFromRaw,
  getFizzAiJob,
  isTerminalGenerationStatus,
  promptRequired,
  normalizeFizzAiError,
  submitFizzAiJob,
  type FizzAiCatalog,
  type FizzAiJobView,
  type GenerationState,
} from "./generation-api";

/** Reconcile cadence while a card is running — slower when realtime is healthy. */
const CONNECTED_RECONCILE_INTERVAL_MS = 20_000;
const DISCONNECTED_FALLBACK_INTERVAL_MS = 5_000;

/** Minimal shape this orchestrator reads off a generation node's data. */
type GenNodeData = {
  prompt?: string;
  modelId?: string;
  mode?: string;
  settings?: Record<string, string | number | boolean>;
  references?: Record<string, { url: string; edgeId?: string; sourceNodeId?: string }[]>;
  generation?: GenerationState;
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
};

const GenerationContext = createContext<GenerationContextValue | null>(null);

/** Cards call this to submit / cancel themselves; no-ops outside a provider. */
export function useGeneration(): GenerationContextValue {
  return useContext(GenerationContext) ?? { submit: () => {}, cancel: () => {} };
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
  children,
}: {
  catalog: FizzAiCatalog | undefined;
  children: React.ReactNode;
}) {
  const t = useTranslations("canvasOps");
  const { getNodes } = useReactFlow();
  const graph = useCanvasGraphContext();
  const queryClient = useQueryClient();
  // Latest catalog without re-subscribing the realtime loop on catalog load
  // (the completion back-fill reads it to resolve downstream models).
  const catalogRef = useRef(catalog);
  useEffect(() => {
    catalogRef.current = catalog;
  }, [catalog]);

  const patch = useCallback(
    (nodeId: string, generation: GenerationState) => graph.patchNodeData(nodeId, { generation }),
    [graph]
  );

  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const reconcileSeq = useRef(0);

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
        (n) =>
          (n.type === "prompt" || n.type === "video") &&
          (n.data as GenNodeData).generation?.jobId === job.id
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
          const src = out!.accessUrl ?? out!.url;
          graph.removeNode(match.id);
          graph.addNode({
            id: match.id,
            type: "panorama",
            position: match.position,
            data: { src, mediaAssetId: out?.assetId, label: matchData?.prompt },
          });
        } else {
          graph.patchNodeData(match.id, {
            generation: generationStateFromJob(job),
          });
          // Back-fill downstream references. A card wired to this node BEFORE it
          // had an output (a preset, or wire-then-generate) binds nothing at
          // connect time. Now that an output exists, push its URL into every card
          // wired from this node — mirroring onConnect's binding so the wire is
          // functional, not just drawn.
          const doneUrl = incoming === "done" ? (out?.accessUrl ?? out?.url) : null;
          const kind = outputKindForType(out?.type);
          if (doneUrl && kind) {
            const allNodes = getNodes();
            for (const edge of graph.edges) {
              if (edge.source !== match.id || !edge.target) continue;
              const target = allNodes.find((n) => n.id === edge.target);
              if (!target || (target.type !== "prompt" && target.type !== "video")) continue;
              const edgeId = edge.id;
              // Resolve model + field INSIDE the patch from the node's CURRENT
              // data, so a card wired from multiple sources (or re-modelled
              // meanwhile) routes against fresh state, not a stale snapshot.
              graph.patchNodeData(edge.target, (node) => {
                const tdata = node.data as GenNodeData;
                const model = catalogRef.current?.models.find((m) => m.id === tdata.modelId);
                const routed = routeReferenceField(model, tdata.mode, tdata.references, kind);
                if (!routed) return {};
                const refs = tdata.references ?? {};
                const list = (refs[routed.field] ?? []).filter((r) => r.edgeId !== edgeId);
                const patch: Record<string, unknown> = {
                  references: {
                    ...refs,
                    [routed.field]: [
                      ...list,
                      { id: edgeId, edgeId, sourceNodeId: match.id, url: doneUrl, kind },
                    ],
                  },
                };
                if (routed.mode) patch.mode = routed.mode;
                return patch;
              });
            }
          }
        }
      }

      // A finished job's outputs join the project's persistent asset library
      // (deduped by id, so repeated pushes are harmless).
      if (incoming === "done" && job.outputs?.length) {
        graph.addAssets(
          job.outputs
            .map((output, index): CanvasAsset | null => {
              const url = output.accessUrl ?? output.url;
              if (!url) return null; // never put a urless asset in the shared library
              return {
                id: output.id ?? `${job.id}:${index}`,
                mediaAssetId: output.assetId,
                kind: output.type === "video" ? "video" : "image",
                source: "generated",
                url,
                width: output.width,
                height: output.height,
                panorama: isPanoramaOutput(output),
                prompt: job.prompt,
                createdAt: Date.now(),
              };
            })
            .filter((asset): asset is CanvasAsset => asset !== null)
        );
      }
      if (["completed", "failed", "cancelled", "canceled", "expired"].includes(job.status)) {
        void queryClient.invalidateQueries({ queryKey: computeWalletBalanceQueryKey });
      }
    },
    [getNodes, graph, queryClient]
  );

  /**
   * Catch-up reconciler: fetch the authoritative status of every card still in a
   * non-terminal state and apply it. Covers updates missed while the realtime
   * channel was down (a closed/backgrounded tab overnight) — the canvas persists
   * `generation` in the doc, so without this a missed completion spins forever.
   * Mirrors the studio feed's reconcile.
   */
  const reconcile = useCallback(async () => {
    const seq = ++reconcileSeq.current;
    const ids = [
      ...new Set(
        getNodes()
          .filter((n) => n.type === "prompt" || n.type === "video")
          .map((n) => (n.data as GenNodeData).generation)
          .filter((g): g is GenerationState => !!g?.jobId && !isTerminalGenerationStatus(g.status))
          .map((g) => g.jobId as string)
      ),
    ];
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map((id) => getFizzAiJob(id)));
    if (seq !== reconcileSeq.current) return; // a newer reconcile superseded this one
    for (const result of results) {
      if (result.status === "fulfilled") applyJobUpdate(result.value);
    }
  }, [getNodes, applyJobUpdate]);

  // Realtime: route job updates back to their card by jobId; reconcile on
  // (re)connect so a reconnect after sleep/disconnect back-fills missed updates.
  useEffect(() => {
    const client = openAssetsRealtime({
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
              (node.type === "image" || node.type === "panorama") &&
              (node.data as { mediaAssetId?: string }).mediaAssetId === event.assetId
            ) {
              placedNodeIds.add(node.id);
              continue;
            }
            if (
              (node.type === "prompt" || node.type === "video") &&
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
          graph.removeAssetsByMediaAssetId(event.assetId);
          for (const node of currentNodes) {
            if (placedNodeIds.has(node.id)) {
              graph.removeNode(node.id);
              continue;
            }
            if (node.type !== "prompt" && node.type !== "video") continue;
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
              graph.patchNodeData(node.id, { generation, references });
            }
          }
          if (blockedReferenceSources.size > 0) {
            for (const edge of graph.edges) {
              if (
                placedNodeIds.has(edge.source) ||
                placedNodeIds.has(edge.target) ||
                blockedReferenceSources.has(edge.source)
              ) {
                graph.removeEdge(edge.id);
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
  }, [applyJobUpdate, reconcile, graph, getNodes, t]);

  // Non-terminal job ids on the canvas, reactive to doc hydration + node edits.
  const activeJobIds = useStore((s) => {
    const ids: string[] = [];
    s.nodeLookup.forEach((n) => {
      if (n.type !== "prompt" && n.type !== "video") return;
      const generation = (n.data as GenNodeData).generation;
      if (generation?.jobId && !isTerminalGenerationStatus(generation.status)) {
        ids.push(generation.jobId);
      }
    });
    return ids.sort().join(",");
  });

  // Reconcile the instant an active card appears (e.g. after the doc hydrates
  // from IndexedDB on load), then poll as a backstop while any card runs.
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

  const submit = useCallback(
    async (nodeId: string) => {
      // Read source-of-truth from the doc (synchronous) so a card created/edited
      // earlier in the same turn is found even before React Flow's store catches up.
      const node = graph.getNode(nodeId);
      if (!node) return;
      const data = node.data as GenNodeData;
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

      // Map wired/uploaded references into their schema fields. Only real
      // (http) URLs go to the backend — blob object URLs can't be fetched yet
      // (they wait on SAS upload), so they're dropped here.
      const properties = model.input_schema?.properties ?? {};
      const referenceInput: Record<string, unknown> = {};
      for (const [field, list] of Object.entries(data.references ?? {})) {
        const urls = list.map((r) => r.url).filter((u) => /^https?:/i.test(u));
        if (urls.length === 0) continue;
        referenceInput[field] = properties[field]?.type === "array" ? urls : urls[0];
      }

      const input = compactFizzAiInput(
        filterFizzAiInput(model, {
          ...(data.settings ?? {}),
          ...referenceInput,
          prompt: data.prompt,
        })
      );

      patch(nodeId, {
        ...(data.generation ?? { status: "submitting" }),
        status: "submitting",
        error: undefined,
      });
      try {
        const response = await submitFizzAiJob({
          // Only the block binds the job to its card. The canvas project is
          // local (no backend entity), so projectId/documentId are omitted —
          // the server validates them for access and 404s an unresolvable id.
          // They return once projects are server-backed.
          context: {
            documentBlockId: nodeId,
            sourceSurface: "fizzstudio-canvas",
          },
          idempotencyKey: generationIdempotencyKey("canvas"),
          input,
          modelId: model.id,
          schemaVersion: model.schemaVersion,
        });
        patch(nodeId, {
          jobId: response.request_id,
          status: generationStatusFromRaw(response.status),
          progress: response.progress ?? undefined,
          queuePosition: response.queue_position ?? undefined,
          etaSeconds: response.estimated_total_seconds ?? undefined,
        });
        void queryClient.invalidateQueries({ queryKey: computeWalletBalanceQueryKey });
      } catch (error) {
        const message = normalizeFizzAiError(error, t("generationFailed"));
        patch(nodeId, { status: "failed", error: message });
        toast.error(message);
      }
    },
    [graph, catalog, patch, queryClient, t]
  );

  const cancel = useCallback(
    async (nodeId: string) => {
      const node = graph.getNode(nodeId);
      if (!node) return;
      const generation = (node.data as GenNodeData).generation;
      if (!generation?.jobId) return;
      // Optimistically drop out of the busy state; the realtime update confirms.
      patch(nodeId, { ...generation, status: "cancelled" });
      try {
        await cancelFizzAiJob(generation.jobId);
      } catch {
        // Best-effort — the job may already be terminal server-side.
      }
    },
    [graph, patch]
  );

  const value = useMemo<GenerationContextValue>(
    () => ({ submit: (id) => void submit(id), cancel: (id) => void cancel(id) }),
    [submit, cancel]
  );

  return <GenerationContext.Provider value={value}>{children}</GenerationContext.Provider>;
}
