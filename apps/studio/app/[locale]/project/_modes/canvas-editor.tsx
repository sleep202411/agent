"use client";

import { CanvasStoryboard } from "./storyboard/canvas-storyboard";
import { CanvasView } from "@/app/[locale]/canvas/_components/canvas-view";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";

/**
 * Canvas mode editor — the immersive board, resolved for the active project.
 *
 * Lives under the project shell's persistent overlay chrome. The board fills
 * the complete project viewport; the shell-owned sidebar, panel, header and
 * FizzAgent remain mounted above it while modes change.
 */
export function CanvasEditor() {
  const { projectId, canEdit } = useProjectContext();
  return (
    <CanvasStoryboard>
      {(toolbarActions) => (
        <CanvasView projectId={projectId} canEdit={canEdit} toolbarActions={toolbarActions} />
      )}
    </CanvasStoryboard>
  );
}
