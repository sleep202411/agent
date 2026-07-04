"use client";

import {
  IconArrowUpRight,
  IconBoxMultiple,
  IconChevronDown,
  IconRocket,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { CanvasSaveState } from "./use-story-draft";

/** The floating workbench header: title cluster, sync status chip, and the
 *  selection / share / publish actions. */
export function CanvasHeader({
  canvasTitle,
  isCanvasLoading,
  canvasLoadError,
  canvasSaveState,
  canvasSaveError,
  hasConflict,
  hasProject,
  isSelectionMode,
  selectedNodeCount,
  onToggleSelectionMode,
  leftDockWidth,
}: {
  canvasTitle: string;
  isCanvasLoading: boolean;
  canvasLoadError: string | null;
  canvasSaveState: CanvasSaveState;
  canvasSaveError: string | null;
  hasConflict: boolean;
  hasProject: boolean;
  isSelectionMode: boolean;
  selectedNodeCount: number;
  onToggleSelectionMode: () => void;
  leftDockWidth: number;
}) {
  return (
    <header
      className="pointer-events-none absolute right-6 top-6 z-20 flex items-start justify-between gap-4 transition-[left] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{ left: leftDockWidth + 24 }}
    >
      <div className="pointer-events-auto flex h-14 items-center gap-4 rounded-full bg-[oklch(0.18_0_0)/0.86] px-5 shadow-[0_18px_60px_rgba(0,0,0,0.36)] backdrop-blur-xl">
        <span className="text-[18px] font-black tracking-tight text-white">Fizz</span>
        <div className="h-5 w-px bg-white/10" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/38">
            叙事工作台
          </p>
          <h1 className="max-w-[260px] truncate text-[15px] font-semibold text-white/88">
            {canvasTitle}
          </h1>
        </div>
        <IconChevronDown className="size-4 text-white/45" />
      </div>

      <div className="pointer-events-auto flex items-center gap-2">
        <span
          title={canvasLoadError ?? canvasSaveError ?? undefined}
          className={cn(
            "inline-flex h-11 items-center rounded-full px-4 text-xs font-semibold shadow-[0_14px_44px_rgba(0,0,0,0.24)] backdrop-blur-xl",
            canvasSaveState === "error" || canvasLoadError
              ? "bg-[#E52227]/18 text-[#ff8b8e]"
              : "bg-white/8 text-white/50"
          )}
        >
          {isCanvasLoading
            ? "Loading project"
            : canvasLoadError
              ? "Load failed"
              : hasConflict
                ? "Version conflict"
                : canvasSaveState === "saving"
                  ? "Saving"
                  : canvasSaveState === "saved"
                    ? "Saved"
                    : !hasProject
                      ? "Not saved yet"
                      : canvasSaveState === "error"
                        ? "Save failed"
                        : "Synced"}
        </span>
        <button
          type="button"
          data-testid="toggle-selection-mode"
          aria-pressed={isSelectionMode}
          onClick={onToggleSelectionMode}
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-[0_14px_44px_rgba(0,0,0,0.3)] transition",
            isSelectionMode
              ? "bg-white text-black hover:bg-white/88"
              : "bg-white/10 text-white/78 hover:bg-white/15 hover:text-white"
          )}
        >
          <IconBoxMultiple className="size-4" />
          {selectedNodeCount > 0 ? `已选 ${selectedNodeCount}` : "框选"}
        </button>
        <button
          type="button"
          className="inline-flex h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-white/78 shadow-[0_14px_44px_rgba(0,0,0,0.3)] transition hover:bg-white/15 hover:text-white"
        >
          <IconArrowUpRight className="size-4" />
          分享
        </button>
        <button
          type="button"
          className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black shadow-[0_14px_44px_rgba(0,0,0,0.35)] transition hover:bg-white/88"
        >
          <IconRocket className="size-4" />
          发布
        </button>
      </div>
    </header>
  );
}
