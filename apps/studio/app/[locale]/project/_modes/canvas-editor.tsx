"use client";

import { CanvasView } from "@/app/[locale]/canvas/_components/canvas-view";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";

/**
 * Canvas mode editor — the immersive board, resolved for the active project.
 *
 * The canvas is FULL-BLEED: `fixed inset-0` so it fills the whole viewport,
 * ignoring the shell's flex body (header height, left/right push). The shell's
 * header floats above it (z-30). The board itself never shrinks — only the
 * canvas's own chrome (toolbars, add-menu, controls) shifts to dodge the
 * header and any side panels, via its internal `drawerInset` / insets.
 */
export function CanvasEditor() {
  const { projectId, canEdit } = useProjectContext();
  return (
    <div className="fixed inset-0 z-0">
      <CanvasView projectId={projectId} canEdit={canEdit} />
    </div>
  );
}
