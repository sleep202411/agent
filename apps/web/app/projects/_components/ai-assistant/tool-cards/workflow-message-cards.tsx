"use client";

/**
 * Renderers for the four workflow lifecycle message types the agent emits:
 *   workflow_progress / workflow_suspended / workflow_completed /
 *   workflow_failed
 *
 * Each card is a pure function of its tool part's `output` field — no WS
 * subscriptions, no status polling, no in-place mutation across messages.
 * The only live thing is the CURRENT progress message, whose blob the
 * server updates via the chat WS's existing message_updated plumbing.
 *
 * Paired with packages/shared/src/workflow-messages.ts for the payload
 * schemas. See that file's top doc comment for the overall design.
 */
import { useEffect, useRef, useState } from "react";
import {
  IconAlertCircle,
  IconCheck,
  IconCopy,
  IconLoader2,
  IconRefresh,
  IconSparkles,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch, useAppSelector } from "@/src/store";
import {
  clearActiveWorkflow,
  confirmWorkflowFromButton,
  setActiveWorkflow,
  setDraft,
  startWorkflowFromButton,
} from "@/src/store/slices/assistantSlice";
import {
  buildInputData,
  DraftSummary,
  PersonaPill,
  StoryOutlineResult,
  WORKFLOW_LABEL_KEYS,
  WORKFLOW_PERSONA,
} from "./workflow-shared";
import type { AssistantToolInvocation } from "@/src/lib/assistant/assistant-types";
import type { Draft, WorkflowName } from "@/src/lib/workflow/workflow-client";
import type {
  WorkflowCompletedOutput,
  WorkflowFailedOutput,
  WorkflowProgressOutput,
  WorkflowQueuedOutput,
  WorkflowSuspendedOutput,
} from "@repo/shared";

// ─── Shared: mirror the workflow status into Redux so the composer's
//     "工作中" pill + stop button know there's a run in flight.
//
// setActive must only fire from the latest assistant message (isActive=true)
// so past cards in history don't overwrite live state. Clearing, however,
// fires unconditionally from any terminal card — the reducer's runId guard
// (`current.activeWorkflow.runId === runId`) already filters stale clears,
// and this way a terminal card that isn't the last-assistant (e.g. the
// composer streamed a follow-up text part on the same message) can still
// unstick the pill.
function useSyncActiveWorkflow(
  isActive: boolean,
  runId: string | undefined,
  workflowName: WorkflowName | undefined,
  status: "queued" | "running" | "suspended" | "completed" | "failed" | "cancelled"
): void {
  const dispatch = useAppDispatch();
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  useEffect(() => {
    if (!projectId || !runId || !workflowName) return;
    const terminal = status === "completed" || status === "failed" || status === "cancelled";
    if (terminal) {
      dispatch(clearActiveWorkflow({ projectId, runId }));
      return;
    }
    if (!isActive) return;
    dispatch(setActiveWorkflow({ projectId, runId, workflowName, status }));
  }, [dispatch, projectId, isActive, runId, workflowName, status]);
}

// ─── Shared action buttons (unified look across suspended/completed/failed)

type ActionVariant = "primary" | "secondary";

function ActionButton({
  variant,
  onClick,
  disabled,
  busy,
  icon,
  children,
}: {
  variant: ActionVariant;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-[13px] font-medium transition-colors",
        variant === "primary"
          ? "bg-primary/15 text-primary-foreground hover:bg-primary/25"
          : "bg-muted/60 text-foreground/90 hover:bg-muted",
        "disabled:opacity-50"
      )}
    >
      {busy && <IconLoader2 className="size-4 animate-spin" />}
      {icon}
      {children}
    </button>
  );
}

// ─── Shared header (persona + status label) ────────────────────────────

function CardHeader({
  workflowName,
  stateLabel,
  progress,
}: {
  workflowName: WorkflowName;
  stateLabel: string;
  progress?: { current: number; total: number; label?: string };
}) {
  const persona = WORKFLOW_PERSONA[workflowName];
  return (
    <div className="w-full text-[13px]">
      {persona && <PersonaPill persona={persona} />}
      <div className="mt-2 flex w-full items-center gap-2">
        <span className="font-semibold text-foreground/90">{stateLabel}</span>
        {progress && progress.total > 0 && (
          <span className="ml-auto truncate text-[11px] text-muted-foreground">
            {progress.current}/{progress.total}
            {progress.label ? ` · ${progress.label}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

function ProgressBar({
  current,
  total,
  tone = "primary",
}: {
  current: number;
  total: number;
  tone?: "primary" | "amber" | "green" | "destructive";
}) {
  if (total <= 0) return null;
  const barClass = {
    primary: "bg-primary/70",
    amber: "bg-amber-500/70",
    green: "bg-green-500/70",
    destructive: "bg-destructive/70",
  }[tone];
  return (
    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/5">
      <div
        className={cn("h-full transition-all", barClass)}
        style={{ width: `${Math.min(100, (current / total) * 100)}%` }}
      />
    </div>
  );
}

// ─── workflow_queued (mutates in place as queue advances) ─────────────

/**
 * Soft "you're in line" card. Server publishes one of these the
 * moment a run enters BullMQ, then re-publishes whenever the queue
 * advances (other runs finish, this run's position drops). Once a
 * worker actually picks up the job, server stops emitting queued and
 * `WorkflowProgressCard` takes over — same `runId`, different message
 * type, so the UI smoothly transitions without an empty gap.
 *
 * Position is 0-indexed: `0` means "next to run", `>0` means "N runs
 * ahead". We render slightly different copy for `0` vs `>0` so the
 * user perceives the difference between "almost yours" and "still
 * waiting", without leaning on a numeric estimate of remaining time
 * (which would be hard to keep accurate).
 */
export function WorkflowQueuedCard({
  part,
  isActive,
}: {
  part: AssistantToolInvocation;
  isActive: boolean;
}) {
  const output = (part.output ?? {}) as Partial<WorkflowQueuedOutput>;
  const t = useTranslations("ai");
  useSyncActiveWorkflow(isActive, output.runId, output.workflowName, "queued");
  if (!output.workflowName) return null;
  const position = output.position ?? 0;
  const stateLabel = t("workflowStateQueued");
  const detail =
    position === 0
      ? t("workflowQueuePositionNext")
      : t("workflowQueuePositionAhead", { count: position });

  return (
    <div className="w-full">
      <CardHeader workflowName={output.workflowName} stateLabel={stateLabel} progress={undefined} />
      <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <IconLoader2 className="size-3.5 animate-spin opacity-60" />
        <span>{detail}</span>
      </p>
    </div>
  );
}

// ─── workflow_progress (mutates in place) ─────────────────────────────

export function WorkflowProgressCard({
  part,
  isActive,
}: {
  part: AssistantToolInvocation;
  isActive: boolean;
}) {
  const output = (part.output ?? {}) as Partial<WorkflowProgressOutput>;
  const t = useTranslations("ai");
  useSyncActiveWorkflow(isActive, output.runId, output.workflowName, "running");
  if (!output.workflowName) return null;

  const current = output.current ?? 0;
  const total = output.total ?? 0;
  const done = total > 0 && current >= total;

  // At 100% the workflow_completed / workflow_suspended / workflow_failed
  // message right after this one carries the final state + next-step button,
  // so the progress card would just duplicate it. Suppress the last tick.
  if (done) return null;

  // Phase-aware label: "规划中" for the LLM draft phase, "入库中" for the
  // commit phase. Without this both phases read "规划中" and the user can't
  // tell they're watching two different chunks of work.
  const stateLabel =
    output.phase === "committing" ? t("workflowStateCommitting") : t("workflowStateRunning");

  return (
    <div className="w-full">
      <CardHeader
        workflowName={output.workflowName}
        stateLabel={stateLabel}
        progress={{ current, total, label: output.label }}
      />
      <ProgressBar current={current} total={total} tone="primary" />
      {output.narrateLines && output.narrateLines.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed text-foreground/85">
          {output.narrateLines.map((line, i) => (
            <li key={`${i}-${line.slice(0, 10)}`}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── workflow_suspended (HITL gate — satisfy / revise buttons) ────────

/**
 * Build the 满意-button label so it tells the user what clicking will do
 * AND how much it costs. Three shapes in order of preference:
 *   1. nextAction present → "继续 <下一阶段> (N 积分)"
 *      The cost shown is the NEXT phase's estimate because THIS phase's
 *      cost is already locked in at generation time (charged regardless
 *      of 满意 / 不满意). What the user can still control by clicking is
 *      whether to spend MORE on the next phase.
 *   2. nextAction absent but estimatedCost > 0 → "完成 · 已扣 N 积分"
 *      Terminal phase (storyboard). The button "completes" this phase
 *      and the current-phase cost has been incurred.
 *   3. Fallback → plain `workflowActionAccept` label from i18n.
 */
function formatAcceptLabel(
  output: Partial<WorkflowSuspendedOutput>,
  t: (key: string, params?: Record<string, string | number | Date>) => string
): string {
  const nextAction = output.nextAction;
  if (nextAction) {
    const nextLabel = t(WORKFLOW_LABEL_KEYS[nextAction.workflowName] ?? "workflowActionAccept");
    if (nextAction.estimatedCost > 0) {
      return t("workflowContinueWithCost", {
        next: nextLabel,
        cost: nextAction.estimatedCost,
      });
    }
    return t("workflowContinueNext", { next: nextLabel });
  }
  const currentCost = output.estimatedCost ?? 0;
  if (currentCost > 0) {
    return t("workflowApproveWithCost", { cost: currentCost });
  }
  return t("workflowActionAccept");
}

/**
 * What the USER BUBBLE reads after clicking accept. Mirrors the button's
 * action ("继续 分镜生成" / "完成") but strips the credit suffix — the
 * bubble is a log of what the user did, not an ad for cost. Falls back to
 * the generic "满意" i18n string when we don't know the next step.
 */
function formatAcceptUserLabel(
  output: Partial<WorkflowSuspendedOutput>,
  t: (key: string, params?: Record<string, string | number | Date>) => string
): string {
  const nextAction = output.nextAction;
  if (nextAction) {
    const nextLabel = t(WORKFLOW_LABEL_KEYS[nextAction.workflowName] ?? "workflowActionAccept");
    return t("workflowContinueNext", { next: nextLabel });
  }
  return t("workflowUserSatisfied");
}

function toDraftLike(
  runId: string,
  entityType: string,
  preview: { clientRefId: string; data: Record<string, unknown> }
): Draft {
  const now = Date.now();
  return {
    clientRefId: preview.clientRefId,
    runId,
    entityType: entityType as Draft["entityType"],
    status: "pending",
    data: preview.data,
    createdAt: now,
    updatedAt: now,
  };
}

export function WorkflowSuspendedCard({
  part,
  isActive,
}: {
  part: AssistantToolInvocation;
  /**
   * True when this is the last assistant message — i.e. the workflow is
   * genuinely waiting for this user. False once any newer message has
   * arrived (user already acted, workflow moved on), in which case the
   * buttons silently toast instead of dispatching.
   */
  isActive: boolean;
}) {
  const output = (part.output ?? {}) as Partial<WorkflowSuspendedOutput>;
  const t = useTranslations("ai");
  const dispatch = useAppDispatch();
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  useSyncActiveWorkflow(isActive, output.runId, output.workflowName, "suspended");

  const [actionBusy, setActionBusy] = useState<null | "accept" | "revise">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // parse_script-only: when the project already has episodes from a
  // prior run, the suspend payload reports `existingEpisodeCount > 0`
  // and we surface a toggle. Default mode is "append" (legacy behaviour
  // / safer for partial test data); user picks "replace" only when they
  // want to wipe stale episodes from earlier experiments.
  const existingEpisodeCount = output.existingEpisodeCount ?? 0;
  const [replaceExisting, setReplaceExisting] = useState(false);
  // Synchronous re-entry guard. `actionBusy` is useState and its update
  // isn't observable inside the same render pass, so a fast double-click
  // would slip through the `if (actionBusy) return` check and dispatch
  // twice (two "滿意" user messages + two resume_workflow calls in the
  // chat history). A ref updates synchronously and blocks the second
  // entry before any async work starts.
  const dispatchedRef = useRef(false);

  if (!output.workflowName || !output.runId) return null;

  const runId = output.runId;
  const drafts: Draft[] = (output.draftGroups ?? []).flatMap((g) =>
    g.items.map((item) => toDraftLike(runId, g.entityType, item))
  );

  const handleAccept = async () => {
    if (dispatchedRef.current) return;
    if (!projectId || !isActive) return;
    dispatchedRef.current = true;
    setActionBusy("accept");
    setActionError(null);
    try {
      await dispatch(
        confirmWorkflowFromButton({
          projectId,
          runId,
          userLabel: formatAcceptUserLabel(output, t),
          approved: true,
          ...(existingEpisodeCount > 0 ? { replaceExisting } : {}),
        })
      );
    } catch (e) {
      // On failure allow a retry — clear the ref so a subsequent click
      // can attempt again. On success we intentionally leave it set; the
      // suspended message will become "historical" once new messages
      // arrive and the isActive guard will take over from there.
      dispatchedRef.current = false;
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(null);
    }
  };

  /**
   * Revise from the suspended card drops a placeholder into the composer
   * instead of firing a window.prompt — matches the completed card's revise
   * UX. The user types their specific feedback after the prefill and sends
   * as a normal message; the supervisor routes it back into the suspended
   * workflow (resume_workflow with approved=false) via its own tool-call.
   */
  const handleRevise = () => {
    if (!projectId || !isActive) return;
    const text = t("workflowActionRevise");
    dispatch(setDraft({ projectId, draft: text }));
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("ai-assistant:set-draft", {
          detail: { projectId, text },
        })
      );
    }
  };

  return (
    <div className="w-full">
      <CardHeader
        workflowName={output.workflowName}
        stateLabel={t("workflowStateDone")}
        progress={
          output.totalDraftCount && output.totalDraftCount > 0
            ? {
                current: output.totalDraftCount,
                total: output.totalDraftCount,
                label: t("workflowCompleted"),
              }
            : undefined
        }
      />
      <ProgressBar
        current={output.totalDraftCount ?? 0}
        total={output.totalDraftCount ?? 0}
        tone="amber"
      />
      {drafts.length > 0 && <DraftSummary drafts={drafts} t={t} />}
      {existingEpisodeCount > 0 && (
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/40 p-3 text-[12px]">
          <div className="font-medium text-foreground/85">
            {t("parseScriptExistingTitle", { count: existingEpisodeCount })}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {t("parseScriptExistingHint")}
          </p>
          <div className="mt-2 flex flex-col gap-1.5">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name={`parse-script-mode-${runId}`}
                checked={!replaceExisting}
                onChange={() => setReplaceExisting(false)}
                disabled={actionBusy !== null || !isActive}
                className="mt-0.5"
              />
              <span className="text-foreground/85">
                {t("parseScriptModeAppend")}
                <span className="ml-1 text-muted-foreground">{t("parseScriptModeAppendHint")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name={`parse-script-mode-${runId}`}
                checked={replaceExisting}
                onChange={() => setReplaceExisting(true)}
                disabled={actionBusy !== null || !isActive}
                className="mt-0.5"
              />
              <span className="text-foreground/85">
                {t("parseScriptModeReplace")}
                <span className="ml-1 text-muted-foreground">
                  {t("parseScriptModeReplaceHint", { count: existingEpisodeCount })}
                </span>
              </span>
            </label>
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-col gap-2">
        <div className="text-[13px] font-medium text-foreground/90">
          {t("workflowConfirmPrompt")}
        </div>
        <ActionButton
          variant="primary"
          onClick={handleAccept}
          disabled={actionBusy !== null || !isActive}
          busy={actionBusy === "accept"}
        >
          {formatAcceptLabel(output, t)}
        </ActionButton>
        <ActionButton
          variant="secondary"
          onClick={handleRevise}
          disabled={actionBusy !== null || !isActive}
          busy={actionBusy === "revise"}
        >
          {t("workflowActionRevise")}
        </ActionButton>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{t("workflowReviseHint")}</div>
      </div>
      {actionError && <div className="mt-2 text-[11px] text-destructive/80">{actionError}</div>}
    </div>
  );
}

// ─── workflow_completed (summary + continue button) ──────────────────

export function WorkflowCompletedCard({
  part,
  isActive,
}: {
  part: AssistantToolInvocation;
  isActive: boolean;
}) {
  const output = (part.output ?? {}) as Partial<WorkflowCompletedOutput>;
  const t = useTranslations("ai");
  const dispatch = useAppDispatch();
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const worldId = useAppSelector((s) =>
    projectId ? (s.project.instances[projectId]?.worldId ?? null) : null
  );
  const targetEpisodeCount = useAppSelector((s) =>
    projectId ? s.project.instances[projectId]?.detail?.targetEpisodeCount : undefined
  );
  useSyncActiveWorkflow(isActive, output.runId, output.workflowName, "completed");
  // See suspended card: useState isn't synchronous, so a double-click
  // could spawn two next-step workflows before the first call returns.
  const dispatchedRef = useRef(false);

  if (!output.workflowName) return null;

  const committedCount = output.committed?.length ?? 0;
  const failedCount = output.failed?.length ?? 0;
  const partial = failedCount > 0;

  const handlePickNext = (next: NonNullable<typeof output.nextSteps>[number]) => {
    if (dispatchedRef.current) return;
    if (!projectId || !isActive) return;
    dispatchedRef.current = true;
    const defaults = buildInputData(next.workflowName, {
      projectId,
      worldId,
      targetEpisodeCount: typeof targetEpisodeCount === "number" ? targetEpisodeCount : null,
    });
    // next.inputData (set by the previous workflow's completion payload)
    // takes precedence so a phase can scope the next step — e.g.
    // episode_phase passes `{ episodeIds: [...] }` so script_phase only
    // covers the batch it just committed.
    const merged = { ...defaults, ...(next.inputData ?? {}) };
    void dispatch(
      startWorkflowFromButton({
        projectId,
        userLabel: t(next.labelKey),
        workflowName: next.workflowName,
        inputData: merged,
      })
    );
  };

  /**
   * Revise drops a placeholder into the composer instead of sending —
   * the user then types their feedback after it and presses send.
   * Cross-component editor sync goes through a CustomEvent the panel
   * listens to; plain `setDraft` alone won't update the contenteditable.
   */
  const handleRevise = () => {
    if (!projectId || !isActive) return;
    const text = t("workflowActionRevise");
    dispatch(setDraft({ projectId, draft: text }));
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("ai-assistant:set-draft", {
          detail: { projectId, text },
        })
      );
    }
  };

  // Compact chip form — used for low-signal terminal states (deprecated
  // after the parent-workflow deletion; still rendered if any legacy
  // workflow emits it so existing messages in chat history don't break).
  if (output.compact) {
    return (
      <div className="flex items-center gap-2 py-0.5 text-[12px] text-muted-foreground/70">
        <IconCheck className="size-3 shrink-0 text-green-500/70" />
        <span className="font-medium">
          {output.summaryKey
            ? t(
                output.summaryKey,
                (output.summaryParams ?? {}) as Record<string, string | number | Date>
              )
            : (output.summary ??
              (partial
                ? t("workflowCommittedSummaryWithFailures", {
                    count: committedCount,
                    failed: failedCount,
                  })
                : t("workflowCommittedSummary", { count: committedCount })))}
        </span>
      </div>
    );
  }

  return (
    <div className="w-full">
      <CardHeader
        workflowName={output.workflowName}
        stateLabel={t("workflowStateDone")}
        progress={
          committedCount > 0
            ? { current: committedCount, total: committedCount + failedCount }
            : undefined
        }
      />
      <ProgressBar
        current={committedCount}
        total={Math.max(1, committedCount + failedCount)}
        tone={partial ? "amber" : "green"}
      />
      <div className="mt-2 flex items-start gap-1.5 text-[12.5px] text-foreground/85">
        <IconCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
        <span>
          {output.summaryKey
            ? t(
                output.summaryKey,
                (output.summaryParams ?? {}) as Record<string, string | number | Date>
              )
            : (output.summary ??
              (partial
                ? t("workflowCommittedSummaryWithFailures", {
                    count: committedCount,
                    failed: failedCount,
                  })
                : t("workflowCommittedSummary", { count: committedCount })))}
        </span>
      </div>
      {/* Workflow-specific structured result panel (章节/角色/场景 for
          story_outline; extend the switch below as other workflows grow
          inline summaries). */}
      {output.workflowName === "story_outline" && output.result ? (
        <StoryOutlineResult result={output.result} t={t} />
      ) : null}
      {output.nextSteps && output.nextSteps.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {output.nextSteps.map((next, i) => {
            const v = next.variant ?? (i === 0 ? "primary" : "secondary");
            const costSuffix =
              typeof next.estimatedCost === "number" && next.estimatedCost > 0
                ? ` ${t("workflowCreditSuffix", { cost: next.estimatedCost })}`
                : "";
            return (
              <ActionButton
                key={`${next.workflowName}-${i}`}
                variant={v}
                onClick={() => handlePickNext(next)}
                disabled={!projectId || !isActive}
                icon={v === "primary" ? <IconSparkles className="size-4" /> : undefined}
              >
                {`${t(next.labelKey)}${costSuffix}`}
              </ActionButton>
            );
          })}
          {output.revisable !== false && (
            <>
              <ActionButton
                variant="secondary"
                onClick={handleRevise}
                disabled={!projectId || !isActive}
              >
                {t("workflowActionRevise")}
              </ActionButton>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {t("workflowReviseHint")}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── workflow_failed / cancelled ─────────────────────────────────────

export function WorkflowFailedCard({
  part,
  isActive,
}: {
  part: AssistantToolInvocation;
  isActive: boolean;
}) {
  const output = (part.output ?? {}) as Partial<WorkflowFailedOutput>;
  const t = useTranslations("ai");
  const tc = useTranslations("common");
  const dispatch = useAppDispatch();
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const worldId = useAppSelector((s) =>
    projectId ? (s.project.instances[projectId]?.worldId ?? null) : null
  );
  const targetEpisodeCount = useAppSelector((s) =>
    projectId ? s.project.instances[projectId]?.detail?.targetEpisodeCount : undefined
  );
  // Read the project's currently-tracked active workflow so we can guard
  // the retry button. When a user clicks "重新拆解" / similar, the
  // supervisor often runs cancel_workflow on the old run + invoke_workflow
  // on a fresh run as a single semantic action; the cancelled-card from
  // the old run lingers in chat history with its retry button armed. If
  // the user clicks Retry there, we'd happily fire run #3 *concurrently*
  // with the supervisor's already-in-flight run #2 — burning LLM tokens
  // for a result no one will see and racing draft writes against each
  // other in Java. Disable the button (and short-circuit the handler)
  // whenever a queued/running successor exists for this project.
  const activeWorkflow = useAppSelector((s) =>
    projectId ? s.assistant.projects[projectId]?.activeWorkflow : null
  );
  const hasInFlightSuccessor =
    !!activeWorkflow &&
    activeWorkflow.runId !== output.runId &&
    (activeWorkflow.status === "queued" || activeWorkflow.status === "running");
  useSyncActiveWorkflow(
    isActive,
    output.runId,
    output.workflowName,
    output.terminalStatus === "cancelled" ? "cancelled" : "failed"
  );

  if (!output.workflowName || !output.terminalStatus) return null;

  // Suppress orphan cancellation cards entirely when a successor for the
  // same project is already in flight. Real-world trigger: user clicks
  // "重新拆解" / similar, the supervisor cancels run #1 and immediately
  // dispatches run #2; the cancellation event for #1 lands in chat
  // history *after* the new "Start Workflow" message because both are
  // ordered by emit time. Visually it looks like run #2 was cancelled,
  // which is exactly the confusion users reported. The supervisor's
  // own narration ("已取消上一次任务，重新拆解") already explains the
  // hand-off, so dropping the dead-end card is lossless.
  //
  // Genuine `failed` cards are NEVER suppressed — those carry actionable
  // error info and the retryable / non-retryable affordances. Only
  // `cancelled` shadowed by a successor disappears.
  if (output.terminalStatus === "cancelled" && hasInFlightSuccessor) return null;

  const label = t(`workflowPhase.${output.terminalStatus}`);
  const workflowLabelText = t(WORKFLOW_LABEL_KEYS[output.workflowName] ?? "workflowGeneric");

  // Soft tone across both terminal-not-OK states. Stacked red cards
  // were noisy when stale runs piled up. Now: label + body sit at
  // muted-foreground (legible but not alarming), and a small icon
  // tint differentiates cancelled (gray) vs failed (amber) — enough
  // to distinguish at a glance without shouting. Error text stays at
  // foreground/85 so debugging copy is fully readable.
  const isCancelled = output.terminalStatus === "cancelled";
  const labelTone = "text-foreground/80";
  const bodyTone = "text-muted-foreground";
  const errorTextTone = "text-foreground/85";
  const iconTone = isCancelled ? "text-muted-foreground/60" : "text-amber-500/70";
  const copyBtnTone = "text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground/80";

  const handleRetry = () => {
    if (!projectId || !output.workflowName || !isActive) return;
    if (hasInFlightSuccessor) {
      // Defensive: should be impossible because the button is also
      // disabled in this state, but guard the dispatch path so a
      // double-click / stale state can't slip a duplicate run through.
      toast.info(t("workflowHintRetryHasSuccessor"));
      return;
    }
    void dispatch(
      startWorkflowFromButton({
        projectId,
        userLabel: t("workflowRetryLabel", { name: workflowLabelText }),
        workflowName: output.workflowName,
        inputData: buildInputData(output.workflowName, {
          projectId,
          worldId,
          targetEpisodeCount: typeof targetEpisodeCount === "number" ? targetEpisodeCount : null,
        }),
      })
    );
  };

  const copyError = async () => {
    if (!output.error) return;
    try {
      await navigator.clipboard.writeText(output.error);
      toast.success(tc("copied"));
    } catch {
      toast.error(tc("copyFailed"));
    }
  };

  return (
    <div className="w-full text-[13px]">
      <div className={cn("font-semibold", labelTone)}>{label}</div>
      <div
        className={cn("mt-1 flex items-start gap-1.5 text-[12px]", bodyTone)}
        title={output.error}
      >
        <IconAlertCircle className={cn("mt-0.5 size-3.5 shrink-0", iconTone)} />
        <span className={cn("flex-1", errorTextTone)}>{output.error || label}</span>
        {output.error && (
          <button
            type="button"
            onClick={copyError}
            className={cn("mt-0.5 shrink-0 rounded p-0.5", copyBtnTone)}
            title={tc("copyError")}
          >
            <IconCopy className="size-3" />
          </button>
        )}
      </div>
      {/* Soft next-step hint. Picks copy by terminal status + retryability:
          cancelled → "feel free to start again"; failed retryable → "click
          Retry below or send a new message"; failed non-retryable (e.g.
          schema validation) → "Retry won't help, please send a new
          message". Keeps the user moving forward instead of staring at
          a bare error string. */}
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
        {hasInFlightSuccessor
          ? t("workflowHintRetryHasSuccessor")
          : isCancelled
            ? t("workflowHintCancelled")
            : output.retryable
              ? t("workflowHintFailedRetryable")
              : t("workflowHintFailedNonRetryable")}
      </p>
      {output.retryable && (
        <div className="mt-3">
          <ActionButton
            variant="secondary"
            onClick={handleRetry}
            disabled={!projectId || !isActive || hasInFlightSuccessor}
            icon={<IconRefresh className="size-4" />}
          >
            {t("workflowActionRetry")}
          </ActionButton>
        </div>
      )}
    </div>
  );
}
