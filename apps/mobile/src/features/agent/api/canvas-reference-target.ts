import { loadCanvasReferenceCatalog } from "@/features/ai-lab/catalog-api";
import { canvasReferenceFields } from "@/features/ai-lab/canvas-modes";
import { generationSession } from "@/features/ai-lab/jobs-api";
import { canvasReferenceTargetSchema } from "../../../../canvas-editor/reference-schema";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasEditScope } from "../lib/story-canvas-draft";
import { z } from "zod";

export async function loadCanvasReferenceTarget(
  scope: CanvasEditScope,
  loaded: CanvasLoaded,
  nodeId: string,
  signal: AbortSignal
) {
  generationSession(scope.generation, signal);
  if (loaded.documentId !== scope.documentId) throw Error("Canvas document mismatch.");
  const node = z
    .object({
      id: z.literal(nodeId),
      type: z.enum(["prompt", "video", "audio"]),
      data: z.object({ modelId: z.string().min(1), mode: z.string().optional() }),
    })
    .parse(loaded.snapshot.nodes[nodeId]);
  const catalog = await loadCanvasReferenceCatalog(
    scope.generation,
    signal,
    "kind" in scope ? scope.workspaceId : undefined
  );
  generationSession(scope.generation, signal);
  const model = catalog.models.find((model) => model.id === node.data.modelId);
  if (!model) throw Error("Choose an available model before connecting a reference.");
  return projectCanvasReferenceTarget(model, node.data.mode);
}
export function projectCanvasReferenceTarget(
  model: Awaited<ReturnType<typeof loadCanvasReferenceCatalog>>["models"][number],
  currentMode?: string
) {
  const mode =
    currentMode ??
    model.generationModes?.find((mode) => mode.startsWith("text_to_")) ??
    model.generationModes?.[0];
  return canvasReferenceTargetSchema.parse({
    modelId: model.id,
    mode: currentMode,
    fields: canvasReferenceFields(model.input_schema, mode).flatMap((field) => {
      const property = model.input_schema.properties[field]!;
      const ui = property["x-ui"] as { mediaKind?: string; control?: string } | undefined;
      const kind =
        ui?.mediaKind === "image" || ui?.mediaKind === "video" || ui?.mediaKind === "audio"
          ? ui.mediaKind
          : ui?.control === "video_upload"
            ? "video"
            : ui?.control === "audio_upload"
              ? "audio"
              : "image";
      const maxItems = property.type === "array" ? Math.floor(property.maxItems ?? 0) : 1;
      return maxItems > 0 ? [{ field, kind, maxItems }] : [];
    }),
  });
}
