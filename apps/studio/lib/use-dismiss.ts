"use client";

import { useEffect, useRef } from "react";

/**
 * Dismiss an open popover on outside click or Escape. Elements that should NOT
 * dismiss it (the trigger + the popover itself) are marked with
 * `data-popover-zone`. Active only while `open`.
 */
export function useDismiss(open: boolean, onDismiss: () => void) {
  const cb = useRef(onDismiss);

  useEffect(() => {
    cb.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-popover-zone]")) cb.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) cb.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
}
