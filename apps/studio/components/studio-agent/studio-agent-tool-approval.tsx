"use client";

import { useState } from "react";
import { IconCheck, IconChevronRight, IconHandStop, IconX } from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import type { StudioAgentToolApprovalView } from "@/lib/studio-agent";

export interface StudioAgentToolApprovalLabels {
  /** Sentence naming what is being asked, e.g. "FizzAgent wants to run {tool}." */
  title: (toolName: string) => string;
  approve: string;
  deny: string;
  showInput: string;
  hideInput: string;
  decision: Record<"approved" | "denied", string>;
  /** Shown after a decision, while the agent picks the turn back up. */
  resuming: string;
  /** Shown while the durable lifecycle catches up with the Ably suspension. */
  preparing: string;
}

export interface StudioAgentToolApprovalProps {
  approval: StudioAgentToolApprovalView;
  labels: StudioAgentToolApprovalLabels;
  /** True while the panel cannot write — a torn-down session, or a send in flight. */
  disabled?: boolean;
  /** Visible on Ably, but not yet admitted by the product lifecycle. */
  preparing?: boolean;
  onRespond: (approved: boolean) => void;
  className?: string;
}

/**
 * The library's own approval gate, rendered.
 *
 * `@ably/ai-transport` carries a suspended tool call as a `tool-*` part in
 * `approval-requested` state; the answer goes back through
 * `useChat.addToolApprovalResponse`, and the transport publishes the
 * `tool-approval-response` that resumes the agent. Nothing here is a second
 * mechanism — the row is a view of one part, and both buttons write to that
 * same part.
 *
 * Frosted panel, rim light, zero-chroma white-alpha fills, no borders, white
 * pill for the affirmative action (DESIGN.md rules 2 and 4). It states one call,
 * answered once — there is no capability to grant persistently here and no risk
 * tier to render, because the answer is per tool call. Persistent breadth lives
 * in the permission menu (the thread's mode), which is a different decision.
 */
export function StudioAgentToolApproval({
  approval,
  labels,
  disabled = false,
  preparing = false,
  onRespond,
  className,
}: StudioAgentToolApprovalProps) {
  const [showInput, setShowInput] = useState(false);
  const decision = approval.decision;

  return (
    <section
      data-slot="studio-agent-tool-approval"
      data-tool={approval.toolName}
      data-decision={approval.decision ?? "pending"}
      className={cn(
        "liquid-rim rounded-2xl bg-white/[0.045] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/60">
          <IconHandStop aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-white/90">{labels.title(approval.toolName)}</h3>
          {approval.input ? (
            <>
              <button
                type="button"
                aria-expanded={showInput}
                onClick={() => setShowInput((value) => !value)}
                className="mt-1.5 -ml-1 inline-flex items-center gap-1 rounded-lg px-1 py-0.5 text-[11px] text-white/44 transition-colors hover:bg-white/[0.05] hover:text-white/76"
              >
                <IconChevronRight
                  aria-hidden="true"
                  className={cn(
                    "size-3 shrink-0 transition-transform duration-150",
                    showInput && "rotate-90"
                  )}
                />
                {showInput ? labels.hideInput : labels.showInput}
              </button>
              {showInput ? (
                <pre className="mt-1 max-h-52 overflow-auto rounded-lg bg-black/22 px-3 py-2 font-mono text-[11px]/relaxed break-words whitespace-pre-wrap text-white/46">
                  {approval.input}
                </pre>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {decision === null && preparing ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-3 flex items-center gap-2 text-[11px] text-white/42"
        >
          <span aria-hidden="true" className="flex items-center gap-1">
            <span className="size-1 animate-pulse rounded-full bg-white/38" />
            <span className="size-1 animate-pulse rounded-full bg-white/38 [animation-delay:180ms]" />
            <span className="size-1 animate-pulse rounded-full bg-white/38 [animation-delay:360ms]" />
          </span>
          <span>{labels.preparing}</span>
        </div>
      ) : decision === null ? (
        <div className="mt-3 flex flex-wrap justify-end gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRespond(false)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs text-white/54 transition-colors hover:bg-white/[0.06] hover:text-white/82 disabled:opacity-45"
          >
            <IconX aria-hidden="true" className="size-3.5" />
            {labels.deny}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRespond(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-medium text-black transition-colors hover:bg-white/88 disabled:opacity-45"
          >
            <IconCheck aria-hidden="true" className="size-3.5" />
            {labels.approve}
          </button>
        </div>
      ) : (
        // Answered, but the agent has not produced the tool's output yet. The
        // row states both facts rather than disappearing, so the creator can
        // see their decision registered and the turn still moving.
        <div role="status" className="mt-3 flex items-center gap-1.5 text-[11px] text-white/42">
          <span className="font-medium">{labels.decision[decision]}</span>
          <span className="truncate">· {labels.resuming}</span>
        </div>
      )}
    </section>
  );
}
