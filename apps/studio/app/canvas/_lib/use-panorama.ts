"use client";

import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import { toast } from "sonner";
import { useAiCatalog } from "./use-ai-catalog";
import { referenceFieldsForMode, type FizzAiCatalog, type FizzAiModel } from "./generation-api";

/** The catalog's panorama (image→panorama) model, if one is configured. */
export function findPanoramaModel(catalog: FizzAiCatalog | undefined): FizzAiModel | undefined {
  return (
    catalog?.models.find((m) => m.generationModes?.includes("image_to_panorama")) ??
    catalog?.models.find((m) => /hunyuan|panorama|world/i.test(m.id))
  );
}

/**
 * "Generate a panorama from this image": spawn a panorama generation node wired
 * from the source, with the source bound as its reference, and flag it to
 * auto-submit on mount. Returns false (with a toast) if no panorama model exists.
 */
export function useCreatePanorama() {
  const { getNode, addNodes, addEdges } = useReactFlow();
  const { data: catalog } = useAiCatalog();

  return useCallback(
    (sourceNodeId: string, sourceUrl: string): boolean => {
      const model = findPanoramaModel(catalog);
      if (!model) {
        toast.error("No panorama model in the catalog yet");
        return false;
      }
      const mode =
        model.generationModes?.find((m) => m === "image_to_panorama") ??
        model.generationModes?.[0] ??
        "image_to_image";
      const field = referenceFieldsForMode(model, mode)[0]?.field ?? "referenceImages";
      const source = getNode(sourceNodeId);
      // Expand the SOURCE scene into a panorama: drive the model with the
      // source's own prompt when it has one, not a hand-written instruction.
      const sourcePrompt = (source?.data as { prompt?: string } | undefined)?.prompt?.trim();
      const nodeId = crypto.randomUUID();
      const edgeId = crypto.randomUUID();
      addNodes({
        id: nodeId,
        type: "prompt",
        position: source ? { x: source.position.x + 440, y: source.position.y } : { x: 0, y: 0 },
        data: {
          name: "Panorama",
          modelId: model.id,
          modelName: model.name,
          mode,
          prompt: sourcePrompt || "a 360 degree panorama scene",
          references: {
            [field]: [{ id: edgeId, edgeId, sourceNodeId, url: sourceUrl, kind: "image" }],
          },
          autoSubmit: true,
        },
      });
      addEdges({
        id: edgeId,
        type: "gradient",
        source: sourceNodeId,
        sourceHandle: "output",
        target: nodeId,
        targetHandle: "input",
      });
      return true;
    },
    [getNode, addNodes, addEdges, catalog]
  );
}
