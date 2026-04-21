"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { IconArrowDown, IconCheck, IconMessagePlus, IconSparkles } from "@tabler/icons-react";
import { BorderGlow } from "@/components/ui/border-glow";
import { useTranslations } from "@/src/i18n/i18n";
import { PanelLayout } from "@/app/projects/_components/panels/panel-layout";
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
  loadHistory,
  newConversation,
  appendStreamChunk,
  appendMessageChunk,
  finalizeMessage,
  finalizeTurnOnIdle,
  streamError,
} from "@/src/store/slices/assistantSlice";
import { ensureSession, closeSession } from "@/src/lib/assistant/chat-session";
import { Button } from "@/components/ui/button";

import { quickActionsByAgent } from "./constants";
import { MessageBubble } from "./message-bubble";
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
    if (!projectId) return;
    dispatch(ensureProject(projectId));
    // Load conversation history from server on mount.
    dispatch(loadHistory(projectId));
    // Open the project-scoped WS so every message_added/updated event
    // flows into Redux for the whole time the panel is mounted.
    ensureSession(projectId, {
      onMessage: (message) => {
        dispatch(appendStreamChunk({ projectId, message }));
      },
      onMessageChunk: (messageId, partIndex, appendText) => {
        dispatch(appendMessageChunk({ projectId, messageId, partIndex, appendText }));
      },
      onMessageFinalize: (messageId) => {
        dispatch(finalizeMessage({ projectId, messageId }));
      },
      onAgentState: (state) => {
        if (state === "idle") {
          void dispatch(finalizeTurnOnIdle(projectId));
        } else if (state === "failed") {
          dispatch(streamError({ projectId, error: "Agent run failed" }));
        }
      },
      onError: (err) => {
        console.warn("[ai-assistant] chat-session error:", err.message);
      },
    });
    return () => {
      closeSession(projectId);
    };
  }, [dispatch, projectId]);

  const messages = conversation?.messages ?? EMPTY_MESSAGES;
  const draftInput = conversation?.draftInput ?? "";
  const attachments = conversation?.attachments ?? EMPTY_ATTACHMENTS;
  const sending = conversation?.sending ?? false;
  const pendingToolUi = conversation?.pendingToolUi ?? EMPTY_PENDING_TOOLS;
  const error = conversation?.error ?? null;

  useEffect(() => {
    if (!draftInput && editorRef.current && editorRef.current.innerText.trim()) {
      editorRef.current.innerText = "";
    }
  }, [draftInput]);

  // Cross-component editor sync — fired when a workflow card wants to
  // drop a phrase into the composer (e.g. "我要修改" prefill) without
  // posting it. setDraft alone doesn't update the contenteditable since
  // React doesn't manage innerText, so we set it imperatively here and
  // move the caret to the end so the user can continue typing.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; text?: string }>).detail;
      if (!detail || detail.projectId !== projectId) return;
      const editor = editorRef.current;
      if (!editor) return;
      editor.innerText = detail.text ?? "";
      editor.focus();
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    };
    window.addEventListener("ai-assistant:set-draft", handler);
    return () => window.removeEventListener("ai-assistant:set-draft", handler);
  }, [projectId]);

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

  const hasMeaningfulMessages = messages.length > 1;
  const hasUploadingAttachments = attachments.some((a) => a.status === "uploading");

  // Suppress messages that will render empty — today the culprit is
  // `workflow_progress` with `current >= total`, which WorkflowProgressCard
  // returns null for (the accompanying workflow_completed/suspended/failed
  // message carries the terminal state, making the 100% progress card a
  // duplicate). Without this filter those messages still occupy ~16px
  // of vertical space each (py-2 on the bubble) and pollute the timeline
  // with empty gaps. Keep the filter narrow so non-empty messages aren't
  // accidentally dropped.
  const renderedMessages = useMemo(
    () =>
      messages.filter((m) => {
        if (!Array.isArray(m.parts) || m.parts.length === 0) return true;
        // Keep the message if ANY part is something other than a "done"
        // workflow_progress. A message whose ONLY content is a 100% progress
        // part is the one we want to drop.
        return m.parts.some((part) => {
          if (!part || typeof part !== "object") return true;
          const p = part as { type?: unknown; output?: unknown };
          if (p.type !== "tool-workflow_progress") return true;
          const out = p.output as { current?: unknown; total?: unknown } | undefined;
          const current = typeof out?.current === "number" ? out.current : 0;
          const total = typeof out?.total === "number" ? out.total : 0;
          return !(total > 0 && current >= total);
        });
      }),
    [messages]
  );

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

  return (
    <>
      <PanelLayout
        bodyClassName="p-0"
        icon={
          <div className="flex size-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <IconSparkles className="size-4" />
          </div>
        }
        title={t("title")}
        actions={
          hasMeaningfulMessages ? (
            <Button
              variant="ghost"
              color="muted"
              size="icon-xs"
              onClick={() => {
                if (projectId) dispatch(newConversation(projectId));
              }}
              title={t("newConversation")}
            >
              <IconMessagePlus className="size-3.5" />
            </Button>
          ) : null
        }
        onClose={onClose}
        footer={null}
      >
        <div className="flex h-full flex-col relative">
          {/* Messages area — extra bottom padding so content scrolls behind composer */}
          <div ref={messagesRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-6 px-4">
            {/* Project-params gate — shown until the user sets the 4 params the
                downstream workflows depend on. Blocks message sending so the
                supervisor never dispatches story_outline without them. */}
            {/* Welcome + quick actions */}
            {!hasMeaningfulMessages ? (
              <div className="space-y-3">
                <div className="px-1 text-center mb-6">
                  <p className="text-sm font-medium">{t("greeting")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t("greetingHint")}</p>
                </div>
                {(quickActionsByAgent[selectedAgent] ?? quickActionsByAgent.general).map(
                  (action) => {
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
                  }
                )}
              </div>
            ) : null}

            {renderedMessages.map((message, index) => {
              // Check if this is the last assistant message
              const isLastAssistant =
                message.role === "assistant" &&
                !renderedMessages.slice(index + 1).some((m) => m.role === "assistant");
              return (
                <div key={message.id}>
                  <MessageBubble
                    message={message}
                    isLastAssistant={isLastAssistant}
                    onApplyToolResult={(result) => {
                      if (projectId) void dispatch(applyToolResult({ projectId, result }));
                    }}
                  />
                </div>
              );
            })}

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
              error={error}
              editorRef={editorRef}
              activePendingTool={activePendingTool}
              onToolResult={(result: AssistantToolResult) => {
                if (projectId) void dispatch(applyToolResult({ projectId, result }));
              }}
            />
          </div>
        </div>
      </PanelLayout>
    </>
  );
}
