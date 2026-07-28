"use client";

import { IconAlertTriangle } from "@tabler/icons-react";

import { GlassRim } from "@/components/ui/glass-rim";
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
  /** Accessible name for the alert region. */
  region: string;
  title: Record<StudioAgentTurnFailureKind, string>;
  /** What the failure means for the creator's story, per attribution. */
  explanation: Record<StudioAgentTurnFailureKind, string>;
  /** Disclosure summary for the server's rejected paths. */
  issues: string;
  /** Prefix for the stable wire code, e.g. "Code". */
  code: string;
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
 * The terminal state of a turn, stated where it cannot be missed.
 *
 * This is deliberately NOT a timeline row and NOT dismissible: it renders from
 * `selectStudioAgentTurnFailure`, so it exists exactly as long as the newest
 * turn is a failed one. The server's message is rendered verbatim — never
 * replaced by a localized apology (root `DESIGN.md` § Error Toasts) — and the
 * localized copy only classifies and explains it.
 *
 * Brand red is the accent here because this is the state that earns it
 * (`apps/studio/DESIGN.md` rule 3): a faint red wash plus a red rim-light on a
 * frosted panel, no fill, no glow.
 */
export function StudioAgentTurnFailure({
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
  const issues = readFailureIssues(failure);

  return (
    <section
      role="alert"
      aria-label={labels.region}
      data-slot="studio-agent-turn-failure"
      data-failure-kind={kind}
      className={cn(
        // Frosted base first, red wash on top: the panel has to read as glass
        // over the near-black canvas as well as over the assistant surface, and
        // brand red only ever tints it (DESIGN.md rule 3), never fills it.
        "relative rounded-2xl bg-[oklch(0.22_0_0/0.82)] px-3.5 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur-[30px]",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[#E52227]/[0.07]"
      />
      <GlassRim gradient={FAILURE_RIM} width="1.5px" />
      <div className="relative flex items-start gap-2.5">
        <IconAlertTriangle aria-hidden="true" className="mt-px size-4 shrink-0 text-[#E52227]" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white/92">{labels.title[kind]}</p>
          <p className="mt-1 text-[11px]/relaxed text-white/50">{labels.explanation[kind]}</p>
          {message ? (
            <p className="mt-2 max-h-32 overflow-y-auto text-[11px]/relaxed break-words whitespace-pre-wrap text-white/76">
              {message}
            </p>
          ) : null}
          {issues.length > 0 ? (
            <details className="mt-2 text-[11px] text-white/50">
              <summary className="cursor-pointer text-white/58 transition-colors hover:text-white/82">
                {labels.issues}
              </summary>
              <ul className="mt-1.5 grid gap-1">
                {issues.map((issue, index) => (
                  <li key={`${issue.path ?? ""}:${index}`} className="break-words">
                    {issue.path ? (
                      <span className="font-mono text-[10px] text-white/68">{issue.path}</span>
                    ) : null}
                    {issue.path ? " — " : null}
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="mt-2.5 flex items-center gap-3">
            {action ? (
              <button
                type="button"
                disabled={action.disabled}
                onClick={action.onClick}
                className="rounded-full bg-white/[0.09] px-3 py-1.5 text-xs font-medium text-white/82 transition-colors hover:bg-white/[0.14] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              >
                {action.label}
              </button>
            ) : null}
            {code ? (
              <span className="ml-auto truncate font-mono text-[10px] text-white/34">
                {labels.code} {code}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Mirrors the sanctioned red rim-light recipe used by option-card selection. */
const redRgba = (alpha: number) => `rgba(229, 34, 39, ${alpha})`;
const FAILURE_RIM = `conic-gradient(from 288deg, ${redRgba(0.55)} 0%, ${redRgba(0.28)} 30%, ${redRgba(0.22)} 55%, ${redRgba(0.22)} 80%, ${redRgba(0.55)} 100%)`;

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
