import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowDown, IconSparkles } from "@tabler/icons-react";
import { BorderGlow } from "@/components/ui/border-glow";
import { useTranslations } from "@/src/i18n/i18n";
import { PanelLayout } from "@/components/project/panels/panel-layout";
import {
  getAssistantToolName,
  isAssistantToolPart,
  type AssistantAttachment,
  type AssistantMessage,
  type AssistantToolInvocation,
  type AssistantToolResult,
  type PendingAssistantToolUi,
} from "@/src/lib/assistant/assistant-types";
import { useAppSelector, useAppDispatch } from "@/src/store";
import {
  ensureProject,
  setDraft,
  sendUserMessage,
  applyToolResult,
} from "@/src/store/slices/assistantSlice";

import { quickActionsByAgent } from "./constants";
import { MessageBubble, PIPELINE_TOOL_NAMES } from "./message-bubble";
import { ChatComposer } from "./chat-composer";
import { useAutoScroll } from "./use-auto-scroll";

// ─── Empty defaults ────────────────────────────────────

const EMPTY_MESSAGES: AssistantMessage[] = [];
const EMPTY_ATTACHMENTS: AssistantAttachment[] = [];
const EMPTY_PENDING_TOOLS: PendingAssistantToolUi[] = [];

// ─── Main Panel ────────────────────────────────────────

interface AiAssistantPanelProps {
  onClose: () => void;
}

export function AiAssistantPanel({ onClose }: AiAssistantPanelProps) {
  const t = useTranslations("ai");
  const dispatch = useAppDispatch();
  const projectId = useAppSelector((state) => state.project.currentProjectId);

  const conversation = useAppSelector((state) =>
    projectId ? state.assistant.projects[projectId] : undefined
  );

  const messagesRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const selectedAgent = conversation?.agentType ?? "general";

  useEffect(() => {
    if (projectId) {
      dispatch(ensureProject(projectId));
    }
  }, [dispatch, projectId]);

  const messages = conversation?.messages ?? EMPTY_MESSAGES;
  const draftInput = conversation?.draftInput ?? "";
  const attachments = conversation?.attachments ?? EMPTY_ATTACHMENTS;
  const sending = conversation?.sending ?? false;
  const pendingToolUi = conversation?.pendingToolUi ?? EMPTY_PENDING_TOOLS;
  const submittingToolCallId = conversation?.submittingToolCallId ?? null;
  const error = conversation?.error ?? null;

  useEffect(() => {
    if (!draftInput && editorRef.current && editorRef.current.innerText.trim()) {
      editorRef.current.innerText = "";
    }
  }, [draftInput]);

  const hasPendingTools = pendingToolUi.length > 0;

  // Find the actual tool part for the first pending tool (to pass full input data to composer)
  const activePendingTool = useMemo(() => {
    if (pendingToolUi.length === 0) return null;
    const pending = pendingToolUi[0];
    for (const message of messages) {
      for (const part of message.parts) {
        if (isAssistantToolPart(part) && part.toolCallId === pending.toolCallId) {
          return {
            toolName: getAssistantToolName(part),
            toolCallId: pending.toolCallId,
            part: part as AssistantToolInvocation,
          };
        }
      }
    }
    return null;
  }, [pendingToolUi, messages]);
  // Track which task IDs have been "continued" so we stop showing their card
  const [continuedTaskIds, setContinuedTaskIds] = useState<Set<string>>(new Set());

  // Find the latest pipeline tool output that has a taskId (for composer task card)
  const activeTask = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== "assistant") continue;
      for (let j = msg.parts.length - 1; j >= 0; j--) {
        const part = msg.parts[j];
        if (!isAssistantToolPart(part)) continue;
        const toolName = getAssistantToolName(part);
        if (!PIPELINE_TOOL_NAMES.has(toolName)) continue;
        if (part.state !== "output-available" && part.state !== "output-error") continue;
        const rawOutput = part.output ?? (part as unknown as Record<string, unknown>).result;
        const output = rawOutput as Record<string, unknown> | undefined;
        const taskId = output?.taskId ? String(output.taskId) : null;
        if (taskId && !continuedTaskIds.has(taskId)) {
          return { taskId, toolName };
        }
      }
    }
    return null;
  }, [messages, continuedTaskIds]);

  const hasMeaningfulMessages = messages.length > 1;
  const hasUploadingAttachments = attachments.some((a) => a.status === "uploading");

  const renderedMessages = useMemo(() => messages, [messages]);

  // Coarse streaming length — bucketized so we don't trigger scroll on every token
  // Changes roughly every ~80 chars, enough to keep up without thrashing
  const streamingBucket = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return 0;
    let len = 0;
    for (const part of last.parts) {
      if (part.type === "text" && part.state === "streaming") {
        len += part.text.length;
      }
    }
    return Math.floor(len / 80);
  }, [messages]);

  const { isAtBottom, scrollToBottom } = useAutoScroll({
    containerRef: messagesRef,
    triggers: [messages.length, sending, streamingBucket],
  });

  const handleTaskContinue = useCallback(
    (taskId: string, result: unknown) => {
      if (!projectId) return;
      setContinuedTaskIds((prev) => new Set(prev).add(taskId));
      const r = result as Record<string, unknown> | undefined;
      const sid = r?.sessionId ?? "";
      const text = `Analysis complete. sessionId=${sid}. Characters: ${r?.characters ?? 0}, Locations: ${r?.locations ?? 0}, Outline sections: ${r?.outlineSections ?? 0}. Please continue to the next step.`;
      if (editorRef.current) editorRef.current.innerText = text;
      dispatch(setDraft({ projectId, draft: text }));
      setTimeout(() => {
        if (projectId) void dispatch(sendUserMessage(projectId));
      }, 300);
    },
    [projectId, dispatch]
  );

  return (
    <PanelLayout
      icon={
        <div className="flex size-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <IconSparkles className="size-4" />
        </div>
      }
      title={t("title")}
      description={t("panelDescription")}
      actions={null}
      onClose={onClose}
      footer={null}
    >
      <div className="flex h-full flex-col relative">
        {/* Messages area — extra bottom padding so content scrolls behind composer */}
        <div ref={messagesRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-6">
          {/* Welcome + quick actions */}
          {!hasMeaningfulMessages ? (
            <div className="space-y-3">
              <div className="px-1 text-center mb-6">
                <p className="text-sm font-medium">{t("greeting")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("greetingHint")}</p>
              </div>
              {(quickActionsByAgent[selectedAgent] ?? quickActionsByAgent.general).map((action) => {
                const prompt = t(action.promptKey);
                return (
                  <BorderGlow
                    key={action.titleKey}
                    className="cursor-pointer"
                    backgroundColor="var(--color-card)"
                    borderRadius={16}
                    glowRadius={24}
                    glowColor={action.glowColor}
                    colors={action.colors}
                    glowIntensity={0.8}
                    fillOpacity={0.3}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (!projectId) return;
                        dispatch(setDraft({ projectId, draft: prompt }));
                        if (editorRef.current) editorRef.current.innerText = prompt;
                      }}
                      className="w-full p-3 text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-muted-foreground">{action.icon}</span>
                        <span className="text-sm font-medium">{t(action.titleKey)}</span>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                        {t(action.descKey)}
                      </p>
                    </button>
                  </BorderGlow>
                );
              })}
            </div>
          ) : null}

          {/* Message list */}
          {renderedMessages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              sending={sending}
              submittingToolCallId={submittingToolCallId}
              onApplyToolResult={(result) => {
                if (projectId) void dispatch(applyToolResult({ projectId, result }));
              }}
            />
          ))}

          {/* Typing indicator — shows immediately after user sends */}
          {sending &&
            !messages.some(
              (m) =>
                m.role === "assistant" &&
                m.parts.some((p) => p.type === "text" && p.state === "streaming")
            ) && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1 px-3 py-2">
                  <span className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
                  <span className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
                  <span className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
        </div>

        {/* Scroll to bottom + Chat composer */}
        <div className="shrink-0 relative">
          {!isAtBottom && hasMeaningfulMessages && (
            <button
              type="button"
              onClick={() => scrollToBottom("smooth")}
              className="absolute -top-10 left-1/2 z-10 -translate-x-1/2 flex size-8 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-opacity hover:bg-muted"
            >
              <IconArrowDown className="size-3.5 text-muted-foreground" />
            </button>
          )}
          <ChatComposer
            projectId={projectId}
            draftInput={draftInput}
            attachments={attachments}
            sending={sending}
            hasPendingTools={hasPendingTools}
            hasUploadingAttachments={hasUploadingAttachments}
            selectedAgent={selectedAgent}
            error={error}
            editorRef={editorRef}
            activePendingTool={activePendingTool}
            activeTask={activeTask}
            onTaskContinue={handleTaskContinue}
            onToolResult={(result: AssistantToolResult) => {
              if (projectId) void dispatch(applyToolResult({ projectId, result }));
            }}
          />
        </div>
      </div>
    </PanelLayout>
  );
}
