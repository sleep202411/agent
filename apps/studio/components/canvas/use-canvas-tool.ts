"use client";

import { useEffect, useState, type RefObject } from "react";
import { CANVAS_KEYBOARD_OWNER_SELECTOR, type CanvasTool } from "./canvas-interaction-policy";

function isEditableTarget(target: EventTarget | null): boolean {
  return Boolean(target instanceof Element && target.closest(CANVAS_KEYBOARD_OWNER_SELECTOR));
}

/** Owns the persistent V/H editor tool shortcuts for one canvas surface. */
export function useCanvasTool(
  surfaceRef: RefObject<HTMLDivElement | null>,
  defaultTool: CanvasTool
) {
  const [activeTool, setActiveTool] = useState<CanvasTool>(defaultTool);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      const surface = surfaceRef.current;
      if (!surface || (!surface.matches(":hover") && !surface.contains(document.activeElement))) {
        return;
      }

      const nextTool =
        event.key.toLowerCase() === "v" ? "select" : event.key.toLowerCase() === "h" ? "pan" : null;
      if (!nextTool) return;

      event.preventDefault();
      setActiveTool(nextTool);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [surfaceRef]);

  return { activeTool, setActiveTool };
}
