"use client";

import { CanvasView } from "@/app/[locale]/canvas/_components/canvas-view";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";

/**
 * Canvas mode editor — the immersive board, resolved for the active project.
 *
 * Lives inside the shell's body region (sidebar + drawer + main). The board
 * fills its container (the main flex-1 area) — not the whole viewport — so the
 * project sidebar stays visible to its left. Canvas-internal panels (asset
 * library, copilot) overlay the board, not the sidebar.
 */
export function CanvasEditor() {
  const { projectId, canEdit } = useProjectContext();
  return (
    <div className="h-full">
      <CanvasView projectId={projectId} canEdit={canEdit} />
    </div>
  );
}
