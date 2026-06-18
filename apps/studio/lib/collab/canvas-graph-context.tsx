"use client";

import { createContext, useContext } from "react";
import type { CanvasGraph } from "./use-canvas-graph";

/**
 * Makes the canvas graph mutators available to deep node components
 * (note/generation cards, the generation provider, the panorama helper) so they
 * write through the Y.Doc instead of React Flow's local store. Kept in its own
 * module so those components don't import canvas-view.tsx (cycle).
 */
const CanvasGraphContext = createContext<CanvasGraph | null>(null);

export const CanvasGraphProvider = CanvasGraphContext.Provider;

export function useCanvasGraphContext(): CanvasGraph {
  const graph = useContext(CanvasGraphContext);
  if (!graph) {
    throw new Error("useCanvasGraphContext must be used within a CanvasGraphProvider");
  }
  return graph;
}
