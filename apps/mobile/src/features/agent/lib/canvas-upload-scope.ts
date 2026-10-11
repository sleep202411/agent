import type { CanvasEditScope } from "./story-canvas-draft";
import type { CanvasUploadCheckpoint } from "../../../../canvas-editor/upload-schema";
export function canvasUploadOwner(scope: CanvasEditScope) {
  return "kind" in scope
    ? {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        sectionId: scope.sectionId,
        documentId: scope.documentId,
      }
    : { storyProjectId: scope.projectId };
}
export function canvasUploadScopeMatches(
  scope: CanvasEditScope,
  checkpoint: CanvasUploadCheckpoint
) {
  const owner = checkpoint.confirmation.scope;
  return "kind" in scope
    ? "workspaceId" in owner &&
        owner.workspaceId === scope.workspaceId &&
        owner.projectId === scope.projectId &&
        owner.sectionId === scope.sectionId &&
        owner.documentId === scope.documentId
    : "storyProjectId" in owner && owner.storyProjectId === scope.projectId;
}
