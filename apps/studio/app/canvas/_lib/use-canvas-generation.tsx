"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";
import { addProjectAssets } from "@/lib/canvas-store";
import { openAssetsRealtime } from "./assets-realtime";
import {
  compactFizzAiInput,
  filterFizzAiInput,
  generationIdempotencyKey,
  generationStateFromJob,
  generationStatusFromRaw,
  normalizeFizzAiError,
  submitFizzAiJob,
  type FizzAiCatalog,
  type GenerationState,
} from "./generation-api";

/** Minimal shape this orchestrator reads off a generation node's data. */
type GenNodeData = {
  prompt?: string;
  modelId?: string;
  mode?: string;
  settings?: Record<string, string | number | boolean>;
  references?: Record<string, { url: string }[]>;
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

type GenerationContextValue = { submit: (nodeId: string) => void };

const GenerationContext = createContext<GenerationContextValue | null>(null);

/** Cards call this to submit themselves; no-ops outside a provider. */
export function useGeneration(): GenerationContextValue {
  return useContext(GenerationContext) ?? { submit: () => {} };
}

/**
 * Owns the canvas's generation loop: one realtime subscription routes every
 * `ai_job_update` to the node whose `generation.jobId` matches, and `submit`
 * sends a card's prompt + schema settings to `/aurora/ai/jobs` bound to its
 * block. Lives at the canvas level (it writes back to nodes); cards only call
 * `submit(nodeId)` via context.
 */
export function CanvasGenerationProvider({
  projectId,
  catalog,
  children,
}: {
  projectId: string;
  catalog: FizzAiCatalog | undefined;
  children: React.ReactNode;
}) {
  const { getNode, getNodes, updateNodeData, setNodes, setEdges } = useReactFlow();

  const patch = useCallback(
    (nodeId: string, generation: GenerationState) => updateNodeData(nodeId, { generation }),
    [updateNodeData]
  );

  // Realtime: route job updates back to their card by jobId.
  useEffect(() => {
    const client = openAssetsRealtime({
      onEvent: (event) => {
        if (event.kind !== "ai_job_update") return;
        const job = event.job;
        const out = job.outputs?.[0];

        // Find the node this job belongs to (sync read) so we can decide whether
        // to convert it to a panorama node + drop its now-danging input wire.
        const match = getNodes().find(
          (n) =>
            (n.type === "prompt" || n.type === "video") &&
            (n.data as GenNodeData).generation?.jobId === job.id
        );
        const matchData = match?.data as GenNodeData | undefined;
        const isPanoCard =
          !!matchData &&
          (matchData.mode === "image_to_panorama" ||
            /hunyuan|panorama|world/i.test(matchData.modelId ?? ""));
        // A finished panorama card becomes a panorama node: a live inline 360
        // view (three.js), no composer — same as a dropped panorama asset.
        const convert =
          !!match &&
          generationStatusFromRaw(job.status) === "done" &&
          isPanoCard &&
          isPanoramaOutput(out) &&
          !!out?.url;

        if (match) {
          setNodes((nodes) =>
            nodes.map((node) => {
              if (node.id !== match.id) return node;
              if (convert) {
                return {
                  ...node,
                  type: "panorama",
                  data: { src: out!.url, label: matchData?.prompt },
                };
              }
              return {
                ...node,
                data: { ...node.data, generation: generationStateFromJob(job) },
              };
            })
          );
          if (convert) setEdges((edges) => edges.filter((edge) => edge.target !== match.id));
        }
        // A finished job's outputs join the project's persistent asset library
        // (deduped by id, so repeated pushes are harmless).
        if (generationStatusFromRaw(job.status) === "done" && job.outputs?.length) {
          void addProjectAssets(
            projectId,
            job.outputs.map((output, index) => ({
              id: output.id ?? `${job.id}:${index}`,
              kind: output.type,
              source: "generated" as const,
              url: output.url,
              width: output.width,
              height: output.height,
              panorama: isPanoramaOutput(output),
              prompt: job.prompt,
              createdAt: Date.now(),
            }))
          );
        }
      },
    });
    return () => client.close();
  }, [setNodes, projectId]);

  const submit = useCallback(
    async (nodeId: string) => {
      const node = getNode(nodeId);
      if (!node) return;
      const data = node.data as GenNodeData;
      const model = catalog?.models.find((m) => m.id === data.modelId);
      if (!model) {
        toast.error("Choose a model first");
        return;
      }
      if (!data.prompt?.trim()) {
        toast.error("Write a prompt first");
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

      patch(nodeId, { status: "queued" });
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
      } catch (error) {
        const message = normalizeFizzAiError(error, "Generation failed");
        patch(nodeId, { status: "failed", error: message });
        toast.error(message);
      }
    },
    [getNode, catalog, patch]
  );

  const value = useMemo<GenerationContextValue>(
    () => ({ submit: (id) => void submit(id) }),
    [submit]
  );

  return <GenerationContext.Provider value={value}>{children}</GenerationContext.Provider>;
}
