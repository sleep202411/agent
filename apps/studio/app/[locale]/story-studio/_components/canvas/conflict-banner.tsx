"use client";

import { IconGitBranch, IconRefresh } from "@tabler/icons-react";
import type { DraftRevisionConflict } from "@/lib/story-projects-api";

/** Stale-write conflict: another session updated the draft. Autosave is
 *  paused; the user picks a side (server truth vs deliberate overwrite). */
export function DraftConflictBanner({
  conflict,
  busy,
  onLoadLatest,
  onOverwrite,
}: {
  conflict: DraftRevisionConflict;
  busy: boolean;
  onLoadLatest: () => void;
  onOverwrite: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="Draft version conflict"
      className="absolute top-[92px] left-1/2 z-30 flex w-[560px] max-w-[calc(100%-48px)] -translate-x-1/2 items-center gap-4 rounded-[24px] bg-[oklch(0.18_0_0)/0.94] px-5 py-4 shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur-2xl duration-200 animate-in fade-in-0 slide-in-from-top-2"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#E52227]/16">
        <IconGitBranch className="size-4.5 text-[#ff8b8e]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white/90">This draft changed somewhere else</p>
        <p className="mt-0.5 text-xs leading-5 text-white/48">
          Another session saved a newer version
          {conflict.updatedAt ? ` at ${new Date(conflict.updatedAt).toLocaleTimeString()}` : ""}.
          Load it, or overwrite it with your canvas.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onLoadLatest}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-full bg-white px-4 text-xs font-bold text-black transition hover:bg-white/88 disabled:opacity-60"
        >
          Load latest
        </button>
        <button
          type="button"
          onClick={onOverwrite}
          disabled={busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-4 text-xs font-bold text-white/80 transition hover:bg-white/15 hover:text-white disabled:opacity-60"
        >
          {busy ? <IconRefresh className="size-3.5 animate-spin" /> : null}
          Overwrite with mine
        </button>
      </div>
    </div>
  );
}
