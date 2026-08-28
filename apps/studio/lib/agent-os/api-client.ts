import { api, ApiRequestError } from "@/lib/api";

export type AgentOsRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "waiting_for_external"
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
  /** Protocol v1.1+: the Assistant UI turn this decision resumes. */
  turnId?: string;
}

export interface AgentOsUserInputOption {
  value: string;
  label: string;
  description?: string;
}

export interface AgentOsUserInputQuestion {
  id: string;
  header: string;
  question: string;
  options: AgentOsUserInputOption[];
}

export interface AgentOsPendingUserInput {
  kind: "user_input";
  requestId: string;
  toolCallId: string;
  formId?: string;
  knownValues?: Record<string, string>;
  questions: AgentOsUserInputQuestion[];
  /** Protocol v1.1+: the Assistant UI turn which requested the answer. */
  turnId?: string;
  /** Model-authored acknowledgement to begin the resumed Assistant turn. */
  resumeAcknowledgement?: string;
}

/** Durable domain job which owns the open turn while the Agent worker is paused. */
export interface AgentOsPendingExternal {
  kind: "external_job";
  jobId: string;
  startedMessage: string;
  turnId: string;
  toolCallId: string;
  toolId: string;
}

export interface AgentOsRunResponse {
  runId: string;
  status: AgentOsRunStatus;
  pendingApproval?: AgentOsPendingApproval;
  pendingUserInput?: AgentOsPendingUserInput;
  pendingExternal?: AgentOsPendingExternal;
  events?: AgentOsEvent[];
  assistantText?: string;
}

export interface AgentOsAttachmentSummary {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: "ready" | "failed";
  sectionCount: number;
  errorMessage?: string | null;
  createdAt: string;
}

/** Codex-style autonomy for tool writes. */
export type AgentOsPermissionMode = "ask" | "smart" | "full";

export type AgentOsWorkbenchMode = "storyboard" | "canvas" | "brief" | "story";
export type AgentOsWorkbenchContext = Readonly<Record<string, string>>;

export interface AgentOsStartRunInput {
  projectId: string;
  conversationId: string;
  clientSubmissionId: string;
  turnId: string;
  messageId: string;
  message: string;
  modelProfileId: string;
  /** Uploaded attachment ids (file upload API) for this turn. */
  attachmentIds?: string[];
  permissionMode?: AgentOsPermissionMode;
  /** Trusted product workbench mode. */
  workbenchMode: AgentOsWorkbenchMode;
  /** Server validates this selection against the project before the run starts. */
  workbenchContext?: AgentOsWorkbenchContext;
  /** Per-turn skill ids (composer). Mounted when registered in skill runtime. */
  skillIds?: string[];
  /** Installed project Skills added for this turn. */
  projectSkillInstallationIds?: string[];
  /** Installed project defaults removed for this turn. */
  disabledDefaultSkillInstallationIds?: string[];
}

export interface AgentOsApprovalInput {
  runId: string;
  approvalId: string;
  /** Stable UUID reused when this semantic decision is retried. */
  responseId: string;
  decision: "approve" | "reject";
  /** User-visible transcript copy only; the structured decision is authoritative. */
  responseText: string;
  /** Used by the server to own durable Assistant acknowledgement copy. */
  locale: "en-US" | "zh-CN" | "zh-HK";
  projectId: string;
  conversationId: string;
  modelProfileId: string;
  permissionMode?: AgentOsPermissionMode;
  experience?: "mobile_h5";
}

export interface AgentOsUserInputResponse {
  runId: string;
  requestId: string;
  /** Stable UUID for this semantic answer; reused by transport retries. */
  responseId: string;
  answers: Record<string, string>;
  projectId: string;
  conversationId: string;
  modelProfileId: string;
  permissionMode?: AgentOsPermissionMode;
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
    if (input.message.length > 20_000) {
      return Promise.reject(new Error("message must contain at most 20,000 characters"));
    }
    if (!input.message.trim() && !input.attachmentIds?.length) {
      return Promise.reject(new Error("message or attachmentIds is required"));
    }
    return api.post<AgentOsRunResponse>("/aurora/agent-os/runs", {
      data: {
        projectId: input.projectId,
        conversationId: input.conversationId,
        clientSubmissionId: input.clientSubmissionId,
        turnId: input.turnId,
        messageId: input.messageId,
        message: input.message,
        modelProfileId: input.modelProfileId,
        attachmentIds: input.attachmentIds,
        permissionMode: input.permissionMode,
        workbenchMode: input.workbenchMode,
        workbenchContext: input.workbenchContext,
        skillIds: input.skillIds,
        projectSkillInstallationIds: input.projectSkillInstallationIds,
        disabledDefaultSkillInstallationIds: input.disabledDefaultSkillInstallationIds,
      },
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
          approvalId: input.approvalId,
          responseId: input.responseId,
          decision: input.decision,
          responseText: input.responseText,
          locale: input.locale,
          projectId: input.projectId,
          conversationId: input.conversationId,
          modelProfileId: input.modelProfileId,
          permissionMode: input.permissionMode,
          experience: input.experience,
        },
        timeout: 10 * 60_000,
        signal,
      }
    );
  }

  resolveUserInput(
    input: AgentOsUserInputResponse,
    signal?: AbortSignal
  ): Promise<AgentOsRunResponse> {
    if (!input.modelProfileId.trim()) {
      return Promise.reject(new Error("modelProfileId is required"));
    }
    return api.post<AgentOsRunResponse>(
      `/aurora/agent-os/runs/${encodeURIComponent(input.runId)}/user-input`,
      {
        data: {
          requestId: input.requestId,
          responseId: input.responseId,
          answers: input.answers,
          projectId: input.projectId,
          conversationId: input.conversationId,
          modelProfileId: input.modelProfileId,
          permissionMode: input.permissionMode,
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
  ): Promise<{
    runId: string;
    status: AgentOsRunStatus;
    events: AgentOsEvent[];
    pendingApproval?: AgentOsPendingApproval | null;
    pendingUserInput?: AgentOsPendingUserInput | null;
    pendingExternal?: AgentOsPendingExternal | null;
    assistantText?: string | null;
    source?: string;
  }> {
    return api.get(`/aurora/agent-os/runs/${encodeURIComponent(runId)}/events`, {
      params: { projectId, after },
      signal,
    });
  }

  /** Abort an in-flight worker run (Stop button). */
  cancelRun(
    runId: string,
    projectId: string,
    reason?: string,
    signal?: AbortSignal
  ): Promise<AgentOsRunResponse> {
    return api.post<AgentOsRunResponse>(
      `/aurora/agent-os/runs/${encodeURIComponent(runId)}/cancel`,
      {
        data: { projectId, reason },
        timeout: 15_000,
        signal,
      }
    );
  }

  /**
   * Short-lived Ably TokenRequest for one conversation channel.
   * Browser exchanges it via Realtime authCallback (never sees the root key).
   */
  realtimeToken(
    projectId: string,
    conversationId: string,
    signal?: AbortSignal
  ): Promise<{
    channel: string;
    ttlMs: number;
    tokenRequest: {
      keyName: string;
      clientId: string;
      capability: string;
      timestamp: number;
      nonce: string;
      mac: string;
      ttl: number;
    };
  }> {
    return api.post(`/aurora/agent-os/realtime/token`, {
      data: { projectId, conversationId },
      timeout: 15_000,
      signal,
    });
  }

  /**
   * Multipart file upload → durable Agent OS attachment (attachmentId for tools).
   */
  async uploadAttachment(
    projectId: string,
    file: File,
    signal?: AbortSignal
  ): Promise<AgentOsAttachmentSummary> {
    const form = new FormData();
    form.append("file", file, file.name);

    // Do not set Content-Type — browser sets multipart boundary.
    const workspaceId =
      typeof window !== "undefined" ? localStorage.getItem("fizz:active-workspace") : null;
    const headers: Record<string, string> = {
      "accept-language":
        typeof window !== "undefined" ? window.location.pathname.split("/")[1] || "en-US" : "en-US",
    };
    if (workspaceId) headers["x-fizz-workspace-id"] = workspaceId;

    const res = await fetch(
      `/aurora/agent-os/projects/${encodeURIComponent(projectId)}/attachments`,
      {
        method: "POST",
        body: form,
        credentials: "include",
        headers,
        signal,
      }
    );
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string | { message?: string } };
        if (typeof body.message === "string") message = body.message;
        else if (body.message && typeof body.message === "object" && body.message.message) {
          message = body.message.message;
        }
      } catch {
        /* ignore */
      }
      throw new ApiRequestError(`HTTP_${res.status}`, message, res.status);
    }
    const body = (await res.json()) as {
      code?: number;
      data?: AgentOsAttachmentSummary;
    };
    if (typeof body.code === "number" && (body.code < 200 || body.code >= 300)) {
      throw new ApiRequestError(body.code, "Upload failed", res.status);
    }
    if (!body.data?.id) {
      throw new ApiRequestError("MALFORMED", "Upload response missing data", res.status);
    }
    return body.data;
  }

  health(signal?: AbortSignal): Promise<{ ok: boolean; worker?: { ok: boolean } }> {
    return api.get("/aurora/agent-os/health", { signal });
  }

  /** Models the worker can drive. The picker has no list of its own. */
  listModels(signal?: AbortSignal): Promise<{
    models: Array<{ id: string; label: string; hint?: string }>;
  }> {
    return api.get("/aurora/agent-os/models", { signal });
  }

  getModelPreferences(projectId: string, signal?: AbortSignal): Promise<AgentOsModelPreferences> {
    return api.get(`/aurora/agent-os/projects/${encodeURIComponent(projectId)}/model-preferences`, {
      signal,
    });
  }

  updateModelPreferences(
    projectId: string,
    input: AgentOsModelPreferencesUpdate
  ): Promise<AgentOsModelPreferences> {
    return api.post(
      `/aurora/agent-os/projects/${encodeURIComponent(projectId)}/model-preferences`,
      { data: input }
    );
  }

  listSkills(
    projectId: string,
    workbenchMode: AgentOsWorkbenchMode,
    signal?: AbortSignal
  ): Promise<{
    skills: AgentOsSkillMeta[];
    invocable: AgentOsSkillMeta[];
    projectKind: "platform" | "story";
    workbenchMode: string;
  }> {
    return api.get("/aurora/agent-os/skills", {
      params: { projectId, workbenchMode },
      signal,
    });
  }

  /**
   * Durable conversation transcript for panel reopen / hard refresh.
   * Omit conversationId to load the actor's latest conversation on the project.
   */
  getConversation(
    projectId: string,
    conversationId?: string,
    signal?: AbortSignal
  ): Promise<AgentOsConversationHistory> {
    return api.get(`/aurora/agent-os/projects/${encodeURIComponent(projectId)}/conversation`, {
      params: conversationId ? { conversationId } : undefined,
      signal,
    });
  }
}

export interface AgentOsConversationRun {
  runId: string;
  status: string;
  modelProfileId: string;
  events: AgentOsEvent[];
  pendingApproval: AgentOsPendingApproval | null;
  pendingUserInput: AgentOsPendingUserInput | null;
  pendingExternal: AgentOsPendingExternal | null;
  assistantText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentOsModelPreferences {
  projectId: string;
  projectKind: "platform" | "story";
  chatModelProfileId: string | null;
  imageModelId: string | null;
  videoModelId: string | null;
  version: number;
  updatedAt: string | null;
}

export interface AgentOsModelPreferencesUpdate {
  expectedVersion: number;
  chatModelProfileId: string | null;
  imageModelId: string | null;
  videoModelId: string | null;
}

export interface AgentOsConversationHistory {
  conversationId: string | null;
  runs: AgentOsConversationRun[];
}

export interface AgentOsSkillMeta {
  id: string;
  name: string;
  description: string;
  source: string;
  alwaysOn: boolean;
  userInvocable: boolean;
  removable: boolean;
  projectKinds: Array<"platform" | "story">;
  workbenchModes: string[];
  priority: number;
}

export const agentOsApi = new AgentOsApiClient();
