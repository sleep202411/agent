/**
 * Mobile client for Agent OS product gateway (`/aurora/agent-os/*`).
 *
 * Paths omit the `/aurora` prefix because `auroraBaseUrl` already ends in
 * `/aurora` (same convention as ip-commerce / crews).
 *
 * Contract: docs/agent-os/mobile-core-endpoints.md + Nest gateway DTOs.
 * Transport: poll `GET .../runs/:runId/events`. Ably token is optional only.
 */

import { Platform } from "react-native";

import { api } from "@/lib/api-client";

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

export type AgentOsPermissionMode = "ask" | "smart" | "full";

export type AgentOsDisplayLocale = "en-US" | "zh-CN" | "zh-HK";

/** Same continuation contract as Studio H5 — native Story is not a separate server surface. */
export const AGENT_OS_MOBILE_EXPERIENCE = "mobile_h5" as const;
export type AgentOsMobileExperience = typeof AGENT_OS_MOBILE_EXPERIENCE;

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
  turnId?: string;
}

export interface AgentOsPendingUserInputQuestion {
  id: string;
  header?: string;
  question: string;
  options: { value: string; label: string; description?: string }[];
}

/** Snapshot while status=waiting_for_input (UserInputRequired payload). */
export interface AgentOsPendingUserInput {
  requestId: string;
  formId?: string;
  questions: AgentOsPendingUserInputQuestion[];
  turnId?: string;
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
  pendingApproval?: AgentOsPendingApproval | null;
  pendingUserInput?: AgentOsPendingUserInput | AgentOsPendingUserInputQuestion[] | null;
  pendingExternal?: AgentOsPendingExternal | null;
  events?: AgentOsEvent[];
  assistantText?: string | null;
  source?: string;
}

export interface AgentOsStartRunInput {
  projectId: string;
  message: string;
  modelProfileId: string;
  conversationId: string;
  clientSubmissionId: string;
  turnId: string;
  messageId: string;
  attachmentIds?: string[];
  permissionMode?: AgentOsPermissionMode;
  workbenchMode: string;
  workbenchContext?: {
    chapterId?: string;
    sectionId?: string;
    experience?: AgentOsMobileExperience;
  };
  skillIds?: string[];
  projectSkillInstallationIds?: string[];
  disabledDefaultSkillInstallationIds?: string[];
}

export interface AgentOsApprovalInput {
  runId: string;
  projectId: string;
  conversationId: string;
  modelProfileId: string;
  decision: "approve" | "reject";
  approvalId: string;
  responseId: string;
  responseText: string;
  locale: AgentOsDisplayLocale;
  permissionMode?: AgentOsPermissionMode;
  experience?: AgentOsMobileExperience;
}

export interface AgentOsUserInputAnswer {
  runId: string;
  projectId: string;
  conversationId: string;
  modelProfileId: string;
  requestId: string;
  responseId: string;
  answers: Record<string, string>;
  permissionMode?: AgentOsPermissionMode;
}

export interface AgentOsConversationRun {
  runId: string;
  status: string;
  modelProfileId: string;
  events: AgentOsEvent[];
  pendingApproval: AgentOsPendingApproval | null;
  pendingUserInput?: AgentOsPendingUserInput | AgentOsPendingUserInputQuestion[] | null;
  pendingExternal?: AgentOsPendingExternal | null;
  assistantText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentOsConversationHistory {
  conversationId: string | null;
  runs: AgentOsConversationRun[];
}

export interface AgentOsModelProfile {
  id: string;
  label: string;
  hint?: string;
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

export interface AgentOsSkillMeta {
  id: string;
  name: string;
  description: string;
  source: string;
  alwaysOn: boolean;
  userInvocable: boolean;
  removable: boolean;
  projectKinds: ("platform" | "story")[];
  workbenchModes: string[];
  priority: number;
}

export type AgentOsLocalFile = {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
};

export function normalizePendingExternal(raw: unknown): AgentOsPendingExternal | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const jobId = typeof record.jobId === "string" ? record.jobId.trim() : "";
  const turnId = typeof record.turnId === "string" ? record.turnId.trim() : "";
  const toolCallId = typeof record.toolCallId === "string" ? record.toolCallId.trim() : "";
  const toolId = typeof record.toolId === "string" ? record.toolId.trim() : "";
  if (record.kind !== "external_job" || !jobId || !turnId || !toolCallId || !toolId) return null;
  return {
    kind: "external_job",
    jobId,
    startedMessage: typeof record.startedMessage === "string" ? record.startedMessage : "",
    turnId,
    toolCallId,
    toolId,
  };
}

/** Normalize gateway pendingUserInput (object with questions, or bare question list). */
export function normalizePendingUserInput(
  raw: AgentOsRunResponse["pendingUserInput"]
): AgentOsPendingUserInput | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    if (!raw.length) return null;
    return { requestId: "", questions: raw };
  }
  if (typeof raw !== "object") return null;
  const requestId = typeof raw.requestId === "string" ? raw.requestId : "";
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  if (!requestId || !questions.length) return null;
  const formId = typeof raw.formId === "string" ? raw.formId : undefined;
  return {
    requestId,
    ...(formId ? { formId } : {}),
    questions,
    formId: typeof raw.formId === "string" ? raw.formId : undefined,
    turnId: typeof raw.turnId === "string" ? raw.turnId : undefined,
  };
}

const AGENT_OS = "/agent-os";
const AURORA = { service: "aurora" as const };

export const agentOsApi = {
  listModels(signal?: AbortSignal) {
    return api.get<{ models: AgentOsModelProfile[]; mobileDefaultModelProfileId: string }>(
      `${AGENT_OS}/models`,
      {
        ...AURORA,
        signal,
        timeout: 20_000,
      }
    );
  },

  getConversation(projectId: string, conversationId?: string, signal?: AbortSignal) {
    return api.get<AgentOsConversationHistory>(
      `${AGENT_OS}/projects/${encodeURIComponent(projectId)}/conversation`,
      {
        ...AURORA,
        params: conversationId ? { conversationId } : undefined,
        signal,
        timeout: 30_000,
      }
    );
  },

  startRun(input: AgentOsStartRunInput, signal?: AbortSignal) {
    if (!input.modelProfileId.trim()) {
      return Promise.reject(new Error("modelProfileId is required"));
    }
    return api.post<AgentOsRunResponse>(`${AGENT_OS}/runs`, {
      ...AURORA,
      data: {
        projectId: input.projectId,
        conversationId: input.conversationId,
        clientSubmissionId: input.clientSubmissionId,
        turnId: input.turnId,
        messageId: input.messageId,
        message: input.message,
        modelProfileId: input.modelProfileId,
        workbenchMode: input.workbenchMode,
        attachmentIds: input.attachmentIds,
        permissionMode: input.permissionMode,
        workbenchContext: input.workbenchContext,
        skillIds: input.skillIds,
        projectSkillInstallationIds: input.projectSkillInstallationIds,
        disabledDefaultSkillInstallationIds: input.disabledDefaultSkillInstallationIds,
      },
      signal,
      timeout: 60_000,
    });
  },

  listEvents(runId: string, projectId: string, after = 0, signal?: AbortSignal) {
    return api.get<AgentOsRunResponse>(`${AGENT_OS}/runs/${encodeURIComponent(runId)}/events`, {
      ...AURORA,
      params: { projectId, after },
      signal,
      timeout: 30_000,
    });
  },

  resolveApproval(input: AgentOsApprovalInput, signal?: AbortSignal) {
    return api.post<AgentOsRunResponse>(
      `${AGENT_OS}/runs/${encodeURIComponent(input.runId)}/approvals`,
      {
        ...AURORA,
        data: {
          approvalId: input.approvalId,
          responseId: input.responseId,
          decision: input.decision,
          responseText: input.responseText,
          locale: input.locale,
          conversationId: input.conversationId,
          projectId: input.projectId,
          modelProfileId: input.modelProfileId,
          permissionMode: input.permissionMode,
          experience: input.experience,
        },
        signal,
        timeout: 60_000,
      }
    );
  },

  answerUserInput(input: AgentOsUserInputAnswer, signal?: AbortSignal) {
    return api.post<AgentOsRunResponse>(
      `${AGENT_OS}/runs/${encodeURIComponent(input.runId)}/user-input`,
      {
        ...AURORA,
        data: {
          requestId: input.requestId,
          responseId: input.responseId,
          answers: input.answers,
          conversationId: input.conversationId,
          projectId: input.projectId,
          modelProfileId: input.modelProfileId,
          permissionMode: input.permissionMode,
        },
        signal,
        timeout: 60_000,
      }
    );
  },

  cancelRun(runId: string, projectId: string, reason?: string, signal?: AbortSignal) {
    return api.post<AgentOsRunResponse>(`${AGENT_OS}/runs/${encodeURIComponent(runId)}/cancel`, {
      ...AURORA,
      data: { projectId, reason },
      signal,
      timeout: 15_000,
    });
  },

  realtimeToken(projectId: string, conversationId: string, signal?: AbortSignal) {
    return api.post<{
      channel: string;
      ttlMs: number;
      tokenRequest: Record<string, unknown>;
    }>(`${AGENT_OS}/realtime/token`, {
      ...AURORA,
      data: { projectId, conversationId },
      signal,
      timeout: 15_000,
    });
  },

  health(signal?: AbortSignal) {
    return api.get<{ ok: boolean; worker?: { ok: boolean } }>(`${AGENT_OS}/health`, {
      ...AURORA,
      signal,
      timeout: 15_000,
    });
  },

  listSkills(projectId: string, workbenchMode: string, signal?: AbortSignal) {
    return api.get<{
      skills: AgentOsSkillMeta[];
      invocable: AgentOsSkillMeta[];
      projectKind: "platform" | "story";
      workbenchMode: string;
    }>(`${AGENT_OS}/skills`, {
      ...AURORA,
      params: { projectId, workbenchMode },
      signal,
      timeout: 20_000,
    });
  },

  async uploadAttachment(projectId: string, file: AgentOsLocalFile, signal?: AbortSignal) {
    const form = new FormData();
    const mime = file.mimeType?.trim() || "application/octet-stream";
    if (Platform.OS === "web") {
      const response = await fetch(file.uri);
      const blob = await response.blob();
      form.append("file", blob, file.name);
    } else {
      form.append("file", { uri: file.uri, name: file.name, type: mime } as unknown as Blob);
    }
    return api.postFormData<AgentOsAttachmentSummary>(
      `${AGENT_OS}/projects/${encodeURIComponent(projectId)}/attachments`,
      form,
      { ...AURORA, signal, timeout: 60_000 }
    );
  },
};
