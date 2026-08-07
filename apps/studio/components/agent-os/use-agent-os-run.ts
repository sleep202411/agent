"use client";

import { useCallback, useRef, useState } from "react";
import {
  agentOsApi,
  type AgentOsEvent,
  type AgentOsPendingApproval,
  type AgentOsRunStatus,
} from "@/lib/agent-os/api-client";

export interface AgentOsSessionState {
  status: "idle" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
  runId: string | null;
  conversationId: string | null;
  events: AgentOsEvent[];
  pendingApproval: AgentOsPendingApproval | null;
  assistantText: string | null;
  error: string | null;
}

const initial: AgentOsSessionState = {
  status: "idle",
  runId: null,
  conversationId: null,
  events: [],
  pendingApproval: null,
  assistantText: null,
  error: null,
};

function mapRunStatus(status: AgentOsRunStatus): AgentOsSessionState["status"] {
  if (status === "waiting_for_approval") return "waiting_for_approval";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "running" || status === "queued" || status === "paused") return "running";
  return "idle";
}

export function useAgentOsRun(projectId: string) {
  const [state, setState] = useState<AgentOsSessionState>(initial);
  const conversationRef = useRef<string | null>(null);

  const mergeResponse = useCallback(
    (response: {
      runId: string;
      status: AgentOsRunStatus;
      events?: AgentOsEvent[];
      pendingApproval?: AgentOsPendingApproval;
      assistantText?: string;
    }) => {
      setState((prev) => {
        const incoming = response.events ?? [];
        const bySeq = new Map(prev.events.map((e) => [e.sequence, e]));
        for (const event of incoming) {
          bySeq.set(event.sequence, event);
        }
        const events = [...bySeq.values()].sort((a, b) => a.sequence - b.sequence);
        return {
          status: mapRunStatus(response.status),
          runId: response.runId,
          conversationId: conversationRef.current,
          events,
          pendingApproval: response.pendingApproval ?? null,
          assistantText: response.assistantText ?? prev.assistantText,
          error: null,
        };
      });
    },
    []
  );

  const start = useCallback(
    async (input: { message: string; modelProfileId: string; scriptText?: string }) => {
      setState((prev) => ({
        ...prev,
        status: "running",
        error: null,
        assistantText: null,
        pendingApproval: null,
      }));
      try {
        const conversationId = conversationRef.current ?? crypto.randomUUID();
        conversationRef.current = conversationId;
        const response = await agentOsApi.startRun({
          projectId,
          message: input.message,
          modelProfileId: input.modelProfileId,
          conversationId,
          scriptText: input.scriptText,
        });
        mergeResponse(response);
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Agent OS run failed";
        setState((prev) => ({ ...prev, status: "failed", error: message }));
        throw error;
      }
    },
    [mergeResponse, projectId]
  );

  const resolveApproval = useCallback(
    async (input: { decision: "approve" | "reject"; modelProfileId: string }) => {
      const runId = state.runId;
      const conversationId = conversationRef.current;
      if (!runId || !conversationId) {
        throw new Error("No active run to approve");
      }
      setState((prev) => ({ ...prev, status: "running", error: null }));
      try {
        const response = await agentOsApi.resolveApproval({
          runId,
          decision: input.decision,
          projectId,
          conversationId,
          modelProfileId: input.modelProfileId,
        });
        mergeResponse(response);
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Approval failed";
        setState((prev) => ({ ...prev, status: "failed", error: message }));
        throw error;
      }
    },
    [mergeResponse, projectId, state.runId]
  );

  const reset = useCallback(() => {
    conversationRef.current = null;
    setState(initial);
  }, []);

  return { state, start, resolveApproval, reset };
}
