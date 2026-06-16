"use client";

import { IconPlus } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { WorkflowPreset } from "@/app/canvas/_lib/workflow-presets";

/**
 * Empty-canvas starter overlay (editors only): "Click to add a node" opens the
 * add menu; below it, a row of starter-workflow presets drops a pre-wired graph.
 * The wrapper is pointer-transparent so only the panel intercepts clicks — the
 * rest of the canvas stays pannable. Cards disable until the catalog loads
 * (presets resolve real models at apply-time). Dark/monochrome per DESIGN.md.
 */
export function CanvasEmptyState({
  presets,
  catalogReady,
  onAddNode,
  onApplyPreset,
}: {
  presets: WorkflowPreset[];
  catalogReady: boolean;
  onAddNode: () => void;
  onApplyPreset: (preset: WorkflowPreset) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="pointer-events-auto flex w-full max-w-5xl flex-col items-center px-6">
        <button
          type="button"
          onClick={onAddNode}
          className="group flex flex-col items-center gap-3"
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-secondary text-white shadow-md transition-colors group-hover:bg-accent">
            <IconPlus className="size-6" stroke={1.8} />
          </span>
          <span className="text-sm font-medium">Click to add a node</span>
        </button>

        <div className="my-7 flex w-full max-w-md items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">Or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-4">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={!catalogReady}
              title={catalogReady ? undefined : "Loading models…"}
              onClick={() => onApplyPreset(preset)}
              className={cn(
                "group flex flex-col overflow-hidden rounded-xl bg-card text-left transition-colors",
                catalogReady ? "hover:bg-accent" : "cursor-not-allowed opacity-50"
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- bundled placeholder graphic */}
              <img src={preset.thumbnail} alt="" className="aspect-video w-full object-cover" />
              <span className="flex flex-col gap-0.5 px-3 py-2">
                <span className="truncate text-sm font-medium">{preset.name}</span>
                <span className="truncate text-xs text-muted-foreground">{preset.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
