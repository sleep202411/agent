import { z } from "zod";
import {
  EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID,
  ExperienceCoreWorldModelRendererConfigSchema,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import type { WorldTravelScope } from "./world-travel-api";
export type WorldPreviewScope = Omit<WorldTravelScope, "worldId">;
export function hasWorldRenderer(manifest: ExperienceRuntimeManifest) {
  return manifest.graph.nodes.some(
    (node) =>
      node.kind === "scene" &&
      node.renderers.some(
        (renderer) => renderer.rendererId === EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID
      )
  );
}

export function assertWorldPreviewScope(
  manifest: ExperienceRuntimeManifest,
  scope: WorldPreviewScope
) {
  if (manifest.channel !== "preview")
    throw new Error("World streaming is available only in authenticated project previews.");
  z.string().uuid().parse(scope.workspaceId);
  z.string().uuid().parse(scope.projectId);
  for (const node of manifest.graph.nodes) {
    if (node.kind !== "scene") continue;
    for (const renderer of node.renderers) {
      if (renderer.rendererId !== EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ID) continue;
      const config = ExperienceCoreWorldModelRendererConfigSchema.parse(renderer.config);
      if (config.projectId !== scope.projectId)
        throw new Error("World preview project scope mismatch.");
      z.string().uuid().parse(config.worldId);
    }
  }
}
