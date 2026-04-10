import { useTranslations } from "@/src/i18n/i18n";
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
import { AssistantTaskCard } from "./tool-cards/tool-task-card";

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
  selectedAgent: string;
  error: string | null;
  editorRef: React.RefObject<HTMLDivElement | null>;
  activePendingTool?: ActivePendingTool | null;
  activeTask?: { taskId: string; toolName: string } | null;
  onTaskContinue?: (taskId: string, result: unknown) => void;
  onToolResult?: (result: AssistantToolResult) => void;
}

// ─── Component ─────────────────────────────────────────

export function ChatComposer({
  projectId,
  draftInput,
  attachments,
  sending,
  hasPendingTools,
  hasUploadingAttachments,
  selectedAgent,
  error,
  editorRef,
  activePendingTool,
  activeTask,
  onTaskContinue,
  onToolResult,
}: ChatComposerProps) {
  const t = useTranslations("ai");

  const toolCard = activePendingTool ? renderToolCard(activePendingTool, onToolResult) : null;

  const taskCard = activeTask ? (
    <AssistantTaskCard
      taskId={activeTask.taskId}
      onContinue={(result) => onTaskContinue?.(activeTask.taskId, result)}
      onError={(err) => toast.error(err)}
    />
  ) : null;

  return (
    <div className="pb-2">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {sending && (
          <div className="px-3 py-1.5 text-center text-xs text-muted-foreground">
            {t("aiReplying")}
          </div>
        )}

        {taskCard ? (
          <div className="bg-muted/90 px-3 py-3">{taskCard}</div>
        ) : toolCard ? (
          <div className="bg-muted/90">{toolCard}</div>
        ) : (
          <div className="bg-muted/90 px-3 py-3 rounded-t-2xl">
            <AttachmentList projectId={projectId} attachments={attachments} />

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
              selectedAgent={selectedAgent}
            />

            {error ? <div className="mt-2 text-xs text-destructive">{error}</div> : null}
          </div>
        )}
      </div>

      <p className="mt-2 text-center text-[11px] text-muted-foreground/50">{t("aiDisclaimer")}</p>
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
