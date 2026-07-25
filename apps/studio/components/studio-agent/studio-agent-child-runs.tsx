"use client";

import {
  IconAlertCircle,
  IconCheck,
  IconClockHour4,
  IconLoader2,
  IconPlayerStop,
  IconShieldQuestion,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import type { StudioAgentRunStatus, StudioAgentRunView } from "@/lib/studio-agent";

export interface StudioAgentChildRunsLabels {
  group: string;
  status: Record<StudioAgentRunStatus, string>;
}

export interface StudioAgentChildRunsProps {
  runs: readonly StudioAgentRunView[];
  labels: StudioAgentChildRunsLabels;
  activeRunId?: string | null;
  onRunSelect?: (runId: string) => void;
  className?: string;
}

export function StudioAgentChildRuns({
  runs,
  labels,
  activeRunId = null,
  onRunSelect,
  className,
}: StudioAgentChildRunsProps) {
  if (runs.length === 0) return null;

  return (
    <div
      data-slot="studio-agent-child-runs"
      aria-label={labels.group}
      className={cn("flex min-w-0 flex-wrap gap-1.5", className)}
    >
      {runs.map((run) => {
        const interactive = Boolean(onRunSelect);
        return (
          <button
            key={run.id}
            type="button"
            disabled={!interactive}
            aria-pressed={interactive ? run.id === activeRunId : undefined}
            onClick={() => onRunSelect?.(run.id)}
            className={cn(
              "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-white/[0.045] px-2.5 text-[11px] text-white/54 transition-colors disabled:cursor-default",
              interactive && "hover:bg-white/[0.08] hover:text-white/76",
              run.id === activeRunId && "bg-white/[0.1] text-white/88"
            )}
          >
            <RunStatusIcon status={run.status} />
            <span className="max-w-48 truncate">{run.title}</span>
            <span className="sr-only">{labels.status[run.status]}</span>
          </button>
        );
      })}
    </div>
  );
}

function RunStatusIcon({ status }: { status: StudioAgentRunStatus }) {
  if (status === "running") {
    return (
      <IconLoader2
        aria-hidden="true"
        className="size-3 shrink-0 animate-spin motion-reduce:animate-none"
      />
    );
  }
  if (status === "waiting_for_approval") {
    return <IconShieldQuestion aria-hidden="true" className="size-3 shrink-0" />;
  }
  if (status === "waiting_for_input") {
    return <IconClockHour4 aria-hidden="true" className="size-3 shrink-0" />;
  }
  if (status === "succeeded") {
    return <IconCheck aria-hidden="true" className="size-3 shrink-0" />;
  }
  if (status === "failed") {
    return <IconAlertCircle aria-hidden="true" className="size-3 shrink-0 text-destructive/78" />;
  }
  if (status === "cancelled" || status === "cancelling") {
    return <IconPlayerStop aria-hidden="true" className="size-3 shrink-0" />;
  }
  return <IconClockHour4 aria-hidden="true" className="size-3 shrink-0" />;
}
