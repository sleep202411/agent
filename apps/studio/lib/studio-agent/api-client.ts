import {
  AgentAttachmentRegisterRequestSchema,
  AgentAttachmentRevokeRequestSchema,
  AgentAttachmentStatusRequestSchema,
  AgentAttachmentSummarySchema,
  AgentCancellationGatewayRequestSchema,
  AgentCancellationResultSchema,
  AgentConversationCreateRequestSchema,
  AgentConversationGrantSchema,
  AgentConversationPreferenceRequestSchema,
  AgentConversationResolveRequestSchema,
  AgentHistoryGatewayRequestSchema,
  AgentHistoryPageSchema,
  AgentInvocationAcceptedSchema,
  AgentInvocationGatewayRequestSchema,
  AgentInvocationStatusPageSchema,
  AgentInvocationStatusRequestSchema,
  AgentSessionGrantRequestSchema,
  type AgentAttachmentSummary,
  type AgentCancellationResult,
  type AgentConversationGrant,
  type AgentHistoryPage,
  type AgentInvocationAccepted,
  type AgentInvocationStatusPage,
  type AgentPlatformPermissionMode,
} from "@repo/shared/agent-platform";
import { api } from "@/lib/api";

export const AGENT_PLATFORM_INVOCATION_PATH = "/aurora/agent-platform/invocations";

export interface AgentPlatformApiClientOptions {
  workspaceId: string;
  locale: string;
}

/**
 * Browser boundary for the product-owned Agent Platform API.
 *
 * Every response is parsed as both the shared product envelope and the exact
 * endpoint payload. The browser never constructs a channel name or carries
 * authorization claims: the server resolves the business scope, re-authorizes
 * every control request, and returns a single-conversation Ably grant.
 */
export class AgentPlatformApiClient {
  readonly #workspaceId: string;
  readonly #locale: string;

  constructor({ workspaceId, locale }: AgentPlatformApiClientOptions) {
    this.#workspaceId = workspaceId;
    this.#locale = locale;
  }

  resolveStoryConversation(
    projectId: string,
    signal?: AbortSignal
  ): Promise<AgentConversationGrant> {
    const request = AgentConversationResolveRequestSchema.parse({
      schemaVersion: "agent-conversation-resolve/v1",
      surface: "story-studio",
      workspaceId: this.#workspaceId,
      projectId,
      locale: this.#locale,
    });
    return this.#post(
      "/aurora/agent-platform/conversations/resolve",
      request,
      AgentConversationGrantSchema.parse,
      signal
    );
  }

  createStoryConversation(
    projectId: string,
    permissionMode: AgentPlatformPermissionMode,
    signal?: AbortSignal
  ): Promise<AgentConversationGrant> {
    const request = AgentConversationCreateRequestSchema.parse({
      schemaVersion: "agent-conversation-create/v1",
      surface: "story-studio",
      workspaceId: this.#workspaceId,
      projectId,
      locale: this.#locale,
      permissionMode,
    });
    return this.#post(
      "/aurora/agent-platform/conversations",
      request,
      AgentConversationGrantSchema.parse,
      signal
    );
  }

  authorizeConversation(
    conversationId: string,
    signal?: AbortSignal
  ): Promise<AgentConversationGrant> {
    const request = AgentSessionGrantRequestSchema.parse({
      schemaVersion: "agent-session-grant-request/v1",
      conversationId,
      locale: this.#locale,
    });
    return this.#post(
      "/aurora/agent-platform/sessions/authorize",
      request,
      AgentConversationGrantSchema.parse,
      signal
    );
  }

  updatePermissionMode(
    conversationId: string,
    permissionMode: AgentPlatformPermissionMode,
    signal?: AbortSignal
  ): Promise<AgentConversationGrant> {
    const request = AgentConversationPreferenceRequestSchema.parse({
      schemaVersion: "agent-conversation-preference/v1",
      conversationId,
      locale: this.#locale,
      permissionMode,
    });
    return this.#patch(
      "/aurora/agent-platform/conversations/preference",
      request,
      AgentConversationGrantSchema.parse,
      signal
    );
  }

  invoke(
    input: Readonly<{
      conversationId: string;
      inputEventId: string;
      clientMessageId: string;
      sessionName: string;
      continuationOfInvocationId?: string;
    }>,
    signal?: AbortSignal
  ): Promise<AgentInvocationAccepted> {
    const request = AgentInvocationGatewayRequestSchema.parse({
      schemaVersion: "agent-invocation-gateway/v1",
      ...input,
      locale: this.#locale,
    });
    return this.#post(
      AGENT_PLATFORM_INVOCATION_PATH,
      request,
      AgentInvocationAcceptedSchema.parse,
      signal
    );
  }

  invocationStatus(
    conversationId: string,
    options: Readonly<{
      sinceRevision?: string;
      limit?: number;
      signal?: AbortSignal;
    }> = {}
  ): Promise<AgentInvocationStatusPage> {
    const request = AgentInvocationStatusRequestSchema.parse({
      schemaVersion: "agent-invocation-status-request/v1",
      conversationId,
      locale: this.#locale,
      sinceRevision: options.sinceRevision,
      limit: options.limit,
    });
    return this.#post(
      "/aurora/agent-platform/invocations/status",
      request,
      AgentInvocationStatusPageSchema.parse,
      options.signal
    );
  }

  cancel(
    conversationId: string,
    invocationId: string,
    signal?: AbortSignal
  ): Promise<AgentCancellationResult> {
    const request = AgentCancellationGatewayRequestSchema.parse({
      schemaVersion: "agent-cancellation-gateway/v1",
      conversationId,
      invocationId,
      locale: this.#locale,
    });
    return this.#post(
      "/aurora/agent-platform/cancellations",
      request,
      AgentCancellationResultSchema.parse,
      signal
    );
  }

  history(
    conversationId: string,
    options: Readonly<{ cursor?: string; limit?: number; signal?: AbortSignal }> = {}
  ): Promise<AgentHistoryPage> {
    const request = AgentHistoryGatewayRequestSchema.parse({
      schemaVersion: "agent-history-gateway/v1",
      conversationId,
      locale: this.#locale,
      cursor: options.cursor,
      limit: options.limit ?? 50,
    });
    return this.#post(
      "/aurora/agent-platform/history",
      request,
      AgentHistoryPageSchema.parse,
      options.signal
    );
  }

  registerAttachment(
    conversationId: string,
    mediaAssetId: string,
    fileName: string,
    signal?: AbortSignal
  ): Promise<AgentAttachmentSummary> {
    const request = AgentAttachmentRegisterRequestSchema.parse({
      schemaVersion: "agent-attachment-register/v1",
      conversationId,
      mediaAssetId,
      fileName,
      locale: this.#locale,
    });
    return this.#post(
      "/aurora/agent-platform/attachments/register",
      request,
      AgentAttachmentSummarySchema.parse,
      signal
    );
  }

  revokeAttachment(
    conversationId: string,
    attachmentId: string,
    signal?: AbortSignal
  ): Promise<AgentAttachmentSummary> {
    const request = AgentAttachmentRevokeRequestSchema.parse({
      schemaVersion: "agent-attachment-revoke/v1",
      conversationId,
      attachmentId,
      locale: this.#locale,
    });
    return this.#post(
      "/aurora/agent-platform/attachments/revoke",
      request,
      AgentAttachmentSummarySchema.parse,
      signal
    );
  }

  attachmentStatus(
    conversationId: string,
    attachmentId: string,
    signal?: AbortSignal
  ): Promise<AgentAttachmentSummary> {
    const request = AgentAttachmentStatusRequestSchema.parse({
      schemaVersion: "agent-attachment-status-request/v1",
      conversationId,
      attachmentId,
      locale: this.#locale,
    });
    return this.#post(
      "/aurora/agent-platform/attachments/status",
      request,
      AgentAttachmentSummarySchema.parse,
      signal
    );
  }

  async #post<T>(
    path: string,
    data: unknown,
    parse: (value: unknown) => T,
    signal?: AbortSignal
  ): Promise<T> {
    const response = await api.post<unknown>(path, {
      raw: true,
      data,
      headers: this.#headers(),
      signal,
    });
    return parseAgentPlatformEnvelope(response, parse);
  }

  async #patch<T>(
    path: string,
    data: unknown,
    parse: (value: unknown) => T,
    signal?: AbortSignal
  ): Promise<T> {
    const response = await api.patch<unknown>(path, {
      raw: true,
      data,
      headers: this.#headers(),
      signal,
    });
    return parseAgentPlatformEnvelope(response, parse);
  }

  #headers(): Record<string, string> {
    return {
      "x-fizz-workspace-id": this.#workspaceId,
      "accept-language": this.#locale,
    };
  }
}

function parseAgentPlatformEnvelope<T>(value: unknown, parse: (value: unknown) => T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agent Platform response is not an envelope.");
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.code !== 200 || !("data" in envelope) || Object.keys(envelope).length !== 2) {
    throw new Error("Agent Platform response envelope is malformed.");
  }
  return parse(envelope.data);
}
