import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ApiRequestError } from "@/lib/api-client";
import { getLocale, t } from "@/i18n";

import {
  AGENT_OS_MOBILE_EXPERIENCE,
  agentOsApi,
  normalizePendingExternal,
  normalizePendingUserInput,
  type AgentOsDisplayLocale,
  type AgentOsEvent,
  type AgentOsPendingApproval,
  type AgentOsPendingExternal,
  type AgentOsPendingUserInput,
  type AgentOsPendingUserInputQuestion,
  type AgentOsRunResponse,
  type AgentOsRunStatus,
  type AgentOsPermissionMode,
} from "../api/agent-os-api";
import {
  conversationRunsToMessages,
  currentTurnIsStreaming,
  deriveAgentActivity,
  derivePendingExternalFromEvents,
  eventsToMessages,
  isTerminalRunStatus,
  isWaitingForUserStatus,
  newClientUuid,
} from "../lib/agent-os-events";
import { isAgentOsId } from "../lib/ids";
import { resolveDefaultChapterId } from "../api/studio-projects-api";
import type { AgentMessage } from "../types";
import { useStoryRequestScope } from "./use-story-request-scope";

const POLL_MS_ACTIVE = 400;
const POLL_MS_IDLE = 1_500;
const POLL_MAX_MS = 10 * 60_000;
const POLL_FAIL_LIMIT = 8;

export type AgentOsSendExtras = {
  attachmentIds?: string[];
  attachmentNames?: string[];
  skillIds?: string[];
  projectSkillInstallationIds?: string[];
  disabledDefaultSkillInstallationIds?: string[];
  permissionMode?: AgentOsPermissionMode;
};

export type UseAgentOsSessionOptions = {
  projectId: string;
  workbenchMode: string;
  /** Story chapter for `workbenchMode: "story"` (PC FizzAgent). */
  chapterId?: string;
};

type SessionState = {
  conversationId: string | null;
  modelProfileId: string | null;
  runId: string | null;
  status: AgentOsRunStatus | "idle" | "restoring" | "error";
  pendingApproval: AgentOsPendingApproval | null;
  pendingUserInput: AgentOsPendingUserInput | null;
  pendingExternal: AgentOsPendingExternal | null;
  error?: string;
};

function emptySession(): SessionState {
  return {
    conversationId: null,
    modelProfileId: null,
    runId: null,
    status: "idle",
    pendingApproval: null,
    pendingUserInput: null,
    pendingExternal: null,
  };
}

function pollDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}

function displayLocale(): AgentOsDisplayLocale {
  const locale = getLocale();
  if (locale === "zh-CN" || locale === "zh-HK") return locale;
  return "en-US";
}

function messageBelongsToRun(messageId: string, runId: string): boolean {
  return (
    messageId.includes(`:${runId}:`) ||
    messageId === `user:${runId}` ||
    messageId.startsWith(`asst:${runId}:`)
  );
}

function mergeRunMessages(
  previous: AgentMessage[],
  runId: string,
  events: AgentOsEvent[],
  prompt?: { text: string; at: string; attachmentNames?: string[] } | null,
  hitl?: { text: string; at: string; decision: "approve" | "reject" } | null
): AgentMessage[] {
  const rebuilt = eventsToMessages(events, {
    runId,
    userText: prompt?.text,
    userAt: prompt?.at,
    userAttachmentNames: prompt?.attachmentNames,
    hitlText: hitl?.text,
    hitlAt: hitl?.at,
    hitlDecision: hitl?.decision,
  });
  const kept = previous.filter((message) => !messageBelongsToRun(message.id, runId));
  return [...kept, ...rebuilt];
}

function liveFromPage(
  page: {
    status: string;
    pendingApproval?: AgentOsPendingApproval | null;
    pendingUserInput?: AgentOsPendingUserInput | AgentOsPendingUserInputQuestion[] | null;
    pendingExternal?: AgentOsPendingExternal | null;
  },
  events: AgentOsEvent[]
) {
  return {
    pendingApproval: page.status === "waiting_for_approval" ? (page.pendingApproval ?? null) : null,
    pendingUserInput:
      page.status === "waiting_for_input" ? normalizePendingUserInput(page.pendingUserInput) : null,
    pendingExternal:
      page.status === "waiting_for_external"
        ? (normalizePendingExternal(page.pendingExternal) ??
          derivePendingExternalFromEvents(events))
        : null,
  };
}

/**
 * Agent OS turn lifecycle: start → poll events → approve / answer / cancel.
 * `projectId` is a Story Studio StoryProject id (PC FizzAgent).
 */
export function useAgentOsSession(options: UseAgentOsSessionOptions) {
  const projectId = options.projectId.trim();
  const workbenchMode = options.workbenchMode.trim() || "story";
  const chapterIdOpt = options.chapterId?.trim() || "";
  const scope = useStoryRequestScope(JSON.stringify([projectId, chapterIdOpt, workbenchMode]));
  const configured = isAgentOsId(projectId);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [runEvents, setRunEvents] = useState<AgentOsEvent[]>([]);
  const [session, setSession] = useState<SessionState>(emptySession);
  const [sending, setSending] = useState(false);

  const conversationIdRef = useRef<string | null>(null);
  const modelProfileIdRef = useRef<string | null>(null);
  const lastSequenceRef = useRef(0);
  const eventsBufRef = useRef<AgentOsEvent[]>([]);
  const userPromptRef = useRef<{
    text: string;
    at: string;
    attachmentNames?: string[];
  } | null>(null);
  const hitlReplyRef = useRef<{
    text: string;
    at: string;
    decision: "approve" | "reject";
  } | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const operationRef = useRef<AbortController | null>(null);
  const currentSessionRef = useRef(session);
  useLayoutEffect(() => {
    currentSessionRef.current = session;
  }, [session]);
  const sendRetryRef = useRef<{
    key: string;
    clientSubmissionId: string;
    turnId: string;
    messageId: string;
    at: string;
  } | null>(null);
  const approvalRetryRef = useRef<{ key: string; id: string } | null>(null);
  const inputRetryRef = useRef<{ key: string; id: string } | null>(null);
  const scopeRef = useRef<typeof scope | null>(scope);
  const [previousScope, setPreviousScope] = useState(scope);
  if (previousScope !== scope) {
    setPreviousScope(scope);
    setMessages([]);
    setRunEvents([]);
    setSession(emptySession());
    setSending(false);
  }
  useLayoutEffect(() => {
    scopeRef.current = scope;
    sendRetryRef.current = null;
    approvalRetryRef.current = null;
    inputRetryRef.current = null;
    conversationIdRef.current = null;
    modelProfileIdRef.current = null;
    lastSequenceRef.current = 0;
    eventsBufRef.current = [];
    userPromptRef.current = null;
    hitlReplyRef.current = null;
    return () => {
      scopeRef.current = null;
      operationRef.current?.abort();
      operationRef.current = null;
      pollAbortRef.current?.abort();
      pollAbortRef.current = null;
    };
  }, [scope]);
  const isCurrent = useCallback(
    (operation: AbortController) =>
      scopeRef.current === scope && operationRef.current === operation && !operation.signal.aborted,
    [scope]
  );
  const beginOperation = useCallback(() => {
    if (scopeRef.current !== scope || !scope.enabled || operationRef.current) return null;
    const operation = new AbortController();
    operationRef.current = operation;
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    setSending(true);
    return operation;
  }, [scope]);
  const finishOperation = useCallback(
    (operation: AbortController) => {
      if (isCurrent(operation)) {
        operationRef.current = null;
        setSending(false);
      }
    },
    [isCurrent]
  );

  const stopPolling = useCallback(() => {
    if (scopeRef.current !== scope) return;
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
  }, [scope]);

  const rebuildMessages = useCallback((runId: string) => {
    const hitl = hitlReplyRef.current;
    setMessages((prev) =>
      mergeRunMessages(prev, runId, eventsBufRef.current, userPromptRef.current, hitl)
    );
  }, []);

  const ingestRunPage = useCallback(
    (runId: string, page: AgentOsRunResponse) => {
      const incoming = page.events ?? [];
      const acceptedModel = incoming.find((event) => event.type === "RunStarted")?.data
        .modelProfileId;
      if (typeof acceptedModel === "string") modelProfileIdRef.current = acceptedModel;
      const fresh = incoming.filter((event) => event.sequence > lastSequenceRef.current);
      if (fresh.length) {
        eventsBufRef.current = [...eventsBufRef.current, ...fresh];
        lastSequenceRef.current = Math.max(
          lastSequenceRef.current,
          ...fresh.map((event) => event.sequence)
        );
        setRunEvents([...eventsBufRef.current]);
      }
      const hitlText = hitlReplyRef.current?.text;
      if (
        hitlText &&
        eventsBufRef.current.some(
          (event) =>
            event.type === "UserMessage" &&
            typeof event.data.text === "string" &&
            event.data.text.trim() === hitlText
        )
      ) {
        hitlReplyRef.current = null;
      }
      rebuildMessages(runId);
      const live = liveFromPage(page, eventsBufRef.current);
      setSession((prev) => ({
        ...prev,
        runId,
        modelProfileId: modelProfileIdRef.current,
        status: page.status,
        ...live,
        error: undefined,
      }));
    },
    [rebuildMessages]
  );

  const pollRun = useCallback(
    async (runId: string, projectId: string) => {
      if (scopeRef.current !== scope) return;
      stopPolling();
      const ac = new AbortController();
      pollAbortRef.current = ac;
      const started = Date.now();
      let failures = 0;

      while (!ac.signal.aborted && Date.now() - started < POLL_MAX_MS) {
        try {
          const page = await agentOsApi.listEvents(
            runId,
            projectId,
            lastSequenceRef.current,
            ac.signal
          );
          if (ac.signal.aborted || pollAbortRef.current !== ac || scopeRef.current !== scope)
            return;
          failures = 0;
          ingestRunPage(runId, page);

          if (isTerminalRunStatus(page.status) || isWaitingForUserStatus(page.status)) {
            pollAbortRef.current = null;
            return;
          }
        } catch (error) {
          if (ac.signal.aborted) return;
          failures += 1;
          if (failures >= POLL_FAIL_LIMIT) {
            setSession((prev) => ({
              ...prev,
              status: "error",
              error: error instanceof Error ? error.message : String(error),
            }));
            pollAbortRef.current = null;
            return;
          }
        }

        const delay = failures > 0 ? Math.min(POLL_MS_IDLE * 2 ** failures, 5_000) : POLL_MS_ACTIVE;
        await pollDelay(delay, ac.signal);
      }

      if (!ac.signal.aborted) {
        setSession((prev) => ({
          ...prev,
          status: "error",
          error: "Poll timed out",
        }));
      }
      if (pollAbortRef.current === ac) pollAbortRef.current = null;
    },
    [ingestRunPage, stopPolling, scope]
  );

  const ensureModelProfile = useCallback(async (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (modelProfileIdRef.current) return modelProfileIdRef.current;
    const { mobileDefaultModelProfileId } = await agentOsApi.listModels(signal);
    signal.throwIfAborted();
    if (!mobileDefaultModelProfileId) throw new Error("No mobile default model configured");
    modelProfileIdRef.current = mobileDefaultModelProfileId;
    setSession((prev) => ({ ...prev, modelProfileId: mobileDefaultModelProfileId }));
    return mobileDefaultModelProfileId;
  }, []);

  const restore = useCallback(
    async (conversationId?: string) => {
      if (scopeRef.current !== scope || !scope.enabled) return;
      if (!configured) {
        setSession((prev) => ({
          ...prev,
          status: "error",
          error: "Studio projectId is required",
        }));
        return;
      }
      const operation = beginOperation();
      if (!operation) return;
      setSession((prev) => ({ ...prev, status: "restoring" }));
      try {
        const history = await agentOsApi.getConversation(
          projectId,
          conversationId,
          operation.signal
        );
        if (!isCurrent(operation)) return;
        conversationIdRef.current = history.conversationId;
        const last = history.runs.at(-1);
        eventsBufRef.current = last?.events ?? [];
        lastSequenceRef.current = eventsBufRef.current.reduce(
          (max, e) => Math.max(max, e.sequence),
          0
        );
        setRunEvents([...eventsBufRef.current]);
        userPromptRef.current = null;
        hitlReplyRef.current = null;
        setMessages(conversationRunsToMessages(history.runs));
        if (last?.modelProfileId) {
          modelProfileIdRef.current = last.modelProfileId;
        }
        const status = (last?.status as AgentOsRunStatus) ?? "idle";
        const lastEvents = last?.events ?? [];
        setSession({
          conversationId: history.conversationId,
          modelProfileId: modelProfileIdRef.current,
          runId: last?.runId ?? null,
          status,
          ...liveFromPage({ ...last, status }, lastEvents),
        });
        if (last && !isTerminalRunStatus(last.status) && !isWaitingForUserStatus(last.status)) {
          void pollRun(last.runId, projectId);
        }
      } catch (error) {
        if (!isCurrent(operation)) return;
        setSession((prev) => ({
          ...prev,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        finishOperation(operation);
      }
    },
    [beginOperation, isCurrent, finishOperation, configured, projectId, pollRun, scope]
  );

  const send = useCallback(
    async (text: string, extras?: AgentOsSendExtras): Promise<boolean> => {
      if (scopeRef.current !== scope || !scope.enabled) return false;
      const trimmed = text.trim();
      const attachmentIds = extras?.attachmentIds?.filter((id) => id.trim()) ?? [];
      const attachmentNames = extras?.attachmentNames?.filter((name) => name.trim()) ?? [];
      if (!trimmed && attachmentIds.length === 0) return false;
      if (!configured) {
        setSession((prev) => ({
          ...prev,
          status: "error",
          error: "Studio projectId is required",
        }));
        return false;
      }
      const operation = beginOperation();
      if (!operation) return false;
      stopPolling();
      hitlReplyRef.current = null;
      try {
        const modelProfileId = await ensureModelProfile(operation.signal);
        if (!isCurrent(operation)) return false;
        if (!conversationIdRef.current) {
          conversationIdRef.current = newClientUuid();
        }
        const conversationId = conversationIdRef.current;
        const chapterId =
          chapterIdOpt || (await resolveDefaultChapterId(projectId, operation.signal));
        if (!isCurrent(operation)) return false;
        const retryKey = JSON.stringify({
          projectId,
          conversationId,
          chapterId,
          modelProfileId,
          workbenchMode,
          message: trimmed,
          attachmentIds: [...new Set(attachmentIds)],
          permissionMode: extras?.permissionMode ?? "smart",
          skillIds: [...new Set(extras?.skillIds ?? [])].sort(),
          projectSkillInstallationIds: [
            ...new Set(extras?.projectSkillInstallationIds ?? []),
          ].sort(),
          disabledDefaultSkillInstallationIds: [
            ...new Set(extras?.disabledDefaultSkillInstallationIds ?? []),
          ].sort(),
        });
        if (sendRetryRef.current?.key !== retryKey)
          sendRetryRef.current = {
            key: retryKey,
            clientSubmissionId: newClientUuid(),
            turnId: newClientUuid(),
            messageId: newClientUuid(),
            at: new Date().toISOString(),
          };
        const { clientSubmissionId, turnId, messageId, at } = sendRetryRef.current;
        userPromptRef.current = {
          text: trimmed,
          at,
          attachmentNames: attachmentNames.length > 0 ? attachmentNames : undefined,
        };
        eventsBufRef.current = [];
        lastSequenceRef.current = 0;
        setRunEvents([]);
        setMessages((prev) => [
          ...prev.filter(
            (message) => message.id !== `user:${messageId}` && message.id !== `err:${messageId}`
          ),
          {
            id: `user:${messageId}`,
            role: "user",
            text: trimmed,
            attachmentNames: attachmentNames.length > 0 ? attachmentNames : undefined,
            createdAt: at,
          },
        ]);

        const run = await agentOsApi.startRun(
          {
            projectId,
            conversationId,
            clientSubmissionId,
            turnId,
            messageId,
            message: trimmed,
            modelProfileId,
            workbenchMode,
            workbenchContext: { chapterId, experience: AGENT_OS_MOBILE_EXPERIENCE },
            permissionMode: extras?.permissionMode ?? "smart",
            attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
            skillIds: extras?.skillIds,
            projectSkillInstallationIds: extras?.projectSkillInstallationIds,
            disabledDefaultSkillInstallationIds: extras?.disabledDefaultSkillInstallationIds,
          },
          operation.signal
        );
        if (!isCurrent(operation)) return false;

        sendRetryRef.current = null;
        setSession((prev) => ({ ...prev, conversationId }));
        setMessages((prev) => prev.filter((message) => message.id !== `user:${messageId}`));
        ingestRunPage(run.runId, run);

        if (!isTerminalRunStatus(run.status) && !isWaitingForUserStatus(run.status)) {
          void pollRun(run.runId, projectId);
        }
        return true;
      } catch (error) {
        if (!isCurrent(operation)) return false;
        const message =
          error instanceof ApiRequestError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        setSession((prev) => ({ ...prev, status: "error", error: message }));
        setMessages((prev) => [
          ...prev,
          {
            id: `err:${sendRetryRef.current?.messageId ?? Date.now()}`,
            role: "assistant",
            text: message,
            createdAt: new Date().toISOString(),
          },
        ]);
        return false;
      } finally {
        finishOperation(operation);
      }
    },
    [
      beginOperation,
      isCurrent,
      finishOperation,
      configured,
      projectId,
      workbenchMode,
      chapterIdOpt,
      ensureModelProfile,
      scope,
      ingestRunPage,
      pollRun,
      stopPolling,
    ]
  );

  const approve = useCallback(
    async (decision: "approve" | "reject", responseText?: string) => {
      const runId = session.runId;
      const conversationId = conversationIdRef.current;
      const modelProfileId = modelProfileIdRef.current;
      const pending = session.pendingApproval;
      if (!runId || !conversationId || !modelProfileId || !pending?.approvalId || !configured) {
        return;
      }
      if (
        currentSessionRef.current.runId !== runId ||
        currentSessionRef.current.pendingApproval?.approvalId !== pending.approvalId
      )
        return;
      const operation = beginOperation();
      if (!operation) return;
      const transcriptText =
        responseText?.trim() ||
        (decision === "approve" ? t("agent.approved") : t("agent.rejected"));
      const locale = displayLocale();
      const retryKey = JSON.stringify([
        runId,
        pending.approvalId,
        decision,
        transcriptText,
        locale,
      ]);
      if (approvalRetryRef.current?.key !== retryKey)
        approvalRetryRef.current = { key: retryKey, id: newClientUuid() };
      const responseId = approvalRetryRef.current.id;
      const at = new Date().toISOString();
      hitlReplyRef.current = { text: transcriptText, at, decision };
      rebuildMessages(runId);
      setSession((prev) => ({
        ...prev,
        status: "running",
        pendingApproval: null,
      }));

      setSending(true);
      try {
        const next = await agentOsApi.resolveApproval(
          {
            runId,
            decision,
            projectId: projectId,
            conversationId,
            modelProfileId,
            approvalId: pending.approvalId,
            responseId,
            responseText: transcriptText,
            locale,
            experience: AGENT_OS_MOBILE_EXPERIENCE,
          },
          operation.signal
        );
        if (!isCurrent(operation)) return;
        approvalRetryRef.current = null;
        ingestRunPage(runId, next);
        if (!isTerminalRunStatus(next.status) && !isWaitingForUserStatus(next.status)) {
          void pollRun(runId, projectId);
        }
      } catch (error) {
        if (!isCurrent(operation)) return;
        hitlReplyRef.current = null;
        rebuildMessages(runId);
        setSession((prev) => ({
          ...prev,
          status: "waiting_for_approval",
          pendingApproval: pending,
          error: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        finishOperation(operation);
      }
    },
    [
      beginOperation,
      isCurrent,
      finishOperation,
      configured,
      ingestRunPage,
      projectId,
      pollRun,
      rebuildMessages,
      session.pendingApproval,
      session.runId,
    ]
  );

  const answerUserInput = useCallback(
    async (answers: Record<string, string>) => {
      const runId = session.runId;
      const conversationId = conversationIdRef.current;
      const modelProfileId = modelProfileIdRef.current;
      const pending = session.pendingUserInput;
      if (!runId || !conversationId || !modelProfileId || !pending?.requestId || !configured) {
        return;
      }

      if (
        currentSessionRef.current.runId !== runId ||
        currentSessionRef.current.pendingUserInput?.requestId !== pending.requestId
      )
        return;
      const operation = beginOperation();
      if (!operation) return;
      const retryKey = JSON.stringify([
        runId,
        pending.requestId,
        Object.entries(answers).sort(([a], [b]) => a.localeCompare(b)),
      ]);
      if (inputRetryRef.current?.key !== retryKey)
        inputRetryRef.current = { key: retryKey, id: newClientUuid() };
      const responseId = inputRetryRef.current.id;
      setSending(true);
      try {
        const next = await agentOsApi.answerUserInput(
          {
            runId,
            projectId: projectId,
            conversationId,
            modelProfileId,
            requestId: pending.requestId,
            responseId,
            answers,
          },
          operation.signal
        );
        if (!isCurrent(operation)) return;
        inputRetryRef.current = null;
        ingestRunPage(runId, next);
        if (!isTerminalRunStatus(next.status) && !isWaitingForUserStatus(next.status)) {
          void pollRun(runId, projectId);
        }
      } catch (error) {
        if (!isCurrent(operation)) return;
        setSession((prev) => ({
          ...prev,
          status: "waiting_for_input",
          pendingUserInput: pending,
          error: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        finishOperation(operation);
      }
    },
    [
      beginOperation,
      isCurrent,
      finishOperation,
      configured,
      ingestRunPage,
      projectId,
      pollRun,
      session.pendingUserInput,
      session.runId,
    ]
  );

  const cancel = useCallback(async () => {
    const runId = session.runId;
    if (!runId || !configured || currentSessionRef.current.runId !== runId) return;
    const operation = beginOperation();
    if (!operation) return;
    stopPolling();
    try {
      await agentOsApi.cancelRun(runId, projectId, "user_stop", operation.signal);
      if (!isCurrent(operation)) return;
      setSession((prev) => ({
        ...prev,
        status: "cancelled",
        pendingApproval: null,
        pendingUserInput: null,
        pendingExternal: null,
      }));
    } catch (error) {
      if (!isCurrent(operation)) return;
      setSession((prev) => ({
        ...prev,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      finishOperation(operation);
    }
  }, [
    beginOperation,
    isCurrent,
    finishOperation,
    configured,
    projectId,
    session.runId,
    stopPolling,
  ]);

  const newChat = useCallback(() => {
    if (scopeRef.current !== scope) return;
    operationRef.current?.abort();
    operationRef.current = null;
    approvalRetryRef.current = null;
    inputRetryRef.current = null;
    sendRetryRef.current = null;
    currentSessionRef.current = emptySession();
    stopPolling();
    conversationIdRef.current = null;
    lastSequenceRef.current = 0;
    eventsBufRef.current = [];
    userPromptRef.current = null;
    hitlReplyRef.current = null;
    setRunEvents([]);
    setMessages([]);
    setSending(false);
    setSession({
      conversationId: null,
      modelProfileId: modelProfileIdRef.current,
      runId: null,
      status: "idle",
      pendingApproval: null,
      pendingUserInput: null,
      pendingExternal: null,
    });
  }, [stopPolling, scope]);

  const activity = useMemo(
    () => deriveAgentActivity(runEvents, session.status, session.pendingExternal),
    [runEvents, session.pendingExternal, session.status]
  );
  const assistantStreaming = useMemo(() => currentTurnIsStreaming(runEvents), [runEvents]);

  return {
    configured: configured,
    projectId: projectId,
    activity,
    assistantStreaming,
    pendingExternal: session.pendingExternal,
    messages,
    session,
    sending,
    send,
    approve,
    answerUserInput,
    cancel,
    restore,
    newChat,
    stopPolling,
  };
}
