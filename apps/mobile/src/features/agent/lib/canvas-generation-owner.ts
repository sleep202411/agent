import type { CanvasEditScope } from "./story-canvas-draft";

type GenerationOwner = {
  workspaceId?: string | null;
  projectId?: string | null;
  storyProjectId?: string | null;
};

export function canvasGenerationOwner(scope: CanvasEditScope) {
  return "kind" in scope ? { projectId: scope.projectId } : { storyProjectId: scope.projectId };
}

/** Platform identity includes its workspace; neither owner may cross into the other. */
export function matchesCanvasGenerationOwner(scope: CanvasEditScope, value: GenerationOwner) {
  return "kind" in scope
    ? value.workspaceId === scope.workspaceId &&
        value.projectId === scope.projectId &&
        !value.storyProjectId
    : value.storyProjectId === scope.projectId && !value.projectId;
}
