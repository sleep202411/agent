"use client";

import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface ToolCompletionCardProps {
  label: string;
  /**
   * Visual state:
   *   - "pending" → spinner, muted border (tool execute in-flight)
   *   - "done" → green check, emerald accent (default)
   */
  state?: "pending" | "done";
}

/**
 * Chip rendered for UI-only ack tools (e.g. `mark_project_params_updated`)
 * and for execute-bearing tools whose final success we want to show as a
 * small confirmation rather than a big card (e.g. `generate_project_cover`).
 * Supports a "pending" state for the in-flight variant — same geometry so
 * the layout doesn't jump when the tool resolves.
 */
export function ToolCompletionCard({ label, state = "done" }: ToolCompletionCardProps) {
  const pending = state === "pending";
  return (
    <div
      className={cn(
        "mt-2 flex w-fit items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium",
        pending
          ? "border-border/60 bg-muted/30 text-muted-foreground"
          : "border-emerald-500/30 bg-emerald-500/10 text-foreground/90"
      )}
    >
      {pending ? (
        <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <IconCheck className="size-4 text-emerald-500" />
      )}
      <span>{label}</span>
    </div>
  );
}
