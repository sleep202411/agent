"use client";

import { CanvasView } from "@/app/canvas/_components/canvas-view";
import { useProjectContext } from "@/app/project/_components/project-context";

/** Canvas mode editor — the immersive board, resolved for the active project. */
export function CanvasEditor() {
  const { projectId } = useProjectContext();
  return <CanvasView projectId={projectId} />;
}
