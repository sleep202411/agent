"use client";

import { IconAlertCircle, IconChevronDown, IconX } from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import type { StudioAgentFailedRunView } from "@/lib/studio-agent";

/**
 * How a terminal turn failure is attributed to the creator.
 *
 * The server stopped guessing at attribution (see
 * `apps/server/src/studio-agent/studio-agent.capability-error.ts`): an input the
 * capability rejected and a server-side contract violation *after* the write are
 * now two different codes carrying two different sentences. Flattening them back
 * into one "something went wrong" here would undo that work — an input rejection
 * is worth re-sending, a post-write recording failure is not.
 */
export type StudioAgentTurnFailureKind = "inputRejected" | "notRecorded" | "failed";

/**
 * Source of truth: `normalizeCapabilityError` in
 * `apps/server/src/studio-agent/studio-agent.capability-executor.ts` and
 * `STUDIO_AGENT_TERMINAL_WRITE_FAILURE_CODE` in `studio-agent.write-failure.ts`.
 * These are stable wire codes, not localizable copy, so they are matched
 * literally; an unknown code degrades to the generic kind rather than lying.
 */
const INPUT_REJECTED_CODES: readonly string[] = ["studio_agent.invalid_action_input"];
const NOT_RECORDED_CODES: readonly string[] = [
  "studio_agent.capability_result_invalid",
  "studio_agent.write_failed",
  "STUDIO_AGENT_TERMINAL_WRITE_FAILED",
];

export function studioAgentTurnFailureKind(
  failure: StudioAgentFailedRunView
): StudioAgentTurnFailureKind {
  const code = failure.error?.code ?? null;
  if (code === null) return "failed";
  if (INPUT_REJECTED_CODES.includes(code)) return "inputRejected";
  if (NOT_RECORDED_CODES.includes(code)) return "notRecorded";
  return "failed";
}

export interface StudioAgentTurnFailureLabels {
  /** Accessible name for the failure row. */
  region: string;
  title: Record<StudioAgentTurnFailureKind, string>;
  /** What the failure means for the creator's story, per attribution. */
  explanation: Record<StudioAgentTurnFailureKind, string>;
  /** Disclosure summary for the diagnostic block (code, correlation id, issues). */
  details: string;
  /** Heading for the server's rejected paths inside the disclosure. */
  issues: string;
  /** Prefix for the stable wire code, e.g. "Code". */
  code: string;
  /** Prefix for the support correlation id, e.g. "Diagnostic". */
  diagnosticId: string;
}

export interface StudioAgentTurnFailureAction {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

interface StudioAgentTurnFailureIssue {
  path: string | null;
  message: string;
}

/**
 * A failed turn, stated INSIDE the conversation flow.
 *
 * This replaces the pinned red-rimmed alert card (retired 2026-07-31: the owner
 * ruled that errors are part of the message flow — one quiet row, like any
 * other chat product, never a blocking banner). The row is deliberately small:
 *
 * - one destructive-toned line naming the failure,
 * - the server's public sentence, verbatim and secondary — never replaced by a
 *   localized apology (root `DESIGN.md` § Error Toasts),
 * - the obvious next move (retry / edit) as a quiet inline action,
 * - and everything a support thread needs — attribution guidance, rejected
 *   paths, the stable wire code, the diagnostic id — behind a "Details"
 *   disclosure so casual creators never read error codes.
 *
 * Monochrome by design (`apps/studio/DESIGN.md` rules 2–4): failure tone comes
 * from the `destructive` token on TEXT only. No red wash, no rim, no border —
 * quiet, not hidden. It renders from the timeline projection, so it exists
 * exactly as long as the failed turn is part of the conversation.
 */
export function StudioAgentTurnFailureRow({
  failure,
  labels,
  action,
  className,
}: {
  failure: StudioAgentFailedRunView;
  labels: StudioAgentTurnFailureLabels;
  /** The obvious next move. Omitted when the surface has none to offer. */
  action?: StudioAgentTurnFailureAction;
  className?: string;
}) {
  const kind = studioAgentTurnFailureKind(failure);
  const message = failure.error?.message ?? failure.summary;
  const code = failure.error?.code ?? null;
  const diagnosticId = failure.error?.diagnosticId ?? null;
  const issues = readFailureIssues(failure);

  return (
    <div
      role="group"
      aria-label={labels.region}
      data-slot="studio-agent-turn-failure"
      data-failure-kind={kind}
      className={cn("min-w-0 px-1.5 text-xs/relaxed", className)}
    >
      <div className="flex items-start gap-2">
        <IconAlertCircle
          aria-hidden="true"
          className="mt-[3px] size-3.5 shrink-0 text-destructive/82"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-destructive/82">{labels.title[kind]}</p>
          {message ? (
            <p className="mt-0.5 break-words whitespace-pre-wrap text-white/52">{message}</p>
          ) : null}
          <div className="mt-1.5 flex min-w-0 items-start gap-3">
            {action ? (
              <button
                type="button"
                disabled={action.disabled}
                onClick={action.onClick}
                className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 font-medium text-white/72 transition-colors hover:bg-white/[0.11] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              >
                {action.label}
              </button>
            ) : null}
            <details
              data-slot="studio-agent-turn-failure-details"
              className="group/details min-w-0 flex-1"
            >
              <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-1 py-1 text-[11px] text-white/44 transition-colors hover:text-white/72 focus-visible:ring-1 focus-visible:ring-white/24 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                {labels.details}
                <IconChevronDown
                  aria-hidden="true"
                  className="size-3 shrink-0 transition-transform group-open/details:rotate-180"
                />
              </summary>
              <div className="mt-1 grid gap-1.5 text-[11px]/relaxed text-white/48">
                <p>{labels.explanation[kind]}</p>
                {issues.length > 0 ? (
                  <div>
                    <p className="text-white/56">{labels.issues}</p>
                    <ul className="mt-0.5 grid gap-1">
                      {issues.map((issue, index) => (
                        <li key={`${issue.path ?? ""}:${index}`} className="break-words">
                          {issue.path ? (
                            <span className="font-mono text-[10px] text-white/64">
                              {issue.path}
                            </span>
                          ) : null}
                          {issue.path ? " — " : null}
                          <span>{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {code ? (
                  <p className="truncate font-mono text-[10px] text-white/40">
                    {labels.code} {code}
                  </p>
                ) : null}
                {diagnosticId ? (
                  <p className="truncate font-mono text-[10px] text-white/40">
                    {labels.diagnosticId} {diagnosticId}
                  </p>
                ) : null}
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface StudioAgentTurnFailureNoticeLabels {
  /** Accessible name for the notice. */
  region: string;
  title: Record<StudioAgentTurnFailureKind, string>;
  /** The deep-link into FizzAgent, e.g. "Open FizzAgent". */
  open: string;
  /** Accessible name for the dismiss control. */
  dismiss: string;
}

/**
 * The closed-panel echo of a failed turn: one compact, dismissible notice.
 *
 * The bootstrap stays mounted while StoryOS is closed, so a turn can die with
 * nothing on screen — this is how the creator learns about it from the canvas.
 * It is an usher, not a second error surface: the failure itself (message,
 * retry, diagnostics) lives on the timeline row inside the panel, which is why
 * this deep-links there and why the host hides it permanently once the failure
 * has been seen or dismissed. Frosted panel, destructive tone on the glyph
 * only — a transient notice never wears the red-rim treatment.
 */
export function StudioAgentTurnFailureNotice({
  failure,
  labels,
  onOpen,
  onDismiss,
  className,
}: {
  failure: StudioAgentFailedRunView;
  labels: StudioAgentTurnFailureNoticeLabels;
  onOpen: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  const kind = studioAgentTurnFailureKind(failure);
  const message = failure.error?.message ?? failure.summary;

  return (
    <div
      role="status"
      aria-label={labels.region}
      data-slot="studio-agent-turn-failure-notice"
      data-failure-kind={kind}
      className={cn(
        "flex min-w-0 items-center gap-2.5 rounded-2xl bg-[oklch(0.22_0_0/0.92)] py-2 pr-2 pl-3 shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur-[30px]",
        className
      )}
    >
      <IconAlertCircle aria-hidden="true" className="size-3.5 shrink-0 text-destructive/82" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-white/86">{labels.title[kind]}</p>
        {message ? <p className="mt-0.5 truncate text-[11px] text-white/48">{message}</p> : null}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="shrink-0 rounded-full bg-white/[0.09] px-3 py-1.5 text-xs font-medium text-white/82 transition-colors hover:bg-white/[0.14] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
      >
        {labels.open}
      </button>
      <button
        type="button"
        aria-label={labels.dismiss}
        onClick={onDismiss}
        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-white/55 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
      >
        <IconX aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * The structured half of the server's error.
 *
 * `details.issues` is what `describeZodIssues` produced, and the error message
 * only carries a truncated "(+N more)" rendition of it. Read defensively: the
 * details bag is an open JSON object and other codes fill it differently.
 */
function readFailureIssues(failure: StudioAgentFailedRunView): StudioAgentTurnFailureIssue[] {
  const raw = failure.error?.details?.issues;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): StudioAgentTurnFailureIssue[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.message !== "string" || candidate.message.length === 0) return [];
    const path =
      typeof candidate.path === "string" && candidate.path.length > 0 ? candidate.path : null;
    return [{ path, message: candidate.message }];
  });
}
