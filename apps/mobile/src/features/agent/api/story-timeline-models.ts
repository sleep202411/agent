import { z } from "zod";
import type { AiObjectSchema } from "@repo/shared";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import {
  loadGenerationCatalog,
  planRank,
  type GenerationModel,
} from "@/features/ai-lab/catalog-api";
import { timelineGenerationInput } from "./story-timeline-generation";
import type { TimelineScope } from "./story-timeline-api";
const operations = [
  "image_to_panorama",
  "upscale",
  "remove_background",
  "relight",
  "multi_angle",
  "outpainting",
];
export function timelineModelOptions(model: GenerationModel): AiObjectSchema {
  const properties = Object.fromEntries(
    Object.entries(model.input_schema.properties).filter(
      ([key, field]) =>
        field.type !== "object" &&
        (field.type !== "array" || !["object", "array"].includes(field.items.type)) &&
        timelineGenerationInput.safeParse({ expectedVersion: 0, options: { [key]: true } }).success
    )
  );
  return {
    ...model.input_schema,
    properties,
    required: model.input_schema.required?.filter((key) => key in properties),
  };
}
export async function loadTimelineModels(
  scope: TimelineScope,
  kind: "image" | "video",
  signal: AbortSignal,
  requirements: { imageReference?: boolean } = {}
) {
  const current = () => {
    signal.throwIfAborted();
    if (getAuthGeneration() !== scope.generation)
      throw Error("Timeline generation session expired.");
  };
  current();
  z.string().uuid().parse(scope.projectId);
  z.string().uuid().parse(scope.chapterId);
  const workbench = z
    .object({
      project: z.object({
        id: z.string().uuid(),
        workspaceId: z.string().uuid(),
        capabilities: z.array(z.string()),
      }),
      chapter: z.object({ id: z.string().uuid() }),
    })
    .parse(
      await api.get(`/story-projects/${scope.projectId}/workbench`, {
        service: "aurora",
        params: { chapterId: scope.chapterId },
        signal,
        retry: false,
      })
    );
  current();
  if (
    workbench.project.id !== scope.projectId ||
    workbench.chapter.id !== scope.chapterId ||
    !workbench.project.capabilities.includes("story.generate")
  )
    throw Error("Generation is not available for this chapter.");
  const [{ catalog, rank }, preferences] = await Promise.all([
    loadGenerationCatalog(scope.generation, signal, workbench.project.workspaceId),
    api.get(`/agent-os/projects/${scope.projectId}/model-preferences`, {
      service: "aurora",
      signal,
      retry: false,
    }),
  ]);
  current();
  const prefs = z
    .object({
      projectId: z.string().uuid(),
      projectKind: z.literal("story"),
      imageModelId: z.string().nullable(),
      videoModelId: z.string().nullable(),
    })
    .parse(preferences);
  if (prefs.projectId !== scope.projectId) throw Error("Model preferences project mismatch.");
  const models = catalog.models.filter((model) => {
    const modes = z.array(z.string()).optional().parse(model.generationModes) ?? [];
    return (
      model.type === kind &&
      model.enabled &&
      (!requirements.imageReference || Boolean(model.input_schema.properties.referenceImages)) &&
      model.access?.allowed !== false &&
      planRank(model.access?.requiredPlan ?? model.entitlement?.requiredPlan) <= rank &&
      !/hunyuan|panorama/i.test(model.id) &&
      !model.input_schema.properties.dynamicMasks &&
      !(modes.length && modes.every((mode) => operations.includes(mode)))
    );
  });
  if (new Set(models.map((m) => m.id)).size !== models.length)
    throw Error("Duplicate generation models returned.");
  const preferred = kind === "image" ? prefs.imageModelId : prefs.videoModelId;
  return { models, selectedId: models.find((m) => m.id === preferred)?.id ?? models[0]?.id ?? "" };
}
