"use client";

/**
 * Studio canvas copilot panel (P2a).
 *
 * Streams from /aurora/copilot/stream (Qwen) via the AI SDK UI message stream
 * and `useChat`. Canvas tools (query_graph / add_node / edit_node_params /
 * select) are declared server-side WITHOUT `execute`, so each call is forwarded
 * here and run against the live Yjs graph in `onToolCall` (see use-copilot-tools);
 * the result is reported with `addToolOutput`. A compact canvas digest is sent
 * each creator turn so the model
 * plans against the real graph. Per (user × project); the server persists it.
 *
 * P2b will add connect_nodes / run_generation (with confirmation chips).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";
import { useLocale, useTranslations } from "next-intl";
import { IconSparkles } from "@tabler/icons-react";
import { CopilotComposer } from "@/components/copilot/copilot-composer";
import {
  copilotQuotaNoticeText,
  copilotStreamErrorDetails,
} from "@/components/copilot/copilot-history";
import {
  clearCopilotPendingTurn,
  isRecord,
  readCopilotPendingTurn,
  writeCopilotPendingTurn,
  type CopilotPendingTurn,
  type CopilotPendingTurnScope,
} from "@/components/copilot/copilot-pending-turn";
import { CopilotSidePanel } from "@/components/copilot/copilot-side-panel";
import { CopilotStatusNotice } from "@/components/copilot/copilot-status-notice";
import { CopilotTranscript } from "@/components/copilot/copilot-transcript";
import { useCopilotHistory } from "@/components/copilot/use-copilot-history";
import { useCopilotScopeLifecycle } from "@/components/copilot/use-copilot-scope-lifecycle";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/app/_components/auth-provider";
import { useProjectPayerWorkspace } from "@/app/[locale]/project/_components/project-context";
import {
  createCanvasCopilotChatTransport,
  type CanvasCopilotChatRequestContext,
  type CanvasCopilotServerToolCall,
} from "./canvas-copilot-chat-transport";
import { CONFIRM_TOOLS, useCopilotTools } from "./use-copilot-tools";

type ToolOutputFn = (args: {
  tool: string;
  toolCallId: string;
  output?: unknown;
  state?: "output-error";
  errorText?: string;
}) => void | PromiseLike<void>;

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

interface CopilotPanelProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

export function CopilotPanel(props: CopilotPanelProps) {
  return <CopilotPanelSession key={`canvas:${props.projectId}`} {...props} />;
}

type CanvasPendingTurn = CopilotPendingTurn<UIMessage, Record<string, never>>;

function CopilotPanelSession({ projectId, open, onClose }: CopilotPanelProps) {
  const t = useTranslations("copilot");
  const locale = useLocale();
  const workspaceId = useProjectPayerWorkspace()?.id ?? null;
  const { user } = useAuth();
  const authenticatedUserId = user?.id == null ? null : String(user.id);
  const mode = "canvas" as const;
  const conversationId = useMemo(() => `canvas:${projectId}`, [projectId]);
  const recoveryScope = useMemo<CopilotPendingTurnScope | null>(
    () =>
      authenticatedUserId && workspaceId
        ? {
            userId: authenticatedUserId,
            workspaceId,
            projectId,
            mode,
            conversationId,
          }
        : null,
    [authenticatedUserId, conversationId, mode, projectId, workspaceId]
  );

  const { runTool, buildGraphDigest, buildModelsDigest } = useCopilotTools();

  // Confirmation gate for spending/destructive tools — a Promise the confirm
  // bar resolves. Lets onToolCall `await` the user's decision.
  const [pendingConfirm, setPendingConfirm] = useState<{
    text: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const pendingConfirmRef = useRef<typeof pendingConfirm>(null);
  const settlePendingConfirmation = useCallback(
    (confirmation: NonNullable<typeof pendingConfirm>, approved: boolean) => {
      if (pendingConfirmRef.current !== confirmation) return;
      pendingConfirmRef.current = null;
      setPendingConfirm((current) => (current === confirmation ? null : current));
      confirmation.resolve(approved);
    },
    []
  );
  const declinePendingConfirmation = useCallback(() => {
    const current = pendingConfirmRef.current;
    if (current) settlePendingConfirmation(current, false);
  }, [settlePendingConfirmation]);
  const requestConfirm = useCallback(
    (text: string) =>
      new Promise<boolean>((resolve) => {
        // The model may emit parallel tool calls. Never orphan an earlier
        // confirmation promise: decline it before presenting the next one.
        declinePendingConfirmation();
        const confirmation = { text, resolve };
        pendingConfirmRef.current = confirmation;
        setPendingConfirm(confirmation);
      }),
    [declinePendingConfirmation]
  );

  // Live values read inside stable async tool closures.
  const runToolRef = useLatestRef(runTool);
  const requestConfirmRef = useLatestRef(requestConfirm);
  const confirmText = useMemo(
    () => ({
      run_generation: t("confirmRun"),
      remove_node: t("confirmRemoveNode"),
      remove_edge: t("confirmRemoveEdge"),
    }),
    [t]
  );
  const confirmTextRef = useLatestRef<Record<string, string>>(confirmText);
  const toolOutputRef = useRef<ToolOutputFn | null>(null);
  // Invalidates a confirmation continuation before Stop aborts the stream. The
  // epoch check closes the event-loop race where the promise has resolved but
  // the tool body has not started yet.
  const toolExecutionEpochRef = useRef(0);
  const activeClientToolCallsRef = useRef(new Set<string>());
  const stopChatRef = useRef<(() => void | Promise<void>) | null>(null);
  const retryHistoryRef = useRef<(() => Promise<unknown>) | null>(null);
  const interruptedContinuationRef = useRef(false);
  const scopeActiveRef = useCopilotScopeLifecycle(() => {
    toolExecutionEpochRef.current += 1;
    activeClientToolCallsRef.current.clear();
    toolOutputRef.current = null;
    declinePendingConfirmation();
    return stopChatRef.current?.();
  });

  const requestContext = useMemo<CanvasCopilotChatRequestContext>(
    () => ({
      conversationId,
      projectId,
      mode,
      workspaceId,
      buildGraphDigest,
      buildModelsDigest,
    }),
    [buildGraphDigest, buildModelsDigest, conversationId, mode, projectId, workspaceId]
  );
  const [transportController] = useState(() => createCanvasCopilotChatTransport(requestContext));
  useLayoutEffect(() => {
    transportController.updateContext(requestContext);
  }, [requestContext, transportController]);

  const [recoveredTurn, setRecoveredTurn] = useState<CanvasPendingTurn | null>(null);
  const [recoveryStorageError, setRecoveryStorageError] = useState(false);
  const recoveredTurnRef = useRef<CanvasPendingTurn | null>(null);
  const pendingSubmittedTurnRef = useRef<CanvasPendingTurn | null>(null);
  const deliberatelyAbortedMessageIdRef = useRef<string | null>(null);
  const recoveryScopeRef = useRef(recoveryScope);
  useLayoutEffect(() => {
    recoveryScopeRef.current = recoveryScope;
  }, [recoveryScope]);
  const preserveTurn = useCallback((turn: CanvasPendingTurn) => {
    recoveredTurnRef.current = turn;
    setRecoveredTurn(turn);
    if (!writeCopilotPendingTurn(recoveryScopeRef.current, turn)) {
      setRecoveryStorageError(true);
    }
  }, []);
  const clearRecoveredTurn = useCallback((messageId?: string) => {
    const current = recoveredTurnRef.current;
    if (!messageId || current?.message.id === messageId) {
      recoveredTurnRef.current = null;
      setRecoveredTurn(null);
    }
    if (!messageId || pendingSubmittedTurnRef.current?.message.id === messageId) {
      pendingSubmittedTurnRef.current = null;
    }
    clearCopilotPendingTurn(recoveryScopeRef.current, messageId);
    setRecoveryStorageError(false);
  }, []);
  useEffect(() => {
    let active = true;
    pendingSubmittedTurnRef.current = null;
    deliberatelyAbortedMessageIdRef.current = null;
    const restored = readCopilotPendingTurn(recoveryScope, parseCanvasPendingTurn);
    recoveredTurnRef.current = restored;
    queueMicrotask(() => {
      if (!active) return;
      setRecoveryStorageError(false);
      setRecoveredTurn(restored);
    });
    return () => {
      active = false;
    };
  }, [recoveryScope]);

  const chat = useChat<UIMessage>({
    id: conversationId,
    transport: transportController.transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onFinish({ message, isAbort, isError }) {
      const pending = pendingSubmittedTurnRef.current;
      if (
        pending &&
        isError &&
        !isAbort &&
        deliberatelyAbortedMessageIdRef.current !== pending.message.id
      ) {
        preserveTurn(pending);
      }
      if (
        interruptedContinuationRef.current &&
        (isAbort ||
          isError ||
          !lastAssistantMessageIsCompleteWithToolCalls({ messages: [message] }))
      ) {
        interruptedContinuationRef.current = false;
        queueMicrotask(() => void retryHistoryRef.current?.());
      }
    },
    async onToolCall({ toolCall }) {
      if (!scopeActiveRef.current) return;
      const executionEpoch = toolExecutionEpochRef.current;
      const add = toolOutputRef.current;
      if (!add) return;
      const tc = toolCall as CanvasCopilotServerToolCall;
      activeClientToolCallsRef.current.add(tc.toolCallId);
      try {
        // The stream callback is the only trusted origin for a fresh tool-call
        // identity. The transport will reject a continuation if the client
        // changes its id, name, type, input, title, or provider metadata.
        transportController.registerServerToolCall(tc);
        // Spending/destructive tools require explicit user confirmation first.
        if (CONFIRM_TOOLS.has(tc.toolName)) {
          const approved = await requestConfirmRef.current(
            confirmTextRef.current[tc.toolName] ?? ""
          );
          if (!scopeActiveRef.current || executionEpoch !== toolExecutionEpochRef.current) return;
          if (!approved) {
            add({
              tool: tc.toolName,
              toolCallId: tc.toolCallId,
              output: { ok: false, declined: true },
            });
            return;
          }
        }
        if (!scopeActiveRef.current || executionEpoch !== toolExecutionEpochRef.current) return;
        const output = await runToolRef.current(tc.toolName, tc.input);
        if (!scopeActiveRef.current || executionEpoch !== toolExecutionEpochRef.current) return;
        add({ tool: tc.toolName, toolCallId: tc.toolCallId, output });
      } catch (e) {
        if (!scopeActiveRef.current || executionEpoch !== toolExecutionEpochRef.current) return;
        add({
          state: "output-error",
          tool: tc.toolName,
          toolCallId: tc.toolCallId,
          errorText: e instanceof Error ? e.message : "Tool failed",
        });
      } finally {
        activeClientToolCallsRef.current.delete(tc.toolCallId);
      }
    },
  });
  const { messages, sendMessage, setMessages, status, stop, error, regenerate, clearError } = chat;
  useLayoutEffect(() => {
    stopChatRef.current = stop;
  }, [stop]);
  useEffect(() => {
    toolOutputRef.current = chat.addToolOutput as unknown as ToolOutputFn;
  }, [chat.addToolOutput]);

  const [input, setInput] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [localContinuationInterrupted, setLocalContinuationInterrupted] = useState(false);
  const busy = status === "submitted" || status === "streaming";
  const reconcileLoadedHistory = useCallback(
    (payload: { messages: UIMessage[] }) => {
      setLocalContinuationInterrupted(
        unresolvedLastStepClientToolCalls(payload.messages).length > 0
      );
      const stored = readCopilotPendingTurn(recoveryScopeRef.current, parseCanvasPendingTurn);
      if (!stored) return;
      if (payload.messages.some((message) => message.id === stored.message.id)) {
        clearRecoveredTurn(stored.message.id);
        return;
      }
      if (pendingSubmittedTurnRef.current?.message.id !== stored.message.id) {
        recoveredTurnRef.current = stored;
        setRecoveredTurn(stored);
      }
    },
    [clearRecoveredTurn]
  );
  const history = useCopilotHistory<UIMessage>({
    conversationId,
    workspaceId,
    mode,
    projectId,
    setMessages,
    onLoaded: reconcileLoadedHistory,
  });
  const retryHistory = history.retry;
  useLayoutEffect(() => {
    retryHistoryRef.current = retryHistory;
  }, [retryHistory]);
  const handledErrorRef = useRef<Error | undefined>(undefined);
  const streamError = copilotStreamErrorDetails(error);
  // A typed 429 body renders as an honest localized notice, never as the raw
  // JSON string the AI SDK transport throws.
  const quotaNotice = streamError?.quota
    ? copilotQuotaNoticeText(streamError.quota, (key, values) => t(key, values), locale)
    : null;
  useEffect(() => {
    if (!error || handledErrorRef.current === error) return;
    handledErrorRef.current = error;
    const action = copilotStreamErrorDetails(error)?.action;
    const optimisticTurn = pendingSubmittedTurnRef.current;
    queueMicrotask(() => {
      if (optimisticTurn && deliberatelyAbortedMessageIdRef.current !== optimisticTurn.message.id) {
        preserveTurn(optimisticTurn);
      }
      if (action === "refresh_history") void retryHistory();
    });
  }, [error, preserveTurn, retryHistory]);

  useEffect(() => {
    const recoveredId = recoveredTurn?.message.id;
    if (!recoveredId || !history.payload?.messages.some((message) => message.id === recoveredId)) {
      return;
    }
    queueMicrotask(() => clearRecoveredTurn(recoveredId));
  }, [clearRecoveredTurn, history.payload?.messages, recoveredTurn?.message.id]);

  const reconcileDispatchedTurn = useCallback(
    async (turn: CanvasPendingTurn): Promise<boolean> => {
      const canonical = await retryHistory();
      if (canonical?.messages.some((message) => message.id === turn.message.id)) {
        clearRecoveredTurn(turn.message.id);
        return true;
      }
      preserveTurn(turn);
      return false;
    },
    [clearRecoveredTurn, preserveTurn, retryHistory]
  );

  const interruptedToolCalls = useMemo(
    () => unresolvedLastStepClientToolCalls(history.payload?.messages ?? []),
    [history.payload?.messages]
  );
  const continuationRecoveryRequired =
    localContinuationInterrupted || interruptedToolCalls.length > 0;
  const continuationCanBeSkipped =
    interruptedToolCalls.length > 0 &&
    interruptedToolCalls.every((part) => part.state === "input-available");

  // A keyed session owns exactly one AI SDK Chat. Aborting and invalidating the
  // callbacks on scope exit prevents a late stream/tool result from reaching a
  // different project after navigation.
  // If the panel is closed while a confirmation is pending, auto-decline it so
  // the awaiting tool call (and the held stream) doesn't park indefinitely.
  useEffect(() => {
    if (open || !pendingConfirm) return;
    queueMicrotask(() => {
      settlePendingConfirmation(pendingConfirm, false);
    });
  }, [open, pendingConfirm, settlePendingConfirmation]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (
      !text ||
      busy ||
      continuationRecoveryRequired ||
      history.status !== "ready" ||
      history.conversationStatus !== "ready"
    )
      return;
    const message: UIMessage = {
      id: globalThis.crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text }],
    };
    const turn: CanvasPendingTurn = { message, metadata: {} };
    if (!writeCopilotPendingTurn(recoveryScopeRef.current, turn)) {
      setRecoveryStorageError(true);
      return;
    }
    setRecoveryStorageError(false);
    deliberatelyAbortedMessageIdRef.current = null;
    pendingSubmittedTurnRef.current = turn;
    transportController.updateContext(requestContext);
    setInput("");
    try {
      void sendMessage(message)
        .then(() => reconcileDispatchedTurn(turn))
        .catch(() => {
          if (deliberatelyAbortedMessageIdRef.current !== message.id) preserveTurn(turn);
        });
    } catch {
      preserveTurn(turn);
    }
  }, [
    busy,
    continuationRecoveryRequired,
    history.conversationStatus,
    history.status,
    input,
    preserveTurn,
    reconcileDispatchedTurn,
    requestContext,
    sendMessage,
    transportController,
  ]);

  const skipInterruptedContinuation = useCallback(async (): Promise<boolean> => {
    if (busy || history.resetting || interruptedContinuationRef.current) return false;
    const canonical = await retryHistory();
    if (!canonical || canonical.status === "streaming" || canonical.status === "limit_exceeded") {
      return false;
    }
    const tail = canonical.messages[canonical.messages.length - 1];
    const unresolved = unresolvedLastStepClientToolCalls(canonical.messages);
    if (
      tail?.role !== "assistant" ||
      unresolved.length === 0 ||
      unresolved.some((part) => part.state !== "input-available")
    ) {
      return false;
    }
    const add = toolOutputRef.current;
    if (!add) return false;
    transportController.updateContext(requestContext);
    transportController.authorizeCanonicalAssistantMessage(tail);
    interruptedContinuationRef.current = true;
    try {
      for (const part of unresolved) {
        await add({
          tool: getToolName(part),
          toolCallId: part.toolCallId,
          output: { ok: false, skipped: true, interrupted: true },
        });
      }
      return true;
    } catch {
      interruptedContinuationRef.current = false;
      return false;
    }
  }, [busy, history.resetting, requestContext, retryHistory, transportController]);

  const retryCanonicalTurnWithCurrentContext = useCallback(async (): Promise<boolean> => {
    if (busy || history.resetting) return false;
    const canonical = await retryHistory();
    if (!canonical || (canonical.status !== "failed" && canonical.status !== "aborted")) {
      return false;
    }
    transportController.updateContext(requestContext);
    deliberatelyAbortedMessageIdRef.current = null;
    try {
      const tail = canonical.messages[canonical.messages.length - 1];
      if (tail?.role === "assistant") {
        // A failed client-tool continuation already owns a canonical assistant
        // message. Continue that exact message; regenerate() would delete it
        // and incorrectly restart the preceding user turn.
        transportController.authorizeCanonicalAssistantMessage(tail);
        await sendMessage();
      } else {
        await regenerate();
      }
      const settled = await retryHistory();
      return settled?.status === "ready";
    } catch {
      return false;
    }
  }, [
    busy,
    history.resetting,
    regenerate,
    requestContext,
    retryHistory,
    sendMessage,
    transportController,
  ]);

  const retryRecoveredTurn = useCallback(async (): Promise<boolean> => {
    const recovered = recoveredTurn;
    if (!recovered || busy || history.resetting) return false;
    const canonical = await retryHistory();
    if (!canonical) return false;
    const canonicalHasMessage = canonical.messages.some(
      (message) => message.id === recovered.message.id
    );
    transportController.updateContext(requestContext);
    deliberatelyAbortedMessageIdRef.current = null;
    try {
      if (
        canonicalHasMessage &&
        (canonical.status === "failed" || canonical.status === "aborted")
      ) {
        clearRecoveredTurn(recovered.message.id);
        const tail = canonical.messages[canonical.messages.length - 1];
        if (tail?.role === "assistant") {
          transportController.authorizeCanonicalAssistantMessage(tail);
          await sendMessage();
        } else {
          await regenerate();
        }
      } else if (canonical.status === "ready" && !canonicalHasMessage) {
        pendingSubmittedTurnRef.current = recovered;
        await sendMessage(recovered.message);
      } else if (canonical.status !== "ready" || !canonicalHasMessage) {
        return false;
      } else {
        clearRecoveredTurn(recovered.message.id);
        return true;
      }
      const settled = await retryHistory();
      const completed =
        settled?.status === "ready" &&
        settled.messages.some((message) => message.id === recovered.message.id);
      if (!completed) return false;
      clearRecoveredTurn(recovered.message.id);
      return true;
    } catch {
      return false;
    }
  }, [
    busy,
    clearRecoveredTurn,
    history.resetting,
    recoveredTurn,
    regenerate,
    requestContext,
    retryHistory,
    sendMessage,
    transportController,
  ]);

  const startNewConversation = useCallback(async (): Promise<boolean> => {
    if (busy || history.resetting) return false;
    declinePendingConfirmation();
    const reset = await history.reset();
    if (!reset) return false;
    clearRecoveredTurn();
    pendingSubmittedTurnRef.current = null;
    deliberatelyAbortedMessageIdRef.current = null;
    handledErrorRef.current = undefined;
    interruptedContinuationRef.current = false;
    setLocalContinuationInterrupted(false);
    clearError();
    setInput("");
    return true;
  }, [busy, clearError, clearRecoveredTurn, declinePendingConfirmation, history]);

  const stopCopilot = useCallback(() => {
    // Confirmation invalidation is synchronous and precedes stream abort. A
    // late click or continuation can no longer execute the gated tool.
    if (pendingConfirmRef.current || activeClientToolCallsRef.current.size > 0) {
      setLocalContinuationInterrupted(true);
    }
    toolExecutionEpochRef.current += 1;
    declinePendingConfirmation();
    const pending = pendingSubmittedTurnRef.current;
    deliberatelyAbortedMessageIdRef.current = pending?.message.id ?? null;
    if (pending) clearRecoveredTurn(pending.message.id);
    pendingSubmittedTurnRef.current = null;
    void (async () => {
      try {
        await stop();
      } finally {
        await retryHistory();
      }
    })();
  }, [clearRecoveredTurn, declinePendingConfirmation, retryHistory, stop]);

  const canonicalTurnNeedsRetry =
    history.conversationStatus === "failed" || history.conversationStatus === "aborted";
  const conversationLimitReached = history.conversationStatus === "limit_exceeded";

  return (
    <CopilotSidePanel
      open={open}
      title={t("title")}
      closeLabel={t("close")}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {pendingConfirm ? (
            <div className="flex flex-col gap-2 rounded-2xl bg-white/[0.06] p-3">
              <span className="text-sm leading-relaxed text-foreground/90">
                {pendingConfirm.text}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    settlePendingConfirmation(pendingConfirm, false);
                  }}
                  className="flex-1 rounded-xl bg-white/[0.06] px-3 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    settlePendingConfirmation(pendingConfirm, true);
                  }}
                  className="flex-1 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
                >
                  {t("confirm")}
                </button>
              </div>
            </div>
          ) : null}
          {recoveryStorageError ? (
            <CopilotStatusNotice message={t("recoveryStorageError")} />
          ) : null}
          {continuationRecoveryRequired ? (
            <CopilotStatusNotice
              message={t("continuationRecoveryRequired")}
              actionLabel={continuationCanBeSkipped ? t("continueInterrupted") : undefined}
              onAction={
                continuationCanBeSkipped ? () => void skipInterruptedContinuation() : undefined
              }
            />
          ) : null}
          {!continuationRecoveryRequired &&
          (error || canonicalTurnNeedsRetry || conversationLimitReached) ? (
            <CopilotStatusNotice
              message={
                quotaNotice ||
                streamError?.message ||
                error?.message ||
                (conversationLimitReached
                  ? t("historyLimitReached")
                  : history.conversationStatus === "aborted"
                    ? t("responseStopped")
                    : t("responseFailed"))
              }
              actionLabel={
                conversationLimitReached
                  ? t("newConversation")
                  : canonicalTurnNeedsRetry
                    ? t("retry")
                    : undefined
              }
              onAction={
                conversationLimitReached
                  ? () => setResetOpen(true)
                  : canonicalTurnNeedsRetry
                    ? () => void retryCanonicalTurnWithCurrentContext()
                    : undefined
              }
            />
          ) : null}
          {recoveredTurn ? (
            <CopilotStatusNotice
              message={t("messagePreserved")}
              actionLabel={
                !continuationRecoveryRequired &&
                (history.conversationStatus === "ready" || canonicalTurnNeedsRetry)
                  ? t("retryPreservedMessage")
                  : undefined
              }
              onAction={
                !continuationRecoveryRequired &&
                (history.conversationStatus === "ready" || canonicalTurnNeedsRetry)
                  ? () => void retryRecoveredTurn()
                  : undefined
              }
            />
          ) : null}
          {history.status !== "ready" ? (
            <CopilotStatusNotice
              message={
                history.status === "loading"
                  ? t("historyLoading")
                  : history.error?.message || t("historyError")
              }
              actionLabel={history.status === "error" ? t("retryHistory") : undefined}
              onAction={history.status === "error" ? () => void history.retry() : undefined}
            />
          ) : null}
          <CopilotComposer
            value={input}
            onChange={setInput}
            onSubmit={submit}
            onStop={stopCopilot}
            busy={busy}
            sendDisabled={
              !recoveryScope ||
              continuationRecoveryRequired ||
              history.status !== "ready" ||
              history.conversationStatus !== "ready"
            }
            placeholder={t("placeholder")}
            inputLabel={t("inputLabel")}
            sendLabel={t("send")}
            stopLabel={t("stop")}
          />
          <Dialog open={resetOpen} onOpenChange={setResetOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto flex text-xs text-muted-foreground"
                disabled={busy || history.resetting}
              >
                {t("newConversation")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("newConversationTitle")}</DialogTitle>
                <DialogDescription>{t("newConversationDescription")}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="ghost">
                    {t("cancelNewConversation")}
                  </Button>
                </DialogClose>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={history.resetting}
                  onClick={async () => {
                    if (await startNewConversation()) setResetOpen(false);
                  }}
                >
                  {t("confirmNewConversation")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      <CopilotTranscript
        messages={messages}
        status={status}
        assistantLabel="FizzDragon"
        userLabel={t("you")}
        thinkingLabel={t("thinking")}
        transcriptLabel={t("transcriptLabel")}
        scrollToLatestLabel={t("scrollToLatest")}
        empty={
          <div className="flex max-w-[16rem] flex-col items-center gap-2 text-center">
            <IconSparkles className="size-7 text-white/25" stroke={1.5} />
            <p className="text-sm leading-6 text-muted-foreground">{t("empty")}</p>
          </div>
        }
        renderNonTextPart={(part, key) =>
          isToolUIPart(part) ? (
            <ToolChip key={key} part={part} actingLabel={t("acting")} actedLabel={t("acted")} />
          ) : null
        }
      />
    </CopilotSidePanel>
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
    <Marker className="px-1">
      <MarkerIcon>
        <span
          className={cn(
            "size-1.5 rounded-full",
            errored ? "bg-red-400" : done ? "bg-white/50" : "animate-pulse bg-white/60"
          )}
        />
      </MarkerIcon>
      <MarkerContent>{text}</MarkerContent>
    </Marker>
  );
}

function unresolvedLastStepClientToolCalls(
  messages: UIMessage[]
): Array<ToolUIPart | DynamicToolUIPart> {
  const assistant = messages[messages.length - 1];
  if (assistant?.role !== "assistant") return [];
  const lastStepStart = assistant.parts.reduce(
    (lastIndex, part, index) => (part.type === "step-start" ? index : lastIndex),
    -1
  );
  return assistant.parts
    .slice(lastStepStart + 1)
    .filter(
      (part): part is ToolUIPart | DynamicToolUIPart =>
        isToolUIPart(part) &&
        !part.providerExecuted &&
        part.state !== "output-available" &&
        part.state !== "output-error"
    );
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECOVERED_TEXT_BYTES = 512 * 1_024;

function parseCanvasPendingTurn(value: unknown): CanvasPendingTurn | null {
  if (!isRecord(value) || !isRecord(value.message) || !isRecord(value.metadata)) return null;
  if (
    !hasExactKeys(value, ["message", "metadata"]) ||
    !hasExactKeys(value.metadata, []) ||
    !hasExactKeys(value.message, ["id", "role", "parts"]) ||
    typeof value.message.id !== "string" ||
    !UUID_PATTERN.test(value.message.id) ||
    value.message.role !== "user" ||
    !Array.isArray(value.message.parts) ||
    value.message.parts.length !== 1
  ) {
    return null;
  }
  const part = value.message.parts[0];
  if (
    !isRecord(part) ||
    !hasExactKeys(part, ["type", "text"]) ||
    part.type !== "text" ||
    typeof part.text !== "string" ||
    !part.text.trim() ||
    new TextEncoder().encode(part.text).byteLength > MAX_RECOVERED_TEXT_BYTES
  ) {
    return null;
  }
  return {
    message: value.message as unknown as UIMessage,
    metadata: {},
  };
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}
