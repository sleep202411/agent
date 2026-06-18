"use client";

/**
 * Studio canvas copilot panel (P2a).
 *
 * Streams from /aurora/copilot/stream (Qwen) via the AI SDK UI message stream
 * and `useChat`. Canvas tools (query_graph / add_node / edit_node_params /
 * select) are declared server-side WITHOUT `execute`, so each call is forwarded
 * here and run against the live Yjs graph in `onToolCall` (see use-copilot-tools);
 * the result is reported with `addToolOutput` and `sendAutomaticallyWhen` closes
 * the multi-step loop. A compact canvas digest is sent each turn so the model
 * plans against the real graph. Per (user × project); the server persists it.
 *
 * P2b will add connect_nodes / run_generation (with confirmation chips).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  isTextUIPart,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";
import { useTranslations } from "next-intl";
import { IconArrowUp, IconPlayerStopFilled, IconSparkles, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useActiveWorkspaceId } from "@/app/_components/workspace-context";
import { CONFIRM_TOOLS, useCopilotTools } from "./use-copilot-tools";

const COPILOT_API = "/aurora/copilot/stream";
const COPILOT_HISTORY_API = "/aurora/copilot/history";

type ToolOutputFn = (args: {
  tool: string;
  toolCallId: string;
  output?: unknown;
  state?: "output-error";
  errorText?: string;
}) => void;

// Hard cap on auto-continued tool steps per user turn — guards against a model
// that loops indefinitely (each resubmission is a paid LLM call). The server's
// stopWhen can't bound this because client-executed tools end each server step.
const MAX_TOOL_STEPS_PER_TURN = 16;

function autoContinueToolLoop({ messages }: { messages: UIMessage[] }): boolean {
  if (!lastAssistantMessageIsCompleteWithToolCalls({ messages })) return false;
  let toolSteps = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") break;
    toolSteps += m.parts.filter(isToolUIPart).length;
  }
  return toolSteps < MAX_TOOL_STEPS_PER_TURN;
}

export function CopilotPanel({
  projectId,
  mode = "canvas",
  open,
  onClose,
}: {
  projectId: string;
  mode?: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("copilot");
  const workspaceId = useActiveWorkspaceId();
  const conversationId = useMemo(() => `canvas:${projectId}`, [projectId]);

  const { runTool, buildGraphDigest, buildModelsDigest } = useCopilotTools();

  // Confirmation gate for spending/destructive tools — a Promise the confirm
  // bar resolves. Lets onToolCall `await` the user's decision.
  const [pendingConfirm, setPendingConfirm] = useState<{
    text: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const requestConfirm = useCallback(
    (text: string) => new Promise<boolean>((resolve) => setPendingConfirm({ text, resolve })),
    []
  );

  // Live values read inside stable closures (transport / onToolCall).
  const wsRef = useRef(workspaceId);
  wsRef.current = workspaceId;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const runToolRef = useRef(runTool);
  runToolRef.current = runTool;
  const buildDigestRef = useRef(buildGraphDigest);
  buildDigestRef.current = buildGraphDigest;
  const buildModelsRef = useRef(buildModelsDigest);
  buildModelsRef.current = buildModelsDigest;
  const requestConfirmRef = useRef(requestConfirm);
  requestConfirmRef.current = requestConfirm;
  const confirmTextRef = useRef<Record<string, string>>({});
  confirmTextRef.current = {
    run_generation: t("confirmRun"),
    remove_node: t("confirmRemoveNode"),
    remove_edge: t("confirmRemoveEdge"),
  };
  const toolOutputRef = useRef<ToolOutputFn | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: COPILOT_API,
        credentials: "include",
        prepareSendMessagesRequest({ messages, body }) {
          return {
            body: {
              ...body,
              messages,
              conversationId,
              projectId,
              mode: modeRef.current,
              graphContext: buildDigestRef.current(),
              modelsContext: buildModelsRef.current(),
            },
            headers: wsRef.current ? { "x-fizz-workspace-id": wsRef.current } : undefined,
          };
        },
      }),
    [conversationId, projectId]
  );

  const chat = useChat<UIMessage>({
    transport,
    sendAutomaticallyWhen: autoContinueToolLoop,
    async onToolCall({ toolCall }) {
      const add = toolOutputRef.current;
      if (!add) return;
      const tc = toolCall as { toolName: string; toolCallId: string; input: unknown };
      try {
        // Spending/destructive tools require explicit user confirmation first.
        if (CONFIRM_TOOLS.has(tc.toolName)) {
          const approved = await requestConfirmRef.current(
            confirmTextRef.current[tc.toolName] ?? ""
          );
          if (!approved) {
            add({
              tool: tc.toolName,
              toolCallId: tc.toolCallId,
              output: { ok: false, declined: true },
            });
            return;
          }
        }
        const output = await runToolRef.current(tc.toolName, tc.input);
        add({ tool: tc.toolName, toolCallId: tc.toolCallId, output });
      } catch (e) {
        add({
          state: "output-error",
          tool: tc.toolName,
          toolCallId: tc.toolCallId,
          errorText: e instanceof Error ? e.message : "Tool failed",
        });
      }
    },
  });
  const { messages, sendMessage, setMessages, status, stop, error, regenerate } = chat;
  toolOutputRef.current = chat.addToolOutput as unknown as ToolOutputFn;

  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";

  // Seed from the persisted conversation once on mount.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(COPILOT_HISTORY_API, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(wsRef.current ? { "x-fizz-workspace-id": wsRef.current } : {}),
          },
          body: JSON.stringify({ conversationId }),
        });
        if (!res.ok) return;
        const json = (await res.json()) as
          | { messages?: UIMessage[] }
          | { data?: { messages?: UIMessage[] } };
        const seeded =
          ("messages" in json ? json.messages : undefined) ??
          ("data" in json ? json.data?.messages : undefined) ??
          [];
        if (!cancelled && seeded.length > 0) setMessages(seeded);
      } catch {
        // Non-fatal: a fresh thread is fine if history can't load.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, setMessages]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  // If the panel is closed while a confirmation is pending, auto-decline it so
  // the awaiting tool call (and the held stream) doesn't park indefinitely.
  useEffect(() => {
    if (!open && pendingConfirm) {
      pendingConfirm.resolve(false);
      setPendingConfirm(null);
    }
  }, [open, pendingConfirm]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  }, [input, busy, sendMessage]);

  if (!open) return null;

  return (
    <div className="absolute top-0 right-0 z-30 flex h-full w-[380px] flex-col bg-popover/95 shadow-2xl shadow-black/50 backdrop-blur-xl">
      <div className="flex items-center gap-2 px-4 py-3">
        <IconSparkles className="size-4.5 text-white/80" stroke={1.8} />
        <span className="flex-1 text-sm font-semibold text-foreground">{t("title")}</span>
        <button
          type="button"
          aria-label={t("close")}
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-xl text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconX className="size-4.5" stroke={1.8} />
        </button>
      </div>
      <div className="h-px bg-white/10" />

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <IconSparkles className="size-7 text-white/25" stroke={1.5} />
            <p className="max-w-[16rem] text-sm text-muted-foreground">{t("empty")}</p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              youLabel={t("you")}
              actingLabel={t("acting")}
              actedLabel={t("acted")}
            />
          ))
        )}
        {status === "submitted" && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-white/60" />
            {t("thinking")}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t("error")}</span>
            <button
              type="button"
              onClick={() => void regenerate()}
              className="font-medium text-white/80 underline-offset-2 hover:underline"
            >
              {t("retry")}
            </button>
          </div>
        )}
      </div>

      {pendingConfirm && (
        <div className="mx-3 mb-2 flex flex-col gap-2 rounded-2xl bg-white/[0.06] p-3">
          <span className="text-sm leading-relaxed text-foreground/90">{pendingConfirm.text}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                pendingConfirm.resolve(false);
                setPendingConfirm(null);
              }}
              className="flex-1 rounded-xl bg-white/[0.06] px-3 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                pendingConfirm.resolve(true);
                setPendingConfirm(null);
              }}
              className="flex-1 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
            >
              {t("confirm")}
            </button>
          </div>
        </div>
      )}

      <div className="px-3 pb-3">
        <div className="flex items-end gap-2 rounded-2xl bg-white/[0.05] p-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={t("placeholder")}
            className="max-h-32 min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {busy ? (
            <button
              type="button"
              aria-label={t("stop")}
              onClick={() => void stop()}
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-white transition-colors hover:bg-white/[0.14]"
            >
              <IconPlayerStopFilled className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={t("send")}
              disabled={!input.trim()}
              onClick={submit}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                input.trim()
                  ? "bg-white text-black hover:bg-white/90"
                  : "bg-white/[0.06] text-white/30"
              )}
            >
              <IconArrowUp className="size-4.5" stroke={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageItem({
  message,
  youLabel,
  actingLabel,
  actedLabel,
}: {
  message: UIMessage;
  youLabel: string;
  actingLabel: string;
  actedLabel: string;
}) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      <span className="px-1 text-[11px] font-medium text-muted-foreground">
        {isUser ? youLabel : "FizzDragon"}
      </span>
      {message.parts.map((part, i) => {
        if (isTextUIPart(part)) {
          if (!part.text) return null;
          return (
            <div
              key={i}
              className={cn(
                "max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                isUser ? "bg-white/[0.1] text-foreground" : "bg-white/[0.04] text-foreground/90"
              )}
            >
              {part.text}
            </div>
          );
        }
        if (isToolUIPart(part)) {
          return <ToolChip key={i} part={part} actingLabel={actingLabel} actedLabel={actedLabel} />;
        }
        return null;
      })}
    </div>
  );
}

function ToolChip({
  part,
  actingLabel,
  actedLabel,
}: {
  part: ToolUIPart | DynamicToolUIPart;
  actingLabel: string;
  actedLabel: string;
}) {
  let errored = false;
  let done = false;
  let text = actingLabel;
  if (part.state === "output-error") {
    errored = true;
    text = part.errorText || actedLabel;
  } else if (part.state === "output-available") {
    done = true;
    text = actedLabel;
  }
  return (
    <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-1.5 rounded-full",
          errored ? "bg-red-400" : done ? "bg-white/50" : "animate-pulse bg-white/60"
        )}
      />
      {text}
    </div>
  );
}
