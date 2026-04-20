"use client";

import { IconCheck, IconLoader2 } from "@tabler/icons-react";

interface ToolCompletionCardProps {
  label: string;
  /**
   * Visual state:
   *   - "pending" → spinner, muted border (tool execute in-flight)
   *   - "done" → green check, muted label (default)
   */
  state?: "pending" | "done";
}

/**
 * Chip rendered for UI-only ack tools (e.g. `mark_project_params_updated`)
 * and for execute-bearing tools whose final success we want to show as a
 * small confirmation rather than a big card (e.g. `generate_project_cover`).
 *
 * Styled to match `ToolIndicator` in message-bubble.tsx so every small
 * "tool happened" chip looks the same in the chat stream (same icon size,
 * same muted tone) regardless of which code path rendered it.
 */
export function ToolCompletionCard({ label, state = "done" }: ToolCompletionCardProps) {
  const pending = state === "pending";
  return (
    <div className="flex items-center gap-2 py-0.5 text-[12px] text-muted-foreground/70">
      {pending ? (
        <IconLoader2 className="size-3 animate-spin text-muted-foreground/50" />
      ) : (
        <IconCheck className="size-3 text-green-500/70" />
      )}
      <span className="font-medium">{label}</span>
    </div>
  );
}
