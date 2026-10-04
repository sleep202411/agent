import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { loadGenerationCatalog } from "@/features/ai-lab/catalog-api";
import type { CandidateScope } from "./story-candidates-api";
import { canvasGenerationDefaults } from "../lib/story-canvas-defaults";

/** Creating a blank generation card is a Story edit, not a billable job.
 * Its defaults come from the active workspace catalog, just like Web. */
export async function loadCanvasModels(scope: CandidateScope, signal: AbortSignal) {
  const current = () => {
    signal.throwIfAborted();
    z.string().uuid().parse(scope.projectId);
    if (getAuthGeneration() !== scope.generation) throw Error("Canvas session expired.");
  };
  current();
  const project = z
    .object({
      id: z.string().uuid(),
      workspaceId: z.string().uuid(),
      capabilities: z.array(z.string()),
    })
    .parse(
      await api.get(`/story-projects/${scope.projectId}`, {
        service: "aurora",
        signal,
        retry: false,
      })
    );
  current();
  if (project.id !== scope.projectId || !project.capabilities.includes("story.edit"))
    throw Error("Story editing permission is required for this canvas.");
  const { catalog } = await loadGenerationCatalog(scope.generation, signal, project.workspaceId);
  current();
  return {
    models: catalog.models,
    defaults: {
      image: canvasGenerationDefaults(catalog.models, "image"),
      video: canvasGenerationDefaults(catalog.models, "video"),
      audio: canvasGenerationDefaults(catalog.models, "audio"),
    },
  };
}
