"use client";

import { IconArrowBackUp, IconArrowForwardUp } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { CanvasHistoryController } from "./canvas-history";

interface CanvasHistoryControlsProps extends CanvasHistoryController {
  undoLabel: string;
  redoLabel: string;
  className?: string;
}

export function CanvasHistoryControls({
  canUndo,
  canRedo,
  undo,
  redo,
  undoLabel,
  redoLabel,
  className,
}: CanvasHistoryControlsProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-full bg-popover/90 p-1 shadow-md backdrop-blur-xl",
        className
      )}
    >
      <button
        type="button"
        aria-label={undoLabel}
        aria-keyshortcuts="Control+Z Meta+Z"
        title={`${undoLabel} (⌘/Ctrl+Z)`}
        disabled={!canUndo}
        onClick={undo}
        className="flex size-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <IconArrowBackUp className="size-4" stroke={1.8} />
      </button>
      <button
        type="button"
        aria-label={redoLabel}
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
        title={`${redoLabel} (⌘/Ctrl+Shift+Z)`}
        disabled={!canRedo}
        onClick={redo}
        className="flex size-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <IconArrowForwardUp className="size-4" stroke={1.8} />
      </button>
    </div>
  );
}
