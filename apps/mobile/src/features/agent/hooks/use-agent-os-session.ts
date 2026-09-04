import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiRequestError } from "@/lib/api-client";
import { getLocale, t } from "@/i18n";

import {
  AGENT_OS_MOBILE_EXPERIENCE,
  agentOsApi,
  normalizePendingExternal,
  normalizePendingUserInput,
  type AgentOsDisplayLocale,
  type AgentOsEvent,
  type AgentOsModelPreferences,
  type AgentOsModelProfile,
  type AgentOsPendingApproval,
  type AgentOsPendingExternal,
  type AgentOsPendingUserInput,
  type AgentOsPendingUserInputQuestion,
  type AgentOsRunResponse,
  type AgentOsRunStatus,
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

const POLL_MS_ACTIVE = 400;
const POLL_MS_IDLE = 1_500;
const POLL_MAX_MS = 10 * 60_000;
const POLL_FAIL_LIMIT = 8;

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
  prompt?: { text: string; at: string } | null,
  hitl?: { text: string; at: string; decision: "approve" | "reject" } | null
): AgentMessage[] {
  const rebuilt = eventsToMessages(events, {
    runId,
    userText: prompt?.text,
    userAt: prompt?.at,
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
  const configured = isAgentOsId(projectId);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [runEvents, setRunEvents] = useState<AgentOsEvent[]>([]);
  const [session, setSession] = useState<SessionState>({
    conversationId: null,
    modelProfileId: null,
    runId: null,
    status: "idle",
    pendingApproval: null,
    pendingUserInput: null,
    pendingExternal: null,
  });
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<AgentOsModelProfile[]>([]);
  const [modelPreferences, setModelPreferences] = useState<AgentOsModelPreferences | null>(null);

  const conversationIdRef = useRef<string | null>(null);
  const modelProfileIdRef = useRef<string | null>(null);
  const lastSequenceRef = useRef(0);
  const eventsBufRef = useRef<AgentOsEvent[]>([]);
  const userPromptRef = useRef<{ text: string; at: string } | null>(null);
  const hitlReplyRef = useRef<{
    text: string;
    at: string;
    decision: "approve" | "reject";
  } | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  const stopPolling = useCallback(() => {
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
  }, []);

  const rebuildMessages = useCallback((runId: string) => {
    const hitl = hitlReplyRef.current;
    setMessages((prev) =>
      mergeRunMessages(prev, runId, eventsBufRef.current, userPromptRef.current, hitl)
    );
  }, []);

  const ingestRunPage = useCallback(
    (runId: string, page: AgentOsRunResponse) => {
      const incoming = page.events ?? [];
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
        status: page.status,
        ...live,
        error: undefined,
      }));
    },
    [rebuildMessages]
  );

  const pollRun = useCallback(
    async (runId: string, projectId: string) => {
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
        await new Promise((r) => setTimeout(r, delay));
      }

      if (!ac.signal.aborted) {
        setSession((prev) => ({
          ...prev,
          status: "error",
          error: "Poll timed out",
        }));
      }
      pollAbortRef.current = null;
    },
    [ingestRunPage, stopPolling]
  );

  const ensureModelProfile = useCallback(async () => {
    if (modelProfileIdRef.current) return modelProfileIdRef.current;
    if (models[0]?.id) {
      modelProfileIdRef.current = models[0].id;
      setSession((prev) => ({ ...prev, modelProfileId: models[0].id }));
      return models[0].id;
    }
    const { models: rows } = await agentOsApi.listModels();
    setModels(rows);
    const first = rows[0]?.id;
    if (!first) throw new Error("No model profiles from /agent-os/models");
    modelProfileIdRef.current = first;
    setSession((prev) => ({ ...prev, modelProfileId: first }));
    return first;
  }, [models]);

  const setModelProfileId = useCallback((id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    modelProfileIdRef.current = trimmed;
    setSession((prev) => ({ ...prev, modelProfileId: trimmed }));
  }, []);

  const restore = useCallback(
    async (conversationId?: string) => {
      if (!configured) {
        setSession((prev) => ({
          ...prev,
          status: "error",
          error: "Studio projectId is required",
        }));
        return;
      }
      setSession((prev) => ({ ...prev, status: "restoring" }));
      try {
        const history = await agentOsApi.getConversation(projectId, conversationId);
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
        setSession((prev) => ({
          ...prev,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [configured, projectId, pollRun]
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!configured) {
        setSession((prev) => ({
          ...prev,
          status: "error",
          error: "Studio projectId is required",
        }));
        return;
      }
      setSending(true);
      stopPolling();
      hitlReplyRef.current = null;
      try {
        const modelProfileId = await ensureModelProfile();
        if (!conversationIdRef.current) {
          conversationIdRef.current = newClientUuid();
        }
        const conversationId = conversationIdRef.current;
        const chapterId = chapterIdOpt || (await resolveDefaultChapterId(projectId));
        const clientSubmissionId = newClientUuid();
        const turnId = newClientUuid();
        const messageId = newClientUuid();
        const at = new Date().toISOString();
        userPromptRef.current = { text: trimmed, at };
        eventsBufRef.current = [];
        lastSequenceRef.current = 0;
        setRunEvents([]);
        setMessages((prev) => [
          ...prev,
          { id: `user:${messageId}`, role: "user", text: trimmed, createdAt: at },
        ]);

        const run = await agentOsApi.startRun({
          projectId,
          conversationId,
          clientSubmissionId,
          turnId,
          messageId,
          message: trimmed,
          modelProfileId,
          workbenchMode,
          workbenchContext: { chapterId, experience: AGENT_OS_MOBILE_EXPERIENCE },
          permissionMode: "smart",
        });

        const live = liveFromPage(run, run.events ?? []);
        setSession({
          conversationId,
          modelProfileId,
          runId: run.runId,
          status: run.status,
          ...live,
        });

        if (run.events?.length) {
          eventsBufRef.current = run.events;
          lastSequenceRef.current = Math.max(...run.events.map((e) => e.sequence));
          setRunEvents([...eventsBufRef.current]);
          setMessages((prev) =>
            mergeRunMessages(
              prev.filter((message) => message.id !== `user:${messageId}`),
              run.runId,
              eventsBufRef.current,
              { text: trimmed, at }
            )
          );
        }

        if (!isTerminalRunStatus(run.status) && !isWaitingForUserStatus(run.status)) {
          void pollRun(run.runId, projectId);
        }
      } catch (error) {
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
            id: `err:${Date.now()}`,
            role: "assistant",
            text: message,
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [configured, projectId, workbenchMode, chapterIdOpt, ensureModelProfile, pollRun, stopPolling]
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
      const transcriptText =
        responseText?.trim() ||
        (decision === "approve" ? t("agent.approved") : t("agent.rejected"));
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
        const next = await agentOsApi.resolveApproval({
          runId,
          decision,
          projectId: projectId,
          conversationId,
          modelProfileId,
          approvalId: pending.approvalId,
          responseId: newClientUuid(),
          responseText: transcriptText,
          locale: displayLocale(),
          experience: AGENT_OS_MOBILE_EXPERIENCE,
        });
        ingestRunPage(runId, next);
        if (!isTerminalRunStatus(next.status) && !isWaitingForUserStatus(next.status)) {
          void pollRun(runId, projectId);
        }
      } catch (error) {
        setSession((prev) => ({
          ...prev,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        setSending(false);
      }
    },
    [
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

      setSending(true);
      try {
        const next = await agentOsApi.answerUserInput({
          runId,
          projectId: projectId,
          conversationId,
          modelProfileId,
          requestId: pending.requestId,
          responseId: newClientUuid(),
          answers,
        });
        ingestRunPage(runId, next);
        if (!isTerminalRunStatus(next.status) && !isWaitingForUserStatus(next.status)) {
          void pollRun(runId, projectId);
        }
      } catch (error) {
        setSession((prev) => ({
          ...prev,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        setSending(false);
      }
    },
    [configured, ingestRunPage, projectId, pollRun, session.pendingUserInput, session.runId]
  );

  const cancel = useCallback(async () => {
    const runId = session.runId;
    if (!runId || !configured) return;
    stopPolling();
    try {
      await agentOsApi.cancelRun(runId, projectId, "user_stop");
      setSession((prev) => ({
        ...prev,
        status: "cancelled",
        pendingApproval: null,
        pendingUserInput: null,
        pendingExternal: null,
      }));
    } catch (error) {
      setSession((prev) => ({
        ...prev,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [configured, projectId, session.runId, stopPolling]);

  const newChat = useCallback(() => {
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
  }, [stopPolling]);

  useEffect(() => {
    if (!configured) return;
    void (async () => {
      try {
        const [{ models: rows }, preferences] = await Promise.all([
          agentOsApi.listModels(),
          agentOsApi.getModelPreferences(projectId).catch(() => null),
        ]);
        setModels(rows);
        if (preferences) setModelPreferences(preferences);
        const preferred = preferences?.chatModelProfileId;
        const fromPreference =
          preferred && rows.some((model) => model.id === preferred) ? preferred : null;
        const next = fromPreference ?? (!modelProfileIdRef.current ? rows[0]?.id : null);
        if (next) {
          modelProfileIdRef.current = next;
          setSession((prev) => ({ ...prev, modelProfileId: next }));
        }
      } catch {
        // Composer stays usable; send will surface model load errors.
      }
    })();
  }, [configured, projectId]);

  useEffect(() => () => stopPolling(), [stopPolling]);

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
    models,
    modelPreferences,
    session,
    sending,
    send,
    approve,
    answerUserInput,
    cancel,
    restore,
    newChat,
    setModelProfileId,
    setModelPreferences,
    stopPolling,
  };
}
