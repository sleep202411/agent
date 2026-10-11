import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import type { WorldPreviewScope } from "./world-preview-manifest";

export {
  hasWorldRenderer,
  assertWorldPreviewScope,
  type WorldPreviewScope,
} from "./world-preview-manifest";
const projectSchema = z.object({
  project: z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    status: z.literal("active"),
    capabilities: z.array(z.string()),
  }),
});

/** Resolve the real StoryProject workspace; never trust a selected workspace or route label. */
export async function loadWorldPreviewScope(
  projectId: string,
  generation: number,
  signal?: AbortSignal
): Promise<WorldPreviewScope> {
  z.string().uuid().parse(projectId);
  const current = () => {
    if (signal?.aborted || generation !== getAuthGeneration())
      throw new Error("World preview session changed. Reload before continuing.");
  };
  current();
  const { project } = projectSchema.parse(
    await api.get(`/story-projects/${projectId}/workbench`, { service: "aurora", signal })
  );
  current();
  if (project.id !== projectId) throw new Error("World preview project scope mismatch.");
  if (!project.capabilities.includes("story.generate"))
    throw new Error("World exploration requires this project's generation permission.");
  return Object.freeze({ projectId, workspaceId: project.workspaceId, generation });
}
