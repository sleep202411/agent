"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  IconAlertCircle,
  IconCheck,
  IconCopy,
  IconLoader2,
  IconMovie,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch, useAppSelector } from "@/src/store";
import {
  commitUserMessage,
  finalizeAssistantMessage,
  startWorkflowFromButton,
} from "@/src/store/slices/assistantSlice";
import {
  cancelWorkflow,
  confirmWorkflow,
  getWorkflowDrafts,
  getWorkflowStatus,
  isAwaitingUser,
  isErrorRetryable,
  isTerminal,
  workflowErrorLabelKey,
  type Draft,
  type ErrorClassification,
  type WorkflowEvent,
  type WorkflowName,
  type WorkflowProgress,
  type WorkflowStatus,
  type WorkflowStatusResponse,
} from "@/src/lib/workflow/workflow-client";
import { WorkflowEventsClient } from "@/src/lib/workflow/workflow-events-client";
import type { AssistantToolInvocation } from "@/src/lib/assistant/assistant-types";

// ─── Types ─────────────────────────────────────────────

interface InvokeWorkflowOutput {
  runId?: string;
  workflowName?: WorkflowName;
  message?: string;
}

interface ToolWorkflowCardProps {
  part: AssistantToolInvocation;
}

// ─── Display labels ────────────────────────────────────

const WORKFLOW_LABEL_KEYS: Record<WorkflowName, string> = {
  main_flow: "workflowMainFlow",
  role_design: "workflowRoleDesign",
  batch_create_asset: "workflowBatchCreate",
  script_edit: "workflowScriptEdit",
  story_outline: "workflowStoryOutline",
  role_phase: "workflowRolePhase",
  episode_phase: "workflowEpisodePhase",
  script_phase: "workflowScriptPhase",
  storyboard_phase: "workflowStoryboardPhase",
};

function groupDraftsByType(drafts: Draft[]): Record<string, Draft[]> {
  const grouped: Record<string, Draft[]> = {};
  for (const d of drafts) {
    if (d.status === "discarded" || d.status === "committed") continue;
    const key = d.entityType;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(d);
  }
  return grouped;
}

// ─── Component ─────────────────────────────────────────

export function ToolWorkflowCard({ part }: ToolWorkflowCardProps) {
  const t = useTranslations("ai");
  const dispatch = useAppDispatch();
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const worldId = useAppSelector((s) =>
    projectId ? (s.project.instances[projectId]?.worldId ?? null) : null
  );

  const output = (part.output as InvokeWorkflowOutput | undefined) ?? {};
  const runId = output.runId;
  const workflowName = output.workflowName;

  const [status, setStatus] = useState<WorkflowStatusResponse | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [actionBusy, setActionBusy] = useState<null | "accept" | "revise" | "cancel">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Once we've posted an in-chat failure notice for this runId, don't post it
  // again — the WS may re-surface the same terminal event on reconnect.
  const failureAnnouncedRef = useRef(false);
  // Tracks whether we've fetched drafts for the current suspension so we
  // don't spam /drafts on every heartbeat mismatch while the user sits on
  // the card. Cleared when status leaves "suspended".
  const draftsFetchedForSuspensionRef = useRef(false);
  // Latest status captured by ref for the WS onMismatch/heartbeat callbacks
  // (which close over a stable lambda and otherwise see stale state).
  const statusRef = useRef<WorkflowStatusResponse | null>(null);
  statusRef.current = status;

  // Event-driven status updates: seed with one REST fetch, then let the
  // WorkflowEventsGateway push the rest via WebSocket. Polling is gone.
  useEffect(() => {
    if (!runId || !projectId) return;
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const s = await getWorkflowStatus(runId, projectId);
        if (cancelled) return;
        setStatus(s);
        if (s.status === "suspended" && !draftsFetchedForSuspensionRef.current) {
          const d = await getWorkflowDrafts(runId, projectId);
          if (!cancelled) {
            setDrafts(d.drafts);
            draftsFetchedForSuspensionRef.current = true;
          }
        } else if (s.status !== "suspended") {
          draftsFetchedForSuspensionRef.current = false;
        }
        maybeAnnounceFailure(s);
      } catch {
        // Initial fetch failure is logged silently — heartbeat mismatch
        // will retry shortly.
      }
    };

    const maybeAnnounceFailure = (s: WorkflowStatusResponse) => {
      if (!isTerminal(s.status)) return;
      if (s.status !== "failed" && s.status !== "cancelled") return;
      if (failureAnnouncedRef.current) return;
      failureAnnouncedRef.current = true;
      const workflowLabelText = workflowName
        ? t(WORKFLOW_LABEL_KEYS[workflowName] ?? "workflowGeneric")
        : t("workflowGeneric");
      const reason = s.error ?? t(`workflowPhase.${s.status}`);
      const headline =
        s.status === "failed"
          ? t("workflowFailureAnnounce", { label: workflowLabelText, reason })
          : t("workflowCancelledAnnounce", { label: workflowLabelText });
      dispatch(
        finalizeAssistantMessage({
          projectId,
          message: {
            id: crypto.randomUUID(),
            role: "assistant",
            parts: [{ type: "text", text: headline, state: "done" }],
          },
        })
      );
    };

    const applyEvent = (ev: WorkflowEvent) => {
      const data = (ev.data ?? {}) as {
        stepId?: string;
        current?: number;
        total?: number;
        label?: string;
        error?: string;
      };
      setStatus((prev) => {
        const base: WorkflowStatusResponse = prev ?? {
          runId,
          workflowName: workflowName ?? ("main_flow" as WorkflowName),
          workspaceId: projectId,
          userId: "",
          status: "queued" as WorkflowStatus,
          startedAt: ev.timestamp,
          updatedAt: ev.timestamp,
        };
        const next: WorkflowStatusResponse = { ...base, updatedAt: ev.timestamp };
        switch (ev.type) {
          case "enqueued":
            next.status = "queued";
            break;
          case "started":
          case "resumed":
            next.status = "running";
            break;
          case "step.started":
            next.status = "running";
            if (data.stepId) next.currentStep = data.stepId;
            break;
          case "progress":
            next.status = next.status === "suspended" ? "suspended" : "running";
            if (data.stepId) next.currentStep = data.stepId;
            if (typeof data.current === "number" && typeof data.total === "number") {
              const progress: WorkflowProgress = {
                current: data.current,
                total: data.total,
                label: data.label,
              };
              next.progress = progress;
            }
            break;
          case "suspended":
            next.status = "suspended";
            break;
          case "completed":
            next.status = "completed";
            next.completedAt = ev.timestamp;
            break;
          case "failed":
            next.status = "failed";
            next.completedAt = ev.timestamp;
            if (data.error) next.error = data.error;
            break;
          case "cancelled":
            next.status = "cancelled";
            next.completedAt = ev.timestamp;
            break;
          default:
            // step.completed, step.failed, draft.* — surface progression
            // but don't override the higher-level status.
            break;
        }
        return next;
      });
      // React state updates are async; check the new phase via the event
      // itself rather than the yet-unupdated state.
      if (ev.type === "suspended" && !draftsFetchedForSuspensionRef.current) {
        void getWorkflowDrafts(runId, projectId)
          .then((d) => {
            if (cancelled) return;
            setDrafts(d.drafts);
            draftsFetchedForSuspensionRef.current = true;
          })
          .catch(() => {
            // ignore; mismatch will retry
          });
      } else if (
        ev.type === "resumed" ||
        ev.type === "completed" ||
        ev.type === "failed" ||
        ev.type === "cancelled"
      ) {
        draftsFetchedForSuspensionRef.current = false;
      }
      if (ev.type === "failed" || ev.type === "cancelled") {
        // Announce in chat. `data.error` may be absent; fall back to
        // generic phase label.
        maybeAnnounceFailure({
          ...(statusRef.current ?? ({} as WorkflowStatusResponse)),
          status: ev.type,
          error: data.error,
          runId,
          workflowName: workflowName ?? ("main_flow" as WorkflowName),
          workspaceId: projectId,
          userId: statusRef.current?.userId ?? "",
          startedAt: statusRef.current?.startedAt ?? ev.timestamp,
          updatedAt: ev.timestamp,
          completedAt: ev.timestamp,
        });
      }
    };

    void fetchStatus();

    const client = new WorkflowEventsClient({
      runId,
      projectId,
      onEvent: (ev) => {
        if (cancelled) return;
        applyEvent(ev);
      },
      onMismatch: () => {
        if (cancelled) return;
        void fetchStatus();
      },
      getLocalHashInputs: () => {
        const s = statusRef.current;
        if (!s) return null;
        return {
          status: s.status,
          currentStep: s.currentStep,
          progress: s.progress,
        };
      },
    });

    return () => {
      cancelled = true;
      client.destroy();
    };
  }, [runId, projectId, workflowName, t, dispatch]);

  if (!runId) {
    // Missing runId — show the tool-reported message verbatim as a fallback.
    return (
      <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
        {output.message ?? t("workflowMissingRunId")}
      </div>
    );
  }

  const workflowLabel = workflowName
    ? t(WORKFLOW_LABEL_KEYS[workflowName] ?? "workflowGeneric")
    : t("workflowGeneric");
  const phase = status?.status ?? "queued";
  const stepLabel = status?.currentStep;
  const progress = status?.progress;

  const postSyntheticUserMessage = (text: string) => {
    if (!projectId) return;
    // commitUserMessage flips sending=true (it's designed for the "user
    // typed → AI will reply" flow). Here we only want the text to appear
    // in the log — no AI stream will follow because confirm/cancel go
    // through a direct HTTP call, not the chat pipeline. Immediately
    // finalize with a null message to clear the "AI 正在回覆" indicator.
    dispatch(
      commitUserMessage({
        projectId,
        userMessage: {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text, state: "done" }],
        },
      })
    );
    dispatch(finalizeAssistantMessage({ projectId, message: null }));
  };

  const handleAccept = async () => {
    if (!runId || !projectId || actionBusy) return;
    setActionBusy("accept");
    setActionError(null);
    try {
      await confirmWorkflow(runId, projectId, { approved: true });
      postSyntheticUserMessage(t("workflowUserSatisfied"));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(null);
    }
  };

  const handleRevise = async () => {
    if (!runId || !projectId || actionBusy) return;
    const feedback = window.prompt(t("workflowReviseFeedbackPrompt"));
    if (!feedback || !feedback.trim()) return;
    setActionBusy("revise");
    setActionError(null);
    try {
      await confirmWorkflow(runId, projectId, { approved: false, feedback: feedback.trim() });
      postSyntheticUserMessage(`${t("workflowUserRequestedRevision")}：${feedback.trim()}`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(null);
    }
  };

  const handleCancel = async () => {
    if (!runId || !projectId || actionBusy) return;
    if (!window.confirm(t("workflowCancelConfirm"))) return;
    setActionBusy("cancel");
    setActionError(null);
    try {
      await cancelWorkflow(runId, projectId);
      postSyntheticUserMessage(t("workflowUserCancelled"));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(null);
    }
  };

  const accent = toneForPhase(phase);

  return (
    <div className={cn("rounded-xl border px-3 py-2.5 text-[13px]", accent.border, accent.bg)}>
      {/* Header row: workflow label + phase badge */}
      <div className="flex items-center gap-2">
        <PhaseIcon phase={phase} />
        <span className="font-medium">{workflowLabel}</span>
        <span className={cn("rounded-md px-1.5 py-0.5 text-[11px]", accent.badge)}>
          {t(`workflowPhase.${phase}`)}
        </span>
        {progress && progress.total > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {progress.current}/{progress.total}
            {progress.label ? ` · ${progress.label}` : ""}
          </span>
        )}
      </div>

      {/* Current step (when running) */}
      {stepLabel && !isTerminal(phase) && !isAwaitingUser(phase) && (
        <div className="mt-1.5 text-[12px] text-muted-foreground">
          {t("workflowCurrentStep")}：{stepLabel}
        </div>
      )}

      {/* Progress bar */}
      {progress && progress.total > 0 && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className={cn("h-full transition-all", accent.bar)}
            style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }}
          />
        </div>
      )}

      {/* Suspended: draft summary + HITL actions */}
      {isAwaitingUser(phase) && drafts && <DraftSummary drafts={drafts} t={t} />}

      {/* Completed: confirm prompt + 2-button closed loop (continue / revise) */}
      {phase === "completed" && workflowName && (
        <CompletedActions
          workflowName={workflowName}
          projectId={projectId}
          worldId={worldId}
          t={t}
        />
      )}

      {/* Failed / cancelled */}
      {(phase === "failed" || phase === "cancelled") && (
        <div className="mt-1.5 flex flex-col gap-2">
          <FailureMessage
            classification={status?.errorClassification}
            rawError={status?.error}
            phase={phase}
            t={t}
          />
          {workflowName && isErrorRetryable(status?.errorClassification) && (
            <button
              type="button"
              onClick={() => {
                if (!projectId) return;
                const workflowLabelText = t(WORKFLOW_LABEL_KEYS[workflowName] ?? "workflowGeneric");
                void dispatch(
                  startWorkflowFromButton({
                    projectId,
                    userLabel: `重试「${workflowLabelText}」`,
                    workflowName,
                    inputData: buildInputData(workflowName, { projectId, worldId }),
                  })
                );
              }}
              disabled={!projectId}
              className={cn(
                "mt-1 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-medium transition-colors",
                "bg-muted/60 text-foreground/90 hover:bg-muted disabled:opacity-50"
              )}
            >
              {t("workflowActionRetry")}
            </button>
          )}
        </div>
      )}

      {/* Action block — only when suspended (HITL) */}
      {isAwaitingUser(phase) && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="text-[13px] font-medium text-foreground/90">
            {t("workflowConfirmPrompt")}
          </div>

          <BlockButton
            variant="primary"
            onClick={handleAccept}
            disabled={actionBusy !== null}
            busy={actionBusy === "accept"}
            label={t("workflowActionAccept")}
          />
          <BlockButton
            variant="secondary"
            onClick={handleRevise}
            disabled={actionBusy !== null}
            busy={actionBusy === "revise"}
            label={t("workflowActionRevise")}
          />

          <div className="mt-0.5 text-[11px] text-muted-foreground">{t("workflowReviseHint")}</div>

          <button
            type="button"
            onClick={handleCancel}
            disabled={actionBusy !== null}
            className="mt-1 self-start text-[11px] text-muted-foreground/70 transition-colors hover:text-destructive disabled:opacity-50"
          >
            {actionBusy === "cancel" ? (
              <span className="inline-flex items-center gap-1">
                <IconLoader2 className="size-3 animate-spin" />
                {t("workflowActionCancel")}
              </span>
            ) : (
              t("workflowActionCancel")
            )}
          </button>
        </div>
      )}

      {actionError && <div className="mt-2 text-[11px] text-destructive/80">{actionError}</div>}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────

function DraftSummary({
  drafts,
  t,
}: {
  drafts: Draft[];
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const grouped = groupDraftsByType(drafts);
  const entries = Object.entries(grouped);
  if (entries.length === 0) {
    return (
      <div className="mt-2 text-[12px] text-muted-foreground">{t("workflowNoPendingDrafts")}</div>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {entries.map(([type, items]) => (
        <span
          key={type}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-foreground/80"
        >
          {t(`workflowEntity.${type}`)} × {items.length}
        </span>
      ))}
    </div>
  );
}

// ─── Block action button (HITL satisfied / revise) ─────

function BlockButton({
  variant,
  onClick,
  disabled,
  busy,
  label,
}: {
  variant: "primary" | "secondary";
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  label: string;
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
      {label}
    </button>
  );
}

// ─── Next-step chips (shown when workflow completes) ───

interface NextStep {
  key: string;
  labelKey: string;
  prompt: string;
  icon: ComponentType<{ className?: string }>;
  nextWorkflow: WorkflowName;
}

// Canonical follow-ups per workflow. Clicking dispatches a deterministic
// startWorkflowFromButton — we know exactly which phase is next, so we skip
// the supervisor LLM entirely (avoiding the mis-routing that happens when
// the LLM re-reads stale context).
const NEXT_STEPS: Partial<Record<WorkflowName, NextStep[]>> = {
  story_outline: [
    {
      key: "continueToRoles",
      labelKey: "workflowNextContinueToRoles",
      prompt: "基于刚才的故事骨架，继续设计主要角色。",
      icon: IconUsers,
      nextWorkflow: "role_phase",
    },
  ],
  role_design: [
    {
      key: "continueToEpisodes",
      labelKey: "workflowNextContinueToEpisodes",
      prompt: "基于这些角色，继续做分集大纲。",
      icon: IconMovie,
      nextWorkflow: "episode_phase",
    },
  ],
  role_phase: [
    {
      key: "continueToEpisodes",
      labelKey: "workflowNextContinueToEpisodes",
      prompt: "基于这些角色，继续做分集大纲。",
      icon: IconMovie,
      nextWorkflow: "episode_phase",
    },
  ],
  episode_phase: [
    {
      key: "continueToScripts",
      labelKey: "workflowNextContinueToScripts",
      prompt: "基于分集大纲，继续生成各集剧本。",
      icon: IconMovie,
      nextWorkflow: "script_phase",
    },
  ],
  script_phase: [
    {
      key: "continueToStoryboard",
      labelKey: "workflowNextContinueToStoryboard",
      prompt: "基于剧本，继续生成分镜。",
      icon: IconMovie,
      nextWorkflow: "storyboard_phase",
    },
  ],
  // storyboard_phase / main_flow — terminal, no "next step" chip.
};

// Default target episode count when the user jumps into episode_phase via a
// button. Users who want a different count should type a freeform message
// instead; the supervisor LLM handles that path.
const DEFAULT_TARGET_EPISODE_COUNT = 10;

function buildInputData(
  workflowName: WorkflowName,
  ctx: { projectId: string; worldId?: string | null },
  feedback?: string
): Record<string, unknown> {
  switch (workflowName) {
    case "role_phase":
      return {
        ...(ctx.worldId ? { worldId: ctx.worldId } : {}),
        ...(feedback ? { feedback } : {}),
      };
    case "episode_phase":
      return {
        projectId: ctx.projectId,
        targetEpisodeCount: DEFAULT_TARGET_EPISODE_COUNT,
        ...(feedback ? { feedback } : {}),
      };
    case "script_phase":
      return { projectId: ctx.projectId, ...(feedback ? { feedback } : {}) };
    case "storyboard_phase":
      return { projectId: ctx.projectId, ...(feedback ? { feedback } : {}) };
    default:
      return feedback ? { feedback } : {};
  }
}

function CompletedActions({
  workflowName,
  projectId,
  worldId,
  t,
}: {
  workflowName: WorkflowName;
  projectId: string | null;
  worldId: string | null;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const dispatch = useAppDispatch();
  const steps = NEXT_STEPS[workflowName];
  const hasNext = Boolean(steps && steps.length > 0);

  const primary = hasNext ? steps![0] : null;

  const handleContinue = () => {
    if (!projectId || !primary) return;
    void dispatch(
      startWorkflowFromButton({
        projectId,
        userLabel: t(primary.labelKey),
        workflowName: primary.nextWorkflow,
        inputData: buildInputData(primary.nextWorkflow, { projectId, worldId }),
      })
    );
  };

  const handleRevise = () => {
    if (!projectId) return;
    const feedback = window.prompt(t("workflowReviseFeedbackPrompt"));
    if (!feedback || !feedback.trim()) return;
    const workflowLabel = t(WORKFLOW_LABEL_KEYS[workflowName] ?? "workflowGeneric");
    void dispatch(
      startWorkflowFromButton({
        projectId,
        userLabel: `调整「${workflowLabel}」：${feedback.trim()}`,
        workflowName,
        inputData: buildInputData(workflowName, { projectId, worldId }, feedback.trim()),
      })
    );
  };

  return (
    <div className="mt-2.5 flex flex-col gap-2">
      <div className="text-[13px] font-medium text-foreground/90">
        {t("workflowCompletedPrompt")}
      </div>

      {primary && (
        <button
          type="button"
          onClick={handleContinue}
          disabled={!projectId}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-[13px] font-medium transition-colors",
            "bg-primary/15 text-primary-foreground hover:bg-primary/25 disabled:opacity-50"
          )}
        >
          <primary.icon className="size-4" />
          {t(primary.labelKey)}
        </button>
      )}

      <button
        type="button"
        onClick={handleRevise}
        disabled={!projectId}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-[13px] font-medium transition-colors",
          "bg-muted/60 text-foreground/90 hover:bg-muted disabled:opacity-50"
        )}
      >
        {t("workflowActionRevise")}
      </button>

      <div className="mt-0.5 text-[11px] text-muted-foreground">{t("workflowReviseHint")}</div>
    </div>
  );
}

/**
 * Friendly error surface for failed / cancelled workflows. Shows the
 * classified short label (e.g. "服务繁忙，请稍后重试") with the raw error
 * available via hover tooltip + copy button — mirrors the image-card
 * failure pattern.
 */
function FailureMessage({
  classification,
  rawError,
  phase,
  t,
}: {
  classification: ErrorClassification | undefined;
  rawError: string | undefined;
  phase: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const tc = useTranslations("common");
  const friendlyKey = workflowErrorLabelKey(classification);
  // For cancelled (not failed), fall back to the generic phase label
  // rather than the "unknown" error bucket.
  const friendlyText =
    phase === "cancelled"
      ? t("workflowPhase.cancelled")
      : (t(friendlyKey) ?? t("workflowPhase.failed"));

  return (
    <div
      className="flex items-start gap-1.5 text-[12px] text-destructive/80"
      title={rawError || undefined}
    >
      <IconAlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <span className="flex-1">{friendlyText}</span>
      {rawError && (
        <button
          type="button"
          title={tc("copyError")}
          onClick={async (e) => {
            e.stopPropagation();
            try {
              await navigator.clipboard.writeText(rawError);
              toast.success(tc("copied"));
            } catch {
              toast.error(tc("copyFailed"));
            }
          }}
          className="mt-0.5 shrink-0 rounded p-0.5 text-destructive/60 hover:bg-destructive/10 hover:text-destructive/80"
        >
          <IconCopy className="size-3" />
        </button>
      )}
    </div>
  );
}

function PhaseIcon({ phase }: { phase: string }) {
  if (phase === "completed") {
    return <IconCheck className="size-3.5 text-green-500" />;
  }
  if (phase === "failed" || phase === "cancelled") {
    return <IconX className="size-3.5 text-destructive/80" />;
  }
  if (phase === "suspended") {
    return <IconAlertCircle className="size-3.5 text-amber-400" />;
  }
  return <IconLoader2 className="size-3.5 animate-spin text-muted-foreground" />;
}

// ─── Tone mapping ──────────────────────────────────────

function toneForPhase(phase: string): {
  bg: string;
  border: string;
  badge: string;
  bar: string;
} {
  if (phase === "completed") {
    return {
      bg: "bg-green-500/5",
      border: "border-green-500/20",
      badge: "bg-green-500/15 text-green-300",
      bar: "bg-green-500/70",
    };
  }
  if (phase === "failed" || phase === "cancelled") {
    return {
      bg: "bg-destructive/5",
      border: "border-destructive/20",
      badge: "bg-destructive/15 text-destructive-foreground",
      bar: "bg-destructive/70",
    };
  }
  if (phase === "suspended") {
    return {
      bg: "bg-amber-500/5",
      border: "border-amber-500/25",
      badge: "bg-amber-500/15 text-amber-300",
      bar: "bg-amber-500/70",
    };
  }
  // queued / running
  return {
    bg: "bg-muted/30",
    border: "border-border/60",
    badge: "bg-white/5 text-muted-foreground",
    bar: "bg-primary/70",
  };
}
