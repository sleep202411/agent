"use client";

import { IconCheck, IconClockHour4, IconShieldExclamation, IconX } from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import type { StudioAgentApprovalStatus, StudioAgentApprovalView } from "@/lib/studio-agent";

export interface StudioAgentApprovalSurfaceLabels {
  capability: string;
  approveOnce: string;
  approveAlways: string;
  reject: string;
  status: Record<StudioAgentApprovalStatus, string>;
  risk: Record<StudioAgentApprovalView["risk"], string>;
}

export interface StudioAgentApprovalSurfaceProps {
  approval: StudioAgentApprovalView;
  labels: StudioAgentApprovalSurfaceLabels;
  resolving?: boolean;
  allowPersistentApproval?: boolean;
  onApprove: (scope: "once" | "always") => void;
  onReject: () => void;
  className?: string;
}

export function StudioAgentApprovalSurface({
  approval,
  labels,
  resolving = false,
  allowPersistentApproval = true,
  onApprove,
  onReject,
  className,
}: StudioAgentApprovalSurfaceProps) {
  const pending = approval.status === "pending";

  return (
    <section
      data-slot="studio-agent-approval"
      data-status={approval.status}
      className={cn(
        "liquid-rim rounded-2xl bg-white/[0.045] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/60",
            (approval.risk === "high" || approval.risk === "critical") && "text-destructive/84"
          )}
        >
          <IconShieldExclamation aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-white/90">{approval.title}</h3>
          {approval.description ? (
            <p className="mt-1 text-xs/relaxed text-white/52">{approval.description}</p>
          ) : null}
          <dl className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/38">
            <div className="flex min-w-0 items-center gap-1">
              <dt>{labels.capability}</dt>
              <dd className="max-w-56 truncate font-mono text-white/52">{approval.capability}</dd>
            </div>
            <div>
              <dt className="sr-only">{labels.risk[approval.risk]}</dt>
              <dd
                className={cn(
                  (approval.risk === "high" || approval.risk === "critical") &&
                    "text-destructive/78"
                )}
              >
                {labels.risk[approval.risk]}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {pending ? (
        <div className="mt-3 flex flex-wrap justify-end gap-1.5">
          <button
            type="button"
            disabled={resolving}
            onClick={onReject}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs text-white/54 transition-colors hover:bg-white/[0.06] hover:text-white/82 disabled:opacity-45"
          >
            <IconX aria-hidden="true" className="size-3.5" />
            {labels.reject}
          </button>
          {allowPersistentApproval ? (
            <button
              type="button"
              disabled={resolving}
              onClick={() => onApprove("always")}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/[0.07] px-3 text-xs text-white/72 transition-colors hover:bg-white/[0.11] hover:text-white disabled:opacity-45"
            >
              {labels.approveAlways}
            </button>
          ) : null}
          <button
            type="button"
            disabled={resolving}
            onClick={() => onApprove("once")}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-medium text-black transition-colors hover:bg-white/88 disabled:opacity-45"
          >
            <IconCheck aria-hidden="true" className="size-3.5" />
            {labels.approveOnce}
          </button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-white/42">
          <IconClockHour4 aria-hidden="true" className="size-3" />
          <span>{labels.status[approval.status]}</span>
          {approval.resolution ? <span className="truncate">· {approval.resolution}</span> : null}
        </div>
      )}
    </section>
  );
}
