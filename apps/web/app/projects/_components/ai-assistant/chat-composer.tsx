"use client";

import { useMemo, useState } from "react";
import { IconLoader2, IconPlayerStopFilled } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch, useAppSelector } from "@/src/store";
import {
  clearActiveWorkflow,
  sendUserMessage,
  setForcedPersona,
  submitConfigureParams,
  cancelAllQueuedRuns,
  deriveQueuedRuns,
} from "@/src/store/slices/assistantSlice";
import { cn } from "@/lib/utils";
import { cancelWorkflow } from "@/src/lib/workflow/workflow-client";
import { useWorkflowHeartbeat } from "@/src/hooks/use-workflow-heartbeat";
import { useWorkflowCancelOnLeave } from "@/src/hooks/use-workflow-cancel-on-leave";
import { useWorkflowLiveness } from "@/src/hooks/use-workflow-liveness";
import type {
  AssistantAttachment,
  AssistantToolInvocation,
  AssistantToolResult,
  AssistantShowOptionsInput,
  AssistantShowOptionsResult,
  AssistantConfirmActionInput,
  AssistantConfirmActionResult,
  AssistantConfigureParamsInput,
  AssistantConfigureParamsResult,
} from "@/src/lib/assistant/assistant-types";
import { toast } from "sonner";
import { PERSONA_TONE_RING, getPersonaFromForcedKey } from "@/src/lib/assistant/personas";
import { AttachmentList } from "./attachment-list";
import { TextEditor, type TextEditorHandle } from "./text-editor";
import { ChatToolbar } from "./chat-toolbar";
import { ForcePersonaPills } from "./force-persona-pills";
import type { ForcedPersonaKey } from "@repo/shared";
import { ToolOptionsCard } from "./tool-cards/tool-options-card";
import { ToolConfirmCard } from "./tool-cards/tool-confirm-card";
import { ToolParamsCard } from "./tool-cards/tool-params-card";

// ─── Types ─────────────────────────────────────────────

export interface ActivePendingTool {
  toolName: string;
  toolCallId: string;
  part: AssistantToolInvocation;
}

interface ChatComposerProps {
  projectId: string | null;
  draftInput: string;
  attachments: AssistantAttachment[];
  sending: boolean;
  hasPendingTools: boolean;
  hasUploadingAttachments: boolean;
  error: string | null;
  editorRef: React.RefObject<TextEditorHandle | null>;
  activePendingTool?: ActivePendingTool | null;
  onToolResult?: (result: AssistantToolResult) => void;
  /** When true, disable send — project-params form gate is active upstream. */
  blocked?: boolean;
}

// ─── Component ─────────────────────────────────────────

export function ChatComposer({
  projectId,
  draftInput,
  attachments,
  sending,
  hasPendingTools,
  hasUploadingAttachments,
  error,
  editorRef,
  activePendingTool,
  onToolResult,
  blocked,
}: ChatComposerProps) {
  const t = useTranslations("ai");
  const activeWorkflow = useAppSelector((s) =>
    projectId ? s.assistant.projects[projectId]?.activeWorkflow : null
  );
  // Queue truth — derived from chat history, not Redux state. Chat queued
  // cards are intentionally not rendered (transient state shouldn't pollute
  // history); the pill is the single surface that exposes "you have N runs
  // waiting in line".
  //
  // Read messages off Redux (stable reference until the conversation actually
  // mutates), then derive the queued list with useMemo so the resulting
  // array's identity is stable across re-renders. A naive
  // `useAppSelector(s => deriveQueuedRuns(messages))` returns a fresh array
  // every call and trips React-Redux's "selector returned a different
  // result" warning — that warning manifested 2026-05-01 alongside flapping
  // chat-events WS (1006 closes), where excessive pill re-renders correlated
  // with effect-cleanup-driven WS reconnects.
  const messages = useAppSelector((s) =>
    projectId ? (s.assistant.projects[projectId]?.messages ?? null) : null
  );
  const queuedRuns = useMemo(() => deriveQueuedRuns(messages ?? []), [messages]);
  // Cross-check derived queued runIds against the agent's authoritative
  // status. Catches the case where chat history believes a run is still
  // queued (queued msg present, no follow-up failed/completed) but the
  // server has actually terminated it — typically a WS race that lost
  // the lifecycle event. Without this filter the pill sticks at "Queued
  // · N" forever; with it, the next 30s poll prunes the stale id.
  const aliveSet = useWorkflowLiveness(
    queuedRuns.map((r) => r.runId),
    projectId
  );
  const liveQueuedRuns = useMemo(
    () => queuedRuns.filter((r) => aliveSet.has(r.runId)),
    [queuedRuns, aliveSet]
  );
  const queuedCount = liveQueuedRuns.length;
  // Liveness signal for the agent's reaper: ping every 10s for EVERY
  // non-terminal run the user is currently watching, not just the
  // active one. The user can have N queued runs (pill = "排隊中 · N");
  // each has its own reaper deadline and needs its own heartbeat,
  // otherwise the queue silently shrinks 30s after dispatch.
  // Use `liveQueuedRuns` (already filtered by useWorkflowLiveness) so
  // we don't heartbeat ghost runs the server already finalized.
  const liveRunIds = useMemo(() => {
    const set = new Set<string>(liveQueuedRuns.map((r) => r.runId));
    if (
      activeWorkflow &&
      (activeWorkflow.status === "queued" ||
        activeWorkflow.status === "running" ||
        activeWorkflow.status === "suspended")
    ) {
      set.add(activeWorkflow.runId);
    }
    return [...set];
  }, [liveQueuedRuns, activeWorkflow]);
  useWorkflowHeartbeat(liveRunIds, projectId);
  useWorkflowCancelOnLeave(liveRunIds, projectId);
  // Show the working pill whenever EITHER:
  //   - an `activeWorkflow` is queued/running (running drives the
  //     "工作中" label, queued is rare since chat queued cards no longer
  //     mount the useSyncActiveWorkflow hook)
  //   - or `queuedCount > 0` (chat history has runs whose latest state is
  //     still queued — this is the new common path now that queued cards
  //     don't render and don't drive activeWorkflow)
  const workingPillVisible =
    (!!activeWorkflow &&
      (activeWorkflow.status === "queued" || activeWorkflow.status === "running")) ||
    queuedCount > 0;

  const dispatch = useAppDispatch();

  // Pinned designer for the next outgoing message — single source of
  // truth lives in the conversation slice so the thunk can stamp it
  // onto `metadata.forcedPersona` and clear it atomically. Reset is
  // baked into `sendUserMessage` (each turn = one intent).
  const forcedPersona = useAppSelector((s) =>
    projectId ? (s.assistant.projects[projectId]?.forcedPersona ?? null) : null
  );
  const updateForcedPersona = (next: ForcedPersonaKey | null) => {
    if (!projectId) return;
    dispatch(setForcedPersona({ projectId, forcedPersona: next }));
  };

  const handleSubmitConfigureParams = (toolCallId: string, values: Record<string, unknown>) => {
    if (!projectId) return;
    void dispatch(submitConfigureParams({ projectId, toolCallId, values }));
  };
  const toolCard = activePendingTool
    ? renderToolCard(activePendingTool, onToolResult, handleSubmitConfigureParams)
    : null;

  const handleSend = () => {
    if (!projectId) return;
    // The thunk reads `forcedPersona` from the slice, stamps it onto
    // the user message, then clears it. We don't need to clear here.
    void dispatch(sendUserMessage(projectId));
  };

  if (workingPillVisible) {
    // Three pill modes, in priority order:
    //   1. Active run is running         → "工作中..." + stop cancels just it
    //   2. Active run is queued OR no
    //      active and queue is non-empty → "排队中 · N" + stop cancels ALL queued
    //   3. (impossible — workingPillVisible guards against this)
    // The composer-style "running" stop targets one runId; the queued
    // stop targets the whole waiting list, which is what users actually
    // want when they pressed N retry buttons in a row and changed their
    // mind. The label includes the count so they don't have to count
    // chat cards (there are none anymore).
    const isRunning = activeWorkflow?.status === "running";
    const pillLabel = isRunning
      ? t("aiWorking")
      : queuedCount > 0
        ? `${t("workflowStateQueued")} · ${queuedCount}`
        : t("workflowStateQueued");
    const stopMode: "single" | "all-queued" = isRunning ? "single" : "all-queued";
    const stopRunId = isRunning ? activeWorkflow!.runId : null;
    return (
      <div className="pb-2">
        <WorkingPill mode={stopMode} runId={stopRunId} projectId={projectId} label={pillLabel} />
        <p className="mt-2 text-center text-[11px] text-muted-foreground/50">{t("aiDisclaimer")}</p>
      </div>
    );
  }

  const forcedTone = forcedPersona ? getPersonaFromForcedKey(forcedPersona).tone : null;

  return (
    <div className="pb-2">
      <div
        className={cn(
          "overflow-hidden rounded-2xl border bg-card transition-shadow",
          forcedTone ? PERSONA_TONE_RING[forcedTone] : "border-border"
        )}
      >
        {sending && (
          <div className="px-3 py-1.5 text-center text-xs text-muted-foreground">
            {t("aiReplying")}
          </div>
        )}

        {toolCard ? (
          <div className="bg-muted/90">{toolCard}</div>
        ) : (
          <div className="bg-muted/90 px-3 py-3 rounded-t-2xl">
            <AttachmentList projectId={projectId} attachments={attachments} />

            <TextEditor
              ref={editorRef}
              projectId={projectId}
              hasPendingTools={hasPendingTools}
              onSend={handleSend}
              forcedPersona={forcedPersona}
              onClearForcedPersona={() => updateForcedPersona(null)}
            />

            <div className="mt-2">
              <ForcePersonaPills
                value={forcedPersona}
                onChange={updateForcedPersona}
                disabled={sending || hasPendingTools}
              />
            </div>

            <ChatToolbar
              projectId={projectId}
              draftInput={draftInput}
              attachmentsCount={attachments.length}
              sending={sending}
              hasPendingTools={hasPendingTools}
              hasUploadingAttachments={hasUploadingAttachments}
              blocked={blocked}
              onSend={handleSend}
            />

            {error ? <div className="mt-2 text-xs text-destructive">{error}</div> : null}
          </div>
        )}
      </div>

      <p className="mt-2 px-2 text-center text-[10px] text-muted-foreground/50">
        {t("aiDisclaimer")}
      </p>
    </div>
  );
}

// ─── Tool card renderer ────────────────────────────────

function renderToolCard(
  tool: ActivePendingTool,
  onToolResult?: (result: AssistantToolResult) => void,
  onSubmitConfigureParams?: (toolCallId: string, values: Record<string, unknown>) => void
) {
  const { toolName, toolCallId, part } = tool;
  const input = part.input as Record<string, unknown> | undefined;
  if (!input) return null;

  switch (toolName) {
    case "show_options": {
      const data = input as unknown as AssistantShowOptionsInput;
      return (
        <ToolOptionsCard
          title={data.title}
          description={data.description}
          options={data.options}
          multiSelect={data.multiple}
          onSubmit={(selectedIds) => {
            onToolResult?.({
              toolCallId,
              toolName: "show_options",
              output: { selectedIds } satisfies AssistantShowOptionsResult,
            });
          }}
          onDismiss={() => {
            onToolResult?.({
              toolCallId,
              toolName: "show_options",
              output: { selectedIds: [] } satisfies AssistantShowOptionsResult,
            });
          }}
        />
      );
    }

    case "confirm_action": {
      const data = input as unknown as AssistantConfirmActionInput;
      return (
        <ToolConfirmCard
          title={data.title}
          description={data.description}
          confirmLabel={data.confirmLabel}
          cancelLabel={data.cancelLabel}
          onConfirm={() => {
            onToolResult?.({
              toolCallId,
              toolName: "confirm_action",
              output: { confirmed: true } satisfies AssistantConfirmActionResult,
            });
          }}
          onCancel={() => {
            onToolResult?.({
              toolCallId,
              toolName: "confirm_action",
              output: { confirmed: false } satisfies AssistantConfirmActionResult,
            });
          }}
        />
      );
    }

    case "require_project_params":
      // Rendered inline in MessageBubble (oii-style, part of chat history).
      // Do not duplicate here.
      return null;

    case "configure_params": {
      const data = input as unknown as AssistantConfigureParamsInput;
      return (
        <ToolParamsCard
          title={data.title}
          description={data.description}
          fields={data.fields.map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            value: f.defaultValue,
            // Preserve {label, value} so the card can submit the real
            // dictionary ID (not the display label). Legacy string options
            // are coerced {label: s, value: s}.
            options: f.options?.map((o) =>
              typeof o === "string"
                ? { label: o, value: o }
                : { label: o.label ?? String(o.value), value: String(o.value) }
            ),
            min: f.min,
            max: f.max,
            suffix: f.suffix,
          }))}
          onSubmit={(values) => {
            // Single atomic dispatch: closes the HITL tool, commits a
            // user message `Params set: {JSON}`, and submits ONCE to the
            // agent. Don't also call onToolResult here — applyToolResult
            // itself submits to the agent, which would duplicate the
            // request and spawn parallel workflow runs.
            onSubmitConfigureParams?.(toolCallId, values);
          }}
          onDismiss={() => {
            onToolResult?.({
              toolCallId,
              toolName: "configure_params",
              output: { confirmed: false } satisfies AssistantConfigureParamsResult,
            });
          }}
        />
      );
    }

    default:
      return null;
  }
}

// ─── Working pill (replaces composer while workflow is running) ───────

function WorkingPill({
  mode,
  runId,
  projectId,
  label,
}: {
  /**
   * - `single`: cancel only `runId` (the in-flight running run). Matches
   *   the legacy stop-pill behavior.
   * - `all-queued`: cancel every run whose latest lifecycle state is
   *   queued. Used when the pill represents the queue rather than an
   *   active run.
   */
  mode: "single" | "all-queued";
  /** Required when `mode === "single"`; ignored otherwise. */
  runId: string | null;
  projectId: string | null;
  label: string;
}) {
  const dispatch = useAppDispatch();
  const t = useTranslations("ai");
  const [stopping, setStopping] = useState(false);
  const handleStop = async () => {
    if (!projectId || stopping) return;
    setStopping(true);
    try {
      if (mode === "single" && runId) {
        // Optimistic: swap the composer back to input immediately. The
        // backend publish of workflow_failed will follow asynchronously
        // and also clear via useSyncActiveWorkflow, but we don't want
        // the user staring at a spinner for the few hundred ms it takes
        // to round-trip.
        dispatch(clearActiveWorkflow({ projectId, runId }));
        await cancelWorkflow(runId, projectId);
      } else {
        // Queue-mode stop. The thunk fires N parallel cancels (one per
        // queued runId) and each cancel publishes its own
        // workflow_failed(cancelled) so chat history stays consistent;
        // selectQueuedRuns naturally drops them as their latest state
        // flips to failed.
        await dispatch(cancelAllQueuedRuns({ projectId })).unwrap();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setStopping(false);
    }
  };
  return (
    <div className="flex justify-center py-2">
      <div
        className={cn(
          "flex items-center gap-2 rounded-full bg-muted/80 py-2.5 pl-4 pr-2",
          "text-[13px] text-foreground/80 shadow-lg"
        )}
      >
        <IconLoader2 className="size-3.5 animate-spin text-muted-foreground" />
        <span className="font-medium">{label}</span>
        <button
          type="button"
          onClick={handleStop}
          disabled={stopping}
          title={t("composerStopButton")}
          className={cn(
            "ml-1 flex size-7 shrink-0 items-center justify-center rounded-full",
            "bg-background/80 text-foreground/70 transition-colors hover:bg-background disabled:opacity-50"
          )}
        >
          {stopping ? (
            <IconLoader2 className="size-3.5 animate-spin" />
          ) : (
            <IconPlayerStopFilled className="size-3" />
          )}
        </button>
      </div>
    </div>
  );
}
