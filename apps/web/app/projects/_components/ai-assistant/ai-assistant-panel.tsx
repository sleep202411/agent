"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowDown,
  IconCheck,
  IconInfoCircle,
  IconMessagePlus,
  IconSparkles,
} from "@tabler/icons-react";
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
  finalizeTurnOnIdle,
  streamError,
} from "@/src/store/slices/assistantSlice";
import { ensureSession, closeSession } from "@/src/lib/assistant/chat-session";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

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
  const historyMessageCount = conversation?.historyMessageCount ?? 0;
  const messageLimit = conversation?.messageLimit ?? 50;
  const tier = conversation?.tier ?? "free";
  const conversationId = conversation?.conversationId ?? "";
  const messageCount = messages.filter((m) => m.role === "user").length;
  const [showUsageInfo, setShowUsageInfo] = useState(false);

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

  return (
    <>
      <PanelLayout
        icon={
          <div className="flex size-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <IconSparkles className="size-4" />
          </div>
        }
        title={t("title")}
        description={
          <span className="inline-flex items-center gap-1.5">
            <span>
              {messageCount === 0
                ? t("usageHintFresh", { max: messageLimit })
                : messageCount >= messageLimit
                  ? t("usageHintFull")
                  : messageCount >= messageLimit * 0.8
                    ? t("usageHintAlmost", { remaining: messageLimit - messageCount })
                    : t("usageHintNormal", { current: messageCount, max: messageLimit })}
            </span>
            <button
              type="button"
              onClick={() => setShowUsageInfo((v) => !v)}
              className="inline-flex items-center text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              <IconInfoCircle className="size-3" />
            </button>
          </span>
        }
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
          <div ref={messagesRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-6">
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

            {/* Message list with history separator */}
            {renderedMessages.map((message, index) => {
              // Check if this is the last assistant message
              const isLastAssistant =
                message.role === "assistant" &&
                !renderedMessages.slice(index + 1).some((m) => m.role === "assistant");
              return (
                <div key={message.id}>
                  {/* History separator: after welcome (index 0) + history messages */}
                  {historyMessageCount > 0 && index === historyMessageCount + 1 && (
                    <div className="flex items-center gap-3 py-2">
                      <div className="flex-1 border-t border-border/40" />
                      <span className="text-[10px] text-muted-foreground/40">
                        {t("historySeparator")}
                      </span>
                      <div className="flex-1 border-t border-border/40" />
                    </div>
                  )}
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

      {/* Usage info dialog */}
      <AlertDialog open={showUsageInfo} onOpenChange={setShowUsageInfo}>
        <AlertDialogContent className="sm:max-w-xs">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">{t("usageInfoTitle")}</AlertDialogTitle>
          </AlertDialogHeader>

          <div className="space-y-3 py-1">
            {/* Tier badge */}
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                {tier === "free" ? t("tierFree") : tier}
              </span>
            </div>

            {/* Progress */}
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-xs text-muted-foreground">{t("usageInfoMessages")}</span>
                <span className="text-sm font-semibold tabular-nums">
                  {messageCount}
                  <span className="text-muted-foreground/50 font-normal"> / {messageLimit}</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.min(100, (messageCount / messageLimit) * 100)}%` }}
                />
              </div>
            </div>

            {/* Session ID */}
            {conversationId && (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground/50">Session</span>
                <span className="font-mono text-muted-foreground/40">{conversationId}</span>
              </div>
            )}

            {/* Retention warning */}
            <p className="text-[11px] leading-relaxed text-muted-foreground/50">
              {tier === "free" ? t("usageRetentionFree") : t("usageRetentionVip")}
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogAction variant="outline" color="muted" size="sm">
              {t("usageInfoClose")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
