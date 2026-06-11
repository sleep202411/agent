"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";
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
  settings?: Record<string, string | number | boolean>;
  generation?: GenerationState;
};

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
  catalog,
  children,
}: {
  catalog: FizzAiCatalog | undefined;
  children: React.ReactNode;
}) {
  const { getNode, updateNodeData, setNodes } = useReactFlow();

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
        setNodes((nodes) =>
          nodes.map((node) => {
            const data = node.data as GenNodeData;
            if (
              (node.type === "prompt" || node.type === "video") &&
              data.generation?.jobId === job.id
            ) {
              return { ...node, data: { ...data, generation: generationStateFromJob(job) } };
            }
            return node;
          })
        );
      },
    });
    return () => client.close();
  }, [setNodes]);

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

      const input = compactFizzAiInput(
        filterFizzAiInput(model, { ...(data.settings ?? {}), prompt: data.prompt })
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
