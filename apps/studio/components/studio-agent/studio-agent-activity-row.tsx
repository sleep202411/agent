"use client";

import { useState, type ComponentType } from "react";
import {
  IconAlertCircle,
  IconBook2,
  IconCheck,
  IconChevronRight,
  IconLoader2,
  IconPlayerStop,
  IconSearch,
  IconTerminal2,
  IconTool,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import type {
  StudioAgentActivityKind,
  StudioAgentActivityStatus,
  StudioAgentActivityView,
} from "@/lib/studio-agent";

export interface StudioAgentActivityRowLabels {
  expand: string;
  collapse: string;
  semantic: Readonly<Record<string, string>>;
  status: Record<StudioAgentActivityStatus, string>;
}

export interface StudioAgentActivityRowProps {
  activity: StudioAgentActivityView;
  labels: StudioAgentActivityRowLabels;
  defaultExpanded?: boolean;
  className?: string;
}

const kindIcons: Record<
  StudioAgentActivityKind,
  ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  read: IconBook2,
  search: IconSearch,
  analyze: IconSearch,
  plan: IconBook2,
  execute: IconTerminal2,
  generate: IconTool,
  wait: IconBook2,
  other: IconTool,
};

export function StudioAgentActivityRow({
  activity,
  labels,
  defaultExpanded = false,
  className,
}: StudioAgentActivityRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const Icon = kindIcons[activity.kind];
  const hasDetail = Boolean(activity.detail);
  const label = labels.semantic[activity.label] ?? activity.label;

  return (
    <div
      data-slot="studio-agent-activity"
      data-status={activity.status}
      className={cn("group min-w-0 text-white/58", className)}
    >
      <button
        type="button"
        disabled={!hasDetail}
        aria-expanded={hasDetail ? expanded : undefined}
        aria-label={hasDetail ? (expanded ? labels.collapse : labels.expand) : undefined}
        onClick={() => hasDetail && setExpanded((value) => !value)}
        className="flex min-h-7 w-full min-w-0 items-center gap-2 rounded-lg px-1.5 text-left text-xs transition-colors enabled:hover:bg-white/[0.04] enabled:hover:text-white/76 disabled:cursor-default"
      >
        <Icon aria-hidden={true} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ActivityStatus status={activity.status} label={labels.status[activity.status]} />
        {hasDetail ? (
          <IconChevronRight
            aria-hidden="true"
            className={cn(
              "size-3 shrink-0 transition-transform duration-150",
              expanded && "rotate-90"
            )}
          />
        ) : null}
      </button>

      {hasDetail && expanded ? (
        <pre className="mt-1 ml-7 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/22 px-3 py-2 font-mono text-[11px]/relaxed text-white/46">
          {activity.detail}
        </pre>
      ) : null}
    </div>
  );
}

function ActivityStatus({ status, label }: { status: StudioAgentActivityStatus; label: string }) {
  if (status === "running") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-white/36">
        <IconLoader2
          aria-hidden="true"
          className="size-3 animate-spin motion-reduce:animate-none"
        />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  if (status === "succeeded") {
    return (
      <span className="text-white/36" title={label}>
        <IconCheck aria-hidden="true" className="size-3" />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  if (status === "cancelled") {
    return (
      <span className="text-white/36" title={label}>
        <IconPlayerStop aria-hidden="true" className="size-3" />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn("text-white/36", status === "failed" && "text-destructive/78")}
      title={label}
    >
      <IconAlertCircle aria-hidden="true" className="size-3" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
