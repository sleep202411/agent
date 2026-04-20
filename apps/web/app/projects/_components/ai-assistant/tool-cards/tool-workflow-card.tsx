"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  IconAlertCircle,
  IconBook,
  IconBuildingStore,
  IconCamera,
  IconCopy,
  IconLayoutList,
  IconLoader2,
  IconMovie,
  IconPackage,
  IconPencil,
  IconPhoto,
  IconSparkles,
  IconUsers,
} from "@tabler/icons-react";
import type { Icon } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch, useAppSelector } from "@/src/store";
import {
  clearActiveWorkflow,
  commitUserMessage,
  confirmWorkflowFromButton,
  finalizeAssistantMessage,
  setActiveWorkflow,
  startWorkflowFromButton,
} from "@/src/store/slices/assistantSlice";
import {
  cancelWorkflow,
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
import { loadEpisodeCount } from "./project-params-form";
import type { AssistantToolInvocation } from "@/src/lib/assistant/assistant-types";

// ─── Types ─────────────────────────────────────────────

interface InvokeWorkflowOutput {
  runId?: string;
  workflowName?: WorkflowName;
  message?: string;
  /**
   * Set by the agent's preflight guard when project params aren't complete
   * (see apps/agent/src/mastra/tools/meta/invoke-workflow.ts). In this case
   * supervisor will follow up with `require_project_params`, so the card
   * has nothing to render — we hide it rather than showing the LLM-facing
   * technical text.
   */
  error?: string;
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
  role_image_phase: "workflowRoleImagePhase",
  scene_phase: "workflowScenePhase",
  scene_image_phase: "workflowSceneImagePhase",
  prop_phase: "workflowPropPhase",
  prop_image_phase: "workflowPropImagePhase",
  episode_phase: "workflowEpisodePhase",
  script_phase: "workflowScriptPhase",
  storyboard_phase: "workflowStoryboardPhase",
};

interface WorkflowPersona {
  name: string;
  /** Tabler icon component — shown next to the persona name. */
  icon: Icon;
}

const WORKFLOW_PERSONA: Record<WorkflowName, WorkflowPersona> = {
  main_flow: { name: "创作总监", icon: IconSparkles },
  story_outline: { name: "剧本统筹", icon: IconBook },
  role_design: { name: "角色设计师", icon: IconUsers },
  role_phase: { name: "角色设计师", icon: IconUsers },
  role_image_phase: { name: "角色设计师", icon: IconPhoto },
  scene_phase: { name: "场景设计师", icon: IconBuildingStore },
  scene_image_phase: { name: "场景设计师", icon: IconPhoto },
  prop_phase: { name: "道具设计师", icon: IconPackage },
  prop_image_phase: { name: "道具设计师", icon: IconPhoto },
  episode_phase: { name: "剧集规划师", icon: IconLayoutList },
  script_phase: { name: "编剧", icon: IconPencil },
  storyboard_phase: { name: "分镜师", icon: IconCamera },
  batch_create_asset: { name: "资产录入", icon: IconPackage },
  script_edit: { name: "编剧", icon: IconPencil },
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
  const targetEpisodeCount = useAppSelector((s) => {
    const fromDetail = projectId
      ? s.project.instances[projectId]?.detail?.targetEpisodeCount
      : undefined;
    if (typeof fromDetail === "number" && fromDetail > 0) return fromDetail;
    return projectId ? loadEpisodeCount(projectId) : undefined;
  });

  const output = (part.output as InvokeWorkflowOutput | undefined) ?? {};
  const runId = output.runId;
  const workflowName = output.workflowName;

  const [status, setStatus] = useState<WorkflowStatusResponse | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [narration, setNarration] = useState<Array<{ id: string; text: string }>>([]);
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

  // Mirror the card's workflow status up to Redux so the ChatComposer
  // can swap to a "工作中 + 停止" pill while the workflow is in flight.
  // Cleared on terminal status in the same effect.
  useEffect(() => {
    if (!runId || !projectId || !workflowName) return;
    const s = status?.status;
    if (s === "queued" || s === "running" || s === "suspended") {
      dispatch(setActiveWorkflow({ projectId, runId, workflowName, status: s }));
    } else if (s === "completed" || s === "failed" || s === "cancelled") {
      dispatch(clearActiveWorkflow({ projectId, runId }));
    }
  }, [dispatch, projectId, runId, workflowName, status?.status]);

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
        if (s.recentEvents) {
          const narrates = s.recentEvents
            .filter((e) => e.type === "narrate")
            .map((e) => {
              const d = e.data as { text?: string } | undefined;
              return d?.text ? { id: e.id ?? String(e.timestamp), text: d.text } : null;
            })
            .filter((n): n is { id: string; text: string } => n !== null);
          if (narrates.length > 0) {
            setNarration((prev) => {
              const seen = new Set(prev.map((n) => n.text));
              const additions = narrates.filter((n) => !seen.has(n.text));
              return additions.length ? [...prev, ...additions] : prev;
            });
          }
        }
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
      // Narrate events are persona-voiced status updates the workflow emits
      // to keep the user company while it runs. Accumulate and let the card
      // render them as a bullet list.
      if (ev.type === "narrate") {
        const d = ev.data as { text?: string } | undefined;
        if (d?.text) {
          const text = d.text;
          setNarration((prev) =>
            prev.some((n) => n.id === ev.id || n.text === text)
              ? prev
              : [...prev, { id: ev.id ?? `${ev.timestamp}-${prev.length}`, text }]
          );
        }
        return;
      }
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
      if (ev.type === "completed") {
        // WS completion events only carry status phase — fetch once more
        // to pull `meta.result` (章节/角色/场景 structured data) so the
        // WorkflowResultPanel can render without needing a page refresh.
        void fetchStatus();
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
    // Preflight reject (e.g. PROJECT_PARAMS_INCOMPLETE) has no runId — hide
    // the card entirely; supervisor's follow-up require_project_params call
    // will render the form.
    if (output.error) return null;
    // Missing runId with no declared error — show the tool-reported message
    // verbatim as a fallback.
    return (
      <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
        {output.message ?? t("workflowMissingRunId")}
      </div>
    );
  }

  const phase = status?.status ?? "queued";
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
      // Step 1: commit drafts via resume_workflow — always needed so the
      // suspended run finishes and writes to Java.
      await dispatch(
        confirmWorkflowFromButton({
          projectId,
          runId,
          userLabel: t("workflowUserSatisfied"),
          approved: true,
        })
      );
      // Step 2: if the canonical NEXT_STEPS says there's a follow-up phase,
      // chain straight into it so the user doesn't have to scroll back up
      // and click a "继续·xxx" button. The old workflow card stays frozen
      // as a historical record; the new phase shows up as a fresh
      // assistant message below — linear, no in-place mutation.
      if (workflowName) {
        const nextSteps = NEXT_STEPS[workflowName];
        const nextStep = nextSteps && nextSteps.length > 0 ? nextSteps[0] : null;
        if (nextStep) {
          await dispatch(
            startWorkflowFromButton({
              projectId,
              userLabel: t(nextStep.labelKey),
              workflowName: nextStep.nextWorkflow,
              inputData: buildInputData(nextStep.nextWorkflow, {
                projectId,
                worldId,
                targetEpisodeCount,
              }),
            })
          );
        }
      }
      void pollStatusUntilAdvanced();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(null);
    }
  };

  /**
   * After confirm/revise, poll the status a handful of times to catch the
   * case where WS missed the "resumed → completed" transition. Bails as
   * soon as the card's phase changes away from "suspended".
   */
  const pollStatusUntilAdvanced = async () => {
    if (!runId || !projectId) return;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 700));
      try {
        const s = await getWorkflowStatus(runId, projectId);
        setStatus(s);
        if (s.status !== "suspended") return;
      } catch {
        // transient; next iteration will retry
      }
    }
  };

  const handleRevise = async () => {
    if (!runId || !projectId || actionBusy) return;
    const feedback = window.prompt(t("workflowReviseFeedbackPrompt"));
    if (!feedback || !feedback.trim()) return;
    setActionBusy("revise");
    setActionError(null);
    try {
      await dispatch(
        confirmWorkflowFromButton({
          projectId,
          runId,
          userLabel: `${t("workflowUserRequestedRevision")}：${feedback.trim()}`,
          approved: false,
          feedback: feedback.trim(),
        })
      );
      void pollStatusUntilAdvanced();
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
  const persona = workflowName ? WORKFLOW_PERSONA[workflowName] : null;
  const stateLabelKey = phase === "completed" ? "workflowStateDone" : "workflowStateRunning";

  return (
    <div className="text-[13px]">
      {/* Persona pill — mirrors oii's persona header; hidden for unknown
          workflows / terminal-error states. */}
      {persona && phase !== "failed" && phase !== "cancelled" && <PersonaPill persona={persona} />}

      {/* State + progress row: state label + optional count/label on right */}
      <div className="mt-2 flex items-center gap-2">
        <span className="font-semibold text-foreground/90">
          {phase === "failed" || phase === "cancelled"
            ? t(`workflowPhase.${phase}`)
            : t(stateLabelKey)}
        </span>
        {progress && progress.total > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {progress.current}/{progress.total}
            {progress.label ? ` · ${progress.label}` : ""}
          </span>
        )}
      </div>

      {/* Persona narration — accumulated bullets from the workflow's
          narrate events. Shows while running and stays as history after
          completion (alongside the structured result panel below). */}
      {narration.length > 0 && <NarrationList items={narration} running={!isTerminal(phase)} />}

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

      {/* Completed: structured result summary + confirm/revise buttons */}
      {phase === "completed" && workflowName && (
        <>
          {status?.result ? (
            <WorkflowResultPanel workflowName={workflowName} result={status.result} t={t} />
          ) : null}
          <CompletedActions
            workflowName={workflowName}
            projectId={projectId}
            worldId={worldId}
            targetEpisodeCount={targetEpisodeCount}
            t={t}
          />
        </>
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
                    inputData: buildInputData(workflowName, {
                      projectId,
                      worldId,
                      targetEpisodeCount,
                    }),
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

function PersonaPill({ persona }: { persona: WorkflowPersona }) {
  const Icon = persona.icon;
  return (
    <div className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground/80">
      <Icon className="size-3.5 text-muted-foreground" />
      <span>{persona.name}</span>
    </div>
  );
}

function NarrationList({
  items,
  running,
}: {
  items: Array<{ id: string; text: string }>;
  running: boolean;
}) {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed text-foreground/85">
      {items.map((n) => (
        <li key={n.id}>{n.text}</li>
      ))}
      {running && (
        <li className="list-none">
          <span className="inline-flex gap-0.5">
            <span className="size-1 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
            <span className="size-1 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
            <span className="size-1 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
          </span>
        </li>
      )}
    </ul>
  );
}

/**
 * Inline summary of a completed workflow's output. Replaces the old
 * supervisor-driven post-completion recap — the workflow's own result
 * payload is shape-specific per workflow, and we render it directly so
 * the user can review content before confirming.
 */
function WorkflowResultPanel({
  workflowName,
  result,
  t,
}: {
  workflowName: WorkflowName;
  result: unknown;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  if (workflowName === "story_outline" || workflowName === "main_flow") {
    return <StoryOutlineResult result={result} t={t} />;
  }
  return null;
}

interface StoryOutlineResultShape {
  storySummary?: string;
  genre?: string;
  tone?: string;
  structure?: Array<{ chapterId?: string; title?: string; summary?: string }>;
  cast?: Array<{ name?: string; role?: string; arc?: string }>;
  settings?: Array<{ name?: string; typeHint?: string }>;
  threads?: { main?: string; subs?: Array<{ name?: string; description?: string }> };
}

function StoryOutlineResult({
  result,
  t,
}: {
  result: unknown;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const data = result as StoryOutlineResultShape | null;
  if (!data || !data.structure) return null;
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border/40 bg-white/2 p-3">
      {data.storySummary && (
        <div>
          <ResultHeading>{t("workflowResultStorySummary")}</ResultHeading>
          <p className="text-[12px] leading-relaxed text-foreground/80">{data.storySummary}</p>
        </div>
      )}
      {data.structure.length > 0 && (
        <div>
          <ResultHeading>
            {t("workflowResultChapters", { count: data.structure.length })}
          </ResultHeading>
          <ol className="space-y-1 text-[12px] leading-relaxed">
            {data.structure.map((ch, i) => (
              <li key={ch.chapterId ?? i} className="flex gap-1.5">
                <span className="shrink-0 text-muted-foreground">{i + 1}.</span>
                <span>
                  <span className="font-medium text-foreground/90">{ch.title}</span>
                  {ch.summary ? <span className="text-foreground/60"> — {ch.summary}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {data.cast && data.cast.length > 0 && (
        <div>
          <ResultHeading>{t("workflowResultCast", { count: data.cast.length })}</ResultHeading>
          <ul className="space-y-0.5 text-[12px] leading-relaxed">
            {data.cast.map((c, i) => (
              <li key={c.name ?? i}>
                <span className="font-medium text-foreground/90">{c.name}</span>
                {c.role ? <span className="text-foreground/60"> · {c.role}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.settings && data.settings.length > 0 && (
        <div>
          <ResultHeading>
            {t("workflowResultSettings", { count: data.settings.length })}
          </ResultHeading>
          <ul className="flex flex-wrap gap-x-2 gap-y-0.5 text-[12px] leading-relaxed text-foreground/80">
            {data.settings.map((s, i) => (
              <li key={s.name ?? i}>{s.name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ResultHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  );
}

/**
 * Best-effort extract of a short preview string from an arbitrary draft.
 * Role/scene/prop drafts have name + description; episode has title +
 * introduction; script/storyboard varies. We normalize to {title, detail}
 * so the UI can render every entity type with the same card.
 */
function draftPreview(draft: Draft): { title: string; detail?: string } {
  const d = (draft.data ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = d[k];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
    return undefined;
  };
  const title = pick("name", "title", "roleName", "sceneName", "propName") ?? "—";
  const detail = pick("description", "introduction", "intro", "summary", "prompt");
  return { title, detail };
}

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
    <div className="mt-3 flex flex-col gap-3">
      {entries.map(([type, items]) => (
        <div key={type} className="flex flex-col gap-1.5">
          <div className="text-[12px] font-medium text-foreground/70">
            {t(`workflowEntity.${type}`)} · {items.length}
          </div>
          <div className="flex flex-col gap-1">
            {items.map((d) => {
              const { title, detail } = draftPreview(d);
              return (
                <div
                  key={d.clientRefId}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                >
                  <div className="text-[13px] font-medium text-foreground/90">{title}</div>
                  {detail ? (
                    <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">
                      {detail}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
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
      key: "continueToRoleImages",
      labelKey: "workflowNextContinueToRoleImages",
      prompt: "为这些角色生成主图。",
      icon: IconPhoto,
      nextWorkflow: "role_image_phase",
    },
  ],
  role_phase: [
    {
      key: "continueToRoleImages",
      labelKey: "workflowNextContinueToRoleImages",
      prompt: "为这些角色生成主图。",
      icon: IconPhoto,
      nextWorkflow: "role_image_phase",
    },
  ],
  role_image_phase: [
    {
      key: "continueToScenes",
      labelKey: "workflowNextContinueToScenes",
      prompt: "基于故事骨架继续设计场景。",
      icon: IconBuildingStore,
      nextWorkflow: "scene_phase",
    },
  ],
  scene_phase: [
    {
      key: "continueToSceneImages",
      labelKey: "workflowNextContinueToSceneImages",
      prompt: "为这些场景生成参考图。",
      icon: IconPhoto,
      nextWorkflow: "scene_image_phase",
    },
  ],
  scene_image_phase: [
    {
      key: "continueToProps",
      labelKey: "workflowNextContinueToProps",
      prompt: "基于故事骨架继续设计道具。",
      icon: IconPackage,
      nextWorkflow: "prop_phase",
    },
  ],
  prop_phase: [
    {
      key: "continueToPropImages",
      labelKey: "workflowNextContinueToPropImages",
      prompt: "为这些道具生成参考图。",
      icon: IconPhoto,
      nextWorkflow: "prop_image_phase",
    },
  ],
  prop_image_phase: [
    {
      key: "continueToEpisodes",
      labelKey: "workflowNextContinueToEpisodes",
      prompt: "基于这些设定，继续做分集大纲。",
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
// button AND the ProjectParamsForm value (client-side) isn't available
// (e.g. cleared localStorage + no Redux state). Normally overridden by the
// value the user picked in the form.
const DEFAULT_TARGET_EPISODE_COUNT = 10;

function buildInputData(
  workflowName: WorkflowName,
  ctx: { projectId: string; worldId?: string | null; targetEpisodeCount?: number | null },
  feedback?: string
): Record<string, unknown> {
  switch (workflowName) {
    case "role_phase":
    case "scene_phase":
    case "prop_phase":
      return {
        ...(ctx.worldId ? { worldId: ctx.worldId } : {}),
        ...(feedback ? { feedback } : {}),
      };
    case "role_image_phase":
    case "scene_image_phase":
    case "prop_image_phase":
      // No required inputs — workflow reads committed entries from Java.
      return feedback ? { feedback } : {};
    case "episode_phase":
      return {
        projectId: ctx.projectId,
        targetEpisodeCount:
          typeof ctx.targetEpisodeCount === "number" && ctx.targetEpisodeCount > 0
            ? ctx.targetEpisodeCount
            : DEFAULT_TARGET_EPISODE_COUNT,
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
  targetEpisodeCount,
  t,
}: {
  workflowName: WorkflowName;
  projectId: string | null;
  worldId: string | null;
  targetEpisodeCount: number | undefined;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const dispatch = useAppDispatch();
  const steps = NEXT_STEPS[workflowName];
  const hasNext = Boolean(steps && steps.length > 0);

  const primary = hasNext ? steps![0] : null;
  const ctx = { projectId: projectId ?? "", worldId, targetEpisodeCount };

  const handleContinue = () => {
    if (!projectId || !primary) return;
    void dispatch(
      startWorkflowFromButton({
        projectId,
        userLabel: t(primary.labelKey),
        workflowName: primary.nextWorkflow,
        inputData: buildInputData(primary.nextWorkflow, ctx),
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
        inputData: buildInputData(workflowName, ctx, feedback.trim()),
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
