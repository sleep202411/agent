import { z } from "zod";

const id = z.string().uuid();
export const canvasGenerationFields = {
  documentId: id.optional(),
  documentBlockId: z.string().trim().min(1).max(128).optional(),
  sourceSurface: z.literal("fizzstudio-canvas").optional(),
};
/** Partial card identity must never silently fall back to a project-level job. */
export function validCanvasGenerationScope(value: {
  documentId?: string;
  documentBlockId?: string;
  sourceSurface?: string;
  projectId?: string;
  storyProjectId?: string;
}) {
  const attached = value.documentId || value.documentBlockId || value.sourceSurface;
  return (
    !attached ||
    Boolean(
      value.documentId &&
      value.documentBlockId &&
      value.sourceSurface === "fizzstudio-canvas" &&
      (value.projectId || value.storyProjectId)
    )
  );
}
export const generationProjectScope = z
  .object({
    workspaceId: id,
    ...canvasGenerationFields,
    projectId: id.optional(),
    storyProjectId: id.optional(),
  })
  .refine((v) => !(v.projectId && v.storyProjectId), "Choose one project context.")
  .refine(validCanvasGenerationScope, "Canvas generation requires a project, document and card.");
export type GenerationScope = z.infer<typeof generationProjectScope>;
export type GenerationStorageScope = string | GenerationScope;
export function scopeFields(scope?: GenerationStorageScope): Partial<GenerationScope> {
  return typeof scope === "string"
    ? { workspaceId: id.parse(scope) }
    : scope
      ? generationProjectScope.parse(scope)
      : {};
}
export function generationStorageKey(scope: GenerationStorageScope | undefined, fallback: string) {
  if (!scope) return fallback;
  const fields = scopeFields(scope);
  return `workspace:${fields.workspaceId}${fields.projectId ? `:project:${fields.projectId}` : fields.storyProjectId ? `:story:${fields.storyProjectId}` : ""}${fields.documentId ? `:canvas:${JSON.stringify([fields.documentId, fields.documentBlockId])}` : ""}`;
}
export function matchesGenerationScope(
  value: {
    workspaceId?: string | null;
    projectId?: string | null;
    storyProjectId?: string | null;
    documentId?: string | null;
    documentBlockId?: string | null;
    sourceSurface?: string | null;
  },
  scope?: GenerationStorageScope
) {
  const fields = scopeFields(scope);
  return (
    (!fields.workspaceId || value.workspaceId === fields.workspaceId) &&
    (!fields.projectId || (value.projectId === fields.projectId && !value.storyProjectId)) &&
    (!fields.storyProjectId ||
      (value.storyProjectId === fields.storyProjectId && !value.projectId)) &&
    (!fields.documentId ||
      (value.documentId === fields.documentId &&
        value.documentBlockId === fields.documentBlockId &&
        value.sourceSurface === fields.sourceSurface))
  );
}
