import { api } from "@/lib/api";

export type AgentOsRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentOsEvent {
  id: string;
  protocolVersion: string;
  sessionId: string;
  runId: string;
  conversationId: string;
  sequence: number;
  timestamp: string;
  type: string;
  data: Record<string, unknown>;
}

export interface AgentOsPendingApproval {
  kind: string;
  toolId: string;
  toolCallId: string;
  arguments: unknown;
  title: string;
  description: string;
  approvalId: string;
}

export interface AgentOsRunResponse {
  runId: string;
  status: AgentOsRunStatus;
  pendingApproval?: AgentOsPendingApproval;
  events?: AgentOsEvent[];
  assistantText?: string;
  characters?: unknown[];
}

export interface AgentOsStartRunInput {
  projectId: string;
  message: string;
  modelProfileId: string;
  conversationId?: string;
  scriptText?: string;
}

export interface AgentOsApprovalInput {
  runId: string;
  decision: "approve" | "reject";
  projectId: string;
  conversationId: string;
  modelProfileId: string;
}

/**
 * Browser client for Agent OS product gateway (`/aurora/agent-os/*`).
 * modelProfileId is always required — never defaulted client-side either.
 */
export class AgentOsApiClient {
  startRun(input: AgentOsStartRunInput, signal?: AbortSignal): Promise<AgentOsRunResponse> {
    if (!input.modelProfileId.trim()) {
      return Promise.reject(new Error("modelProfileId is required"));
    }
    return api.post<AgentOsRunResponse>("/aurora/agent-os/runs", {
      data: {
        projectId: input.projectId,
        message: input.message,
        modelProfileId: input.modelProfileId,
        conversationId: input.conversationId,
        scriptText: input.scriptText,
      },
      // Interactive agent turns can run minutes (model + tools + approval prep).
      timeout: 10 * 60_000,
      signal,
    });
  }

  resolveApproval(input: AgentOsApprovalInput, signal?: AbortSignal): Promise<AgentOsRunResponse> {
    if (!input.modelProfileId.trim()) {
      return Promise.reject(new Error("modelProfileId is required"));
    }
    return api.post<AgentOsRunResponse>(
      `/aurora/agent-os/runs/${encodeURIComponent(input.runId)}/approvals`,
      {
        data: {
          decision: input.decision,
          projectId: input.projectId,
          conversationId: input.conversationId,
          modelProfileId: input.modelProfileId,
        },
        timeout: 10 * 60_000,
        signal,
      }
    );
  }

  listEvents(
    runId: string,
    projectId: string,
    after = 0,
    signal?: AbortSignal
  ): Promise<{ runId: string; status: AgentOsRunStatus; events: AgentOsEvent[] }> {
    return api.get(`/aurora/agent-os/runs/${encodeURIComponent(runId)}/events`, {
      params: { projectId, after },
      signal,
    });
  }

  health(signal?: AbortSignal): Promise<{ ok: boolean; worker?: { ok: boolean } }> {
    return api.get("/aurora/agent-os/health", { signal });
  }
}

export const agentOsApi = new AgentOsApiClient();
