import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiRequestError } from "@/lib/api-client";
import { getLocale } from "@/i18n";

import {
  agentOsApi,
  normalizePendingUserInput,
  type AgentOsDisplayLocale,
  type AgentOsModelProfile,
  type AgentOsPendingApproval,
  type AgentOsPendingUserInput,
  type AgentOsPendingUserInputQuestion,
  type AgentOsRunStatus,
} from "../api/agent-os-api";
import {
  conversationRunsToMessages,
  deriveAgentActivity,
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
  events: import("../api/agent-os-api").AgentOsEvent[],
  prompt?: { text: string; at: string } | null
): AgentMessage[] {
  const rebuilt = eventsToMessages(events, {
    runId,
    userText: prompt?.text,
    userAt: prompt?.at,
  });
  const kept = previous.filter((message) => !messageBelongsToRun(message.id, runId));
  return [...kept, ...rebuilt];
}

function hitlFromPage(page: {
  status: string;
  pendingApproval?: AgentOsPendingApproval | null;
  pendingUserInput?: AgentOsPendingUserInput | AgentOsPendingUserInputQuestion[] | null;
}) {
  return {
    pendingApproval: page.status === "waiting_for_approval" ? (page.pendingApproval ?? null) : null,
    pendingUserInput:
      page.status === "waiting_for_input" ? normalizePendingUserInput(page.pendingUserInput) : null,
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
  const [runEvents, setRunEvents] = useState<import("../api/agent-os-api").AgentOsEvent[]>([]);
  const [session, setSession] = useState<SessionState>({
    conversationId: null,
    modelProfileId: null,
    runId: null,
    status: "idle",
    pendingApproval: null,
    pendingUserInput: null,
  });
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<AgentOsModelProfile[]>([]);

  const conversationIdRef = useRef<string | null>(null);
  const modelProfileIdRef = useRef<string | null>(null);
  const lastSequenceRef = useRef(0);
  const eventsBufRef = useRef<import("../api/agent-os-api").AgentOsEvent[]>([]);
  const userPromptRef = useRef<{ text: string; at: string } | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  const stopPolling = useCallback(() => {
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
  }, []);

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
          if (page.events?.length) {
            const fresh = page.events.filter((e) => e.sequence > lastSequenceRef.current);
            if (fresh.length) {
              eventsBufRef.current = [...eventsBufRef.current, ...fresh];
              lastSequenceRef.current = Math.max(
                lastSequenceRef.current,
                ...fresh.map((e) => e.sequence)
              );
              setRunEvents([...eventsBufRef.current]);
              const prompt = userPromptRef.current;
              setMessages((prev) => mergeRunMessages(prev, runId, eventsBufRef.current, prompt));
            }
          }

          const hitl = hitlFromPage(page);
          setSession((prev) => ({
            ...prev,
            runId,
            status: page.status,
            ...hitl,
            error: undefined,
          }));

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
    [stopPolling]
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
        setMessages(conversationRunsToMessages(history.runs));
        if (last?.modelProfileId) {
          modelProfileIdRef.current = last.modelProfileId;
        }
        const status = (last?.status as AgentOsRunStatus) ?? "idle";
        setSession({
          conversationId: history.conversationId,
          modelProfileId: modelProfileIdRef.current,
          runId: last?.runId ?? null,
          status,
          pendingApproval:
            status === "waiting_for_approval" ? (last?.pendingApproval ?? null) : null,
          pendingUserInput:
            status === "waiting_for_input"
              ? normalizePendingUserInput(last?.pendingUserInput)
              : null,
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
          workbenchContext: { chapterId },
          permissionMode: "smart",
        });

        const hitl = hitlFromPage(run);
        setSession({
          conversationId,
          modelProfileId,
          runId: run.runId,
          status: run.status,
          ...hitl,
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
    async (decision: "approve" | "reject") => {
      const runId = session.runId;
      const conversationId = conversationIdRef.current;
      const modelProfileId = modelProfileIdRef.current;
      const pending = session.pendingApproval;
      if (!runId || !conversationId || !modelProfileId || !pending?.approvalId || !configured) {
        return;
      }

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
          responseText: decision === "approve" ? "Approved" : "Rejected",
          locale: displayLocale(),
        });
        const hitl = hitlFromPage(next);
        setSession((prev) => ({
          ...prev,
          status: next.status,
          ...hitl,
        }));
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
    [configured, projectId, pollRun, session.pendingApproval, session.runId]
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
        const hitl = hitlFromPage(next);
        setSession((prev) => ({
          ...prev,
          status: next.status,
          ...hitl,
        }));
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
    [configured, projectId, pollRun, session.pendingUserInput, session.runId]
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
      }));
    } catch (error) {
      setSession((prev) => ({
        ...prev,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [configured, projectId, session.runId, stopPolling]);

  useEffect(() => {
    if (!configured) return;
    void (async () => {
      try {
        const { models: rows } = await agentOsApi.listModels();
        setModels(rows);
        if (!modelProfileIdRef.current && rows[0]?.id) {
          modelProfileIdRef.current = rows[0].id;
          setSession((prev) =>
            prev.modelProfileId ? prev : { ...prev, modelProfileId: rows[0].id }
          );
        }
      } catch {
        // Composer stays usable; send will surface model load errors.
      }
    })();
  }, [configured]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const activity = useMemo(
    () => deriveAgentActivity(runEvents, session.status),
    [runEvents, session.status]
  );

  return {
    configured: configured,
    projectId: projectId,
    activity,
    messages,
    models,
    session,
    sending,
    send,
    approve,
    answerUserInput,
    cancel,
    restore,
    setModelProfileId,
    stopPolling,
  };
}
