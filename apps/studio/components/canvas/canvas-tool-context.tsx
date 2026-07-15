"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { CanvasTool } from "./canvas-interaction-policy";

type CanvasToolContextValue = {
  activeTool: CanvasTool;
  setActiveTool: (tool: CanvasTool) => void;
};

const CanvasToolContext = createContext<CanvasToolContextValue | null>(null);

export function CanvasToolProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: CanvasToolContextValue;
}) {
  return <CanvasToolContext.Provider value={value}>{children}</CanvasToolContext.Provider>;
}

export function useCanvasTool(): CanvasToolContextValue {
  const context = useContext(CanvasToolContext);
  if (!context) {
    throw new Error("useCanvasTool must be used inside CanvasReactFlow");
  }
  return context;
}
