"use client";

import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";
import type { CanvasEdgeShape, CanvasNodeShape } from "@/lib/collab/canvas-doc";
import type { CanvasGraph } from "@/lib/collab/use-canvas-graph";
import { defaultMode, defaultSettingsForModel, isFizzAiModelUsable } from "./generation-api";
import { useAiCatalog, usableModelsByModality, type StudioModality } from "./use-ai-catalog";
import type { WorkflowPreset } from "./workflow-presets";

/**
 * Applies a {@link WorkflowPreset} to the canvas: fresh node ids, models
 * resolved from the LIVE catalog (preset hint → first usable → modality
 * default), one batched (single-undo) `addNodesAndEdges`, then frames the
 * result. Edges carry the fixed `output`→`input` handles; references are bound
 * when each source node generates (the completion back-fill), not faked here.
 */
export function useApplyPreset(graph: CanvasGraph): (preset: WorkflowPreset) => void {
  const { addNodesAndEdges, selectNodes } = graph;
  const { fitView } = useReactFlow();
  const { data: catalog } = useAiCatalog();

  return useCallback(
    (preset: WorkflowPreset) => {
      if (!catalog || catalog.models.length === 0) {
        toast.info("Models are still loading — try again in a moment");
        return;
      }

      const idMap = new Map<string, string>();
      for (const node of preset.nodes) idMap.set(node.localId, crypto.randomUUID());

      let unresolvedModality: StudioModality | null = null;
      const nodes: CanvasNodeShape[] = preset.nodes.map((node) => {
        const data: Record<string, unknown> = { references: {}, ...node.data };
        if (node.type === "prompt" || node.type === "video") {
          const modality: StudioModality =
            node.modality ?? (node.type === "video" ? "video" : "image");
          const model =
            (node.modelHint ?? [])
              .map((id) => catalog.models.find((m) => m.id === id))
              .find((m) => m && isFizzAiModelUsable(m)) ??
            usableModelsByModality(catalog, modality)[0];
          if (model) {
            const modes = model.generationModes as readonly string[] | undefined;
            const mode = node.mode && modes?.includes(node.mode) ? node.mode : defaultMode(model);
            data.modelId = model.id;
            data.modelName = model.name;
            data.mode = mode;
            data.settings = { ...defaultSettingsForModel(model), ...(node.settingsOverride ?? {}) };
          } else {
            unresolvedModality = modality;
          }
        }
        // Open the node already showing its real, pre-generated finished product
        // (bundled sample). It carries no jobId, so the live generation hook
        // leaves it alone; "Regenerate" overwrites it with a fresh job.
        if (node.sample) {
          data.generation = {
            status: "done",
            outputs: [
              {
                type: node.sample.type,
                url: node.sample.url,
                width: node.sample.width,
                height: node.sample.height,
              },
            ],
          };
        }
        return {
          id: idMap.get(node.localId)!,
          type: node.type,
          position: node.position,
          data,
        };
      });

      // Don't drop model-less generation nodes onto the canvas (they'd fail to
      // submit silently). If the catalog has no usable model for a modality the
      // preset needs, bail with a clear message.
      if (unresolvedModality) {
        toast.error(`No ${unresolvedModality} model is available right now`);
        return;
      }

      const edges: CanvasEdgeShape[] = preset.edges.map((edge) => ({
        id: crypto.randomUUID(),
        source: idMap.get(edge.fromLocalId)!,
        target: idMap.get(edge.toLocalId)!,
        sourceHandle: "output",
        targetHandle: "input",
      }));

      addNodesAndEdges(nodes, edges);
      selectNodes(nodes.map((n) => n.id));
      // Let the doc rebuild land before framing.
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
    },
    [addNodesAndEdges, selectNodes, fitView, catalog]
  );
}
