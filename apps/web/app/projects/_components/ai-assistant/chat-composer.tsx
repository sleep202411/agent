"use client";

import { useState } from "react";
import { IconLoader2, IconPlayerStopFilled, IconX } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch, useAppSelector } from "@/src/store";
import { clearActiveWorkflow, setSelectedWorkflowChip } from "@/src/store/slices/assistantSlice";
import { cn } from "@/lib/utils";
import { cancelWorkflow } from "@/src/lib/workflow/workflow-client";
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
import { AttachmentList } from "./attachment-list";
import { TextEditor } from "./text-editor";
import { ChatToolbar } from "./chat-toolbar";
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
  editorRef: React.RefObject<HTMLDivElement | null>;
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
  // Only swap into the "working" pill when the workflow is actively running
  // or queued — if it's suspended (HITL), the user must interact with the
  // workflow card's draft-review UI, composer stays hidden behind toolCard
  // regardless. If it's terminal, composer goes back to normal.
  const workingPillVisible =
    !!activeWorkflow && (activeWorkflow.status === "queued" || activeWorkflow.status === "running");

  const toolCard = activePendingTool ? renderToolCard(activePendingTool, onToolResult) : null;

  if (workingPillVisible && activeWorkflow) {
    return (
      <div className="pb-2">
        <WorkingPill runId={activeWorkflow.runId} projectId={projectId} label={t("aiWorking")} />
        <p className="mt-2 text-center text-[11px] text-muted-foreground/50">{t("aiDisclaimer")}</p>
      </div>
    );
  }

  return (
    <div className="pb-2">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
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

            {/* Inline workflow prefix: when a chip is selected, show its
                label + "/" separator in primary color before the editor.
                The label isn't part of the contenteditable — it lives in
                Redux (`selectedWorkflowChip`) and is prepended as a
                `[[workflow:...]]` marker at send time. */}
            <WorkflowPrefix projectId={projectId} />

            <TextEditor
              projectId={projectId}
              hasPendingTools={hasPendingTools}
              editorRef={editorRef}
            />

            <ChatToolbar
              projectId={projectId}
              draftInput={draftInput}
              attachmentsCount={attachments.length}
              sending={sending}
              hasPendingTools={hasPendingTools}
              hasUploadingAttachments={hasUploadingAttachments}
              blocked={blocked}
            />

            {error ? <div className="mt-2 text-xs text-destructive">{error}</div> : null}
          </div>
        )}
      </div>

      {/* Workflow chips — click to select a workflow. The active chip
          lights up in primary; the chosen chip's label also appears as
          a colored prefix inside the composer. Hidden when a tool card
          is taking the composer's place. */}
      {toolCard ? null : <WorkflowChipRow projectId={projectId} editorRef={editorRef} />}

      <p className="mt-2 text-center text-[11px] text-muted-foreground/50">{t("aiDisclaimer")}</p>
    </div>
  );
}

// ─── Workflow chips ────────────────────────────────────

type WorkflowChip = {
  id: string;
  label: string;
  /** Tooltip — explain what the chip runs. */
  title: string;
};

const WORKFLOW_CHIPS: WorkflowChip[] = [
  {
    id: "main_flow",
    label: "完整流程",
    title: "从头跑一遍：角色 → 场景 → 剧集 → 剧本 → 分镜",
  },
  {
    id: "storyboard_phase",
    label: "重跑分镜",
    title: "整集重新生成分镜（会覆盖当前集的所有镜）",
  },
  {
    id: "scene_image_phase",
    label: "批量场景图",
    title: "为所有场景批量生成配图",
  },
  {
    id: "role_image_phase",
    label: "批量角色图",
    title: "为所有角色批量生成头像",
  },
];

function WorkflowPrefix({ projectId }: { projectId: string | null }) {
  const dispatch = useAppDispatch();
  const selectedId = useAppSelector((s) =>
    projectId ? (s.assistant.projects[projectId]?.selectedWorkflowChip ?? null) : null
  );
  if (!selectedId || !projectId) return null;
  const chip = WORKFLOW_CHIPS.find((c) => c.id === selectedId);
  if (!chip) return null;
  return (
    <div className="mb-1.5 flex items-center gap-1 text-sm leading-relaxed">
      <span className="font-medium text-primary">{chip.label}</span>
      <span className="text-primary/60">/</span>
      <button
        type="button"
        onClick={() => dispatch(setSelectedWorkflowChip({ projectId, chipId: null }))}
        title="取消"
        className="ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-primary/60 transition-colors hover:bg-primary/15 hover:text-primary"
      >
        <IconX className="size-2.5" />
      </button>
    </div>
  );
}

function WorkflowChipRow({
  projectId,
  editorRef,
}: {
  projectId: string | null;
  editorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const dispatch = useAppDispatch();
  const selectedId = useAppSelector((s) =>
    projectId ? (s.assistant.projects[projectId]?.selectedWorkflowChip ?? null) : null
  );

  const handleClick = (chip: WorkflowChip) => {
    if (!projectId) return;
    // Toggle: clicking the currently-selected chip clears it.
    const next = selectedId === chip.id ? null : chip.id;
    dispatch(setSelectedWorkflowChip({ projectId, chipId: next }));
    // Keep the editor focused so typing context continues naturally.
    editorRef.current?.focus();
  };

  return (
    <div role="toolbar" aria-label="快捷启动工作流" className="mt-2 flex flex-wrap gap-1.5 px-1">
      {WORKFLOW_CHIPS.map((chip) => {
        const active = selectedId === chip.id;
        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => handleClick(chip)}
            title={chip.title}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
              active
                ? "border-primary/50 bg-primary/15 text-primary shadow-[0_0_12px_rgba(244,114,182,0.25)]"
                : "border-border/60 bg-muted/40 text-muted-foreground hover:border-primary/40 hover:bg-muted hover:text-foreground"
            )}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Tool card renderer ────────────────────────────────

function renderToolCard(
  tool: ActivePendingTool,
  onToolResult?: (result: AssistantToolResult) => void
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
            options: f.options?.map((o) =>
              typeof o === "string" ? o : (o.label ?? String(o.value))
            ),
            min: f.min,
            max: f.max,
            suffix: f.suffix,
          }))}
          onSubmit={(values) => {
            // Include label map for human-readable result summary
            const labelMap = Object.fromEntries(data.fields.map((f) => [f.key, f.label]));
            onToolResult?.({
              toolCallId,
              toolName: "configure_params",
              output: { confirmed: true, values, _labelMap: labelMap },
            });
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
  runId,
  projectId,
  label,
}: {
  runId: string;
  projectId: string | null;
  label: string;
}) {
  const dispatch = useAppDispatch();
  const [stopping, setStopping] = useState(false);
  const handleStop = async () => {
    if (!projectId || stopping) return;
    setStopping(true);
    // Optimistic: swap the composer back to input immediately. The backend
    // publish of workflow_failed will follow asynchronously and also clear
    // via useSyncActiveWorkflow, but we don't want the user staring at a
    // spinner for the few hundred ms it takes to round-trip.
    dispatch(clearActiveWorkflow({ projectId, runId }));
    try {
      await cancelWorkflow(runId, projectId);
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
          title="停止"
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
