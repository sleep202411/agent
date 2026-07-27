"use client";

import { useEffect } from "react";

export interface CanvasHistoryController {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

export type CanvasHistoryShortcut = "undo" | "redo";

export function resolveCanvasHistoryShortcut({
  key,
  metaKey,
  ctrlKey,
  shiftKey,
}: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey">): CanvasHistoryShortcut | null {
  if (!metaKey && !ctrlKey) return null;
  const normalizedKey = key.toLowerCase();
  if (normalizedKey === "z") return shiftKey ? "redo" : "undo";
  if (normalizedKey === "y" && !shiftKey) return "redo";
  return null;
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], .nokey')
  );
}

export function useCanvasHistoryShortcuts({
  enabled,
  undo,
  redo,
}: Pick<CanvasHistoryController, "undo" | "redo"> & { enabled: boolean }): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveCanvasHistoryShortcut(event);
      if (!shortcut || isTextEditingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      if (shortcut === "undo") undo();
      else redo();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, redo, undo]);
}
