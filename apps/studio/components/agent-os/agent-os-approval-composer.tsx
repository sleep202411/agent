"use client";

import { useId } from "react";
import { IconLoader2, IconShieldHalf } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { ApprovalPayload, type ApprovalPayloadLabels } from "./approval-payload";
import { useComposerGateFocus } from "./use-composer-gate-focus";

export interface AgentOsApprovalComposerLabels {
  title: string;
  approve: string;
  reject: string;
  payload: ApprovalPayloadLabels;
}

/**
 * A pending HITL tool approval, rendered immediately above the composer rather
 * than inline in the transcript. The active run remains paused and submission
 * is disabled, but the input stays mounted so an in-progress draft is never
 * hidden or discarded. The submitted decision returns later as a normal
 * durable user message.
 */
export function AgentOsApprovalComposer({
  approval,
  busy,
  labels,
  onApprove,
}: {
  approval: { toolId: string; arguments: unknown };
  busy: boolean;
  labels: AgentOsApprovalComposerLabels;
  onApprove: (decision: "approve" | "reject") => void;
}) {
  const titleId = useId();
  const titleRef = useComposerGateFocus<HTMLParagraphElement>(approval.toolId);
  return (
    <section
      data-agent-composer-gate="approval"
      aria-labelledby={titleId}
      className="rounded-2xl bg-white/[0.045] p-3 ring-1 ring-inset ring-white/[0.08]"
    >
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {labels.title}
      </span>
      <div className="flex items-center gap-2">
        <IconShieldHalf aria-hidden="true" className="size-4 shrink-0 text-white/82" stroke={1.7} />
        <p
          ref={titleRef}
          id={titleId}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate text-xs font-semibold text-white outline-none"
        >
          {labels.title}
        </p>
      </div>
      {/* What the write actually does — the whole point of the gate. */}
      <ApprovalPayload toolId={approval.toolId} args={approval.arguments} labels={labels.payload} />

      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          className="h-9 flex-1 text-xs font-medium"
          disabled={busy}
          onClick={() => onApprove("approve")}
        >
          {busy ? (
            <IconLoader2
              aria-hidden="true"
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
          ) : null}
          {labels.approve}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-9 flex-1 text-xs font-medium"
          disabled={busy}
          onClick={() => onApprove("reject")}
        >
          {labels.reject}
        </Button>
      </div>
    </section>
  );
}
