"use client";

import { useCallback, useState } from "react";
import { EDITABLE_COLUMN_KEYS, cellDomId } from "./storyboard-columns";

export type NavDirection = "next" | "prev" | "down" | "up";

export interface FocusedCell {
  rowIndex: number;
  columnKey: string;
}

/**
 * Focus + keyboard navigation for the storyboard grid (Excel-style).
 *
 * Each editable cell has a stable DOM id (`cell-{rowId}-{columnKey}`). This
 * hook computes the NEXT cell based on direction, handles row/column wrapping,
 * and focuses the target element. When the target row is outside the virtual
 * window, it calls `scrollToIndex` first — the row mounts on the next tick,
 * then the pending focus resolves via `requestAnimationFrame`.
 *
 * Usage at the table level:
 *   const { pendingFocus, moveFocus, resolvePendingFocus } = useGridNavigation({ scrollToIndex });
 *   // Pass `moveFocus` down to cells as `onNavigate`.
 *   // Call `resolvePendingFocus` after virtual items render.
 */
export function useGridNavigation({
  rowCount,
  scrollToIndex,
}: {
  rowCount: number;
  scrollToIndex: (index: number, opts?: { align?: string }) => void;
}) {
  const [pendingFocus, setPendingFocus] = useState<FocusedCell | null>(null);

  const editableKeys = EDITABLE_COLUMN_KEYS;
  const colCount = editableKeys.length;

  const focusElement = useCallback((rowId: string, columnKey: string) => {
    const el = document.getElementById(cellDomId(rowId, columnKey));
    if (el instanceof HTMLElement) {
      el.focus();
      return true;
    }
    return false;
  }, []);

  const moveFocus = useCallback(
    (
      direction: NavDirection,
      currentRowIndex: number,
      currentColumnKey: string,
      rowIds: readonly string[],
    ) => {
      const currentColIdx = editableKeys.indexOf(currentColumnKey);
      if (currentColIdx === -1) return; // Not an editable column — ignore.

      let nextRow = currentRowIndex;
      let nextCol = currentColIdx;

      switch (direction) {
        case "next":
          nextCol += 1;
          if (nextCol >= colCount) {
            nextCol = 0;
            nextRow += 1;
          }
          break;
        case "prev":
          nextCol -= 1;
          if (nextCol < 0) {
            nextCol = colCount - 1;
            nextRow -= 1;
          }
          break;
        case "down":
          nextRow += 1;
          break;
        case "up":
          nextRow -= 1;
          break;
      }

      // Boundary: stop at edges.
      if (nextRow < 0 || nextRow >= rowCount) return;

      const nextColKey = editableKeys[nextCol];
      const nextRowId = rowIds[nextRow];
      if (!nextRowId) return;

      // Try to focus immediately.
      if (focusElement(nextRowId, nextColKey)) return;

      // Row not mounted (outside virtual window) — scroll to it, then focus
      // on the next tick after it mounts.
      scrollToIndex(nextRow, { align: "center" });
      setPendingFocus({ rowIndex: nextRow, columnKey: nextColKey });
    },
    [rowCount, colCount, editableKeys, focusElement, scrollToIndex],
  );

  /** Called after virtual items render — resolves a pending focus request. */
  const resolvePendingFocus = useCallback(
    (rowIds: readonly string[]) => {
      if (!pendingFocus) return;
      const rowId = rowIds[pendingFocus.rowIndex];
      if (rowId && focusElement(rowId, pendingFocus.columnKey)) {
        setPendingFocus(null);
      }
    },
    [pendingFocus, focusElement],
  );

  return { pendingFocus, moveFocus, resolvePendingFocus };
}
