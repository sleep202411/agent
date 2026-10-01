import { z } from "zod";

const id = z.string().uuid();
export const generationProjectScope = z
  .object({
    workspaceId: id,
    projectId: id.optional(),
    storyProjectId: id.optional(),
  })
  .refine((v) => !(v.projectId && v.storyProjectId), "Choose one project context.");
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
  return `workspace:${fields.workspaceId}${fields.projectId ? `:project:${fields.projectId}` : fields.storyProjectId ? `:story:${fields.storyProjectId}` : ""}`;
}
export function matchesGenerationScope(
  value: { workspaceId?: string | null; projectId?: string | null; storyProjectId?: string | null },
  scope?: GenerationStorageScope
) {
  const fields = scopeFields(scope);
  return (
    (!fields.workspaceId || value.workspaceId === fields.workspaceId) &&
    (!fields.projectId || (value.projectId === fields.projectId && !value.storyProjectId)) &&
    (!fields.storyProjectId || (value.storyProjectId === fields.storyProjectId && !value.projectId))
  );
}
