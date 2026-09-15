"use client";

import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch, useAppSelector } from "@/src/store";
import {
  sendUserMessage,
  setForcedPersona,
  submitConfigureParams,
} from "@/src/store/slices/assistantSlice";
import { cn } from "@/lib/utils";
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
          key={toolCallId}
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
