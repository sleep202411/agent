import {
  StudioAgentCancelRunRequestSchema,
  StudioAgentDeleteAttachmentResultSchema,
  StudioAgentEnvelopeSchema,
  StudioAgentEventPageSchema,
  StudioAgentPermissionPolicySchema,
  StudioAgentRegisterAttachmentRequestSchema,
  StudioAgentRegisterAttachmentResultSchema,
  StudioAgentResolveApprovalRequestSchema,
  StudioAgentResolveApprovalResultSchema,
  StudioAgentResolveThreadRequestSchema,
  StudioAgentResolveThreadResultSchema,
  StudioAgentRunSchema,
  StudioAgentSubmitMessageRequestSchema,
  StudioAgentSubmitMessageResultSchema,
  StudioAgentThreadSnapshotSchema,
  StudioAgentUpdatePermissionPolicyRequestSchema,
  type StudioAgentCancelRunRequest,
  type StudioAgentDeleteAttachmentResult,
  type StudioAgentEventPage,
  type StudioAgentPermissionPolicy,
  type StudioAgentRegisterAttachmentRequest,
  type StudioAgentRegisterAttachmentResult,
  type StudioAgentResolveApprovalRequest,
  type StudioAgentResolveApprovalResult,
  type StudioAgentResolveThreadRequest,
  type StudioAgentResolveThreadResult,
  type StudioAgentRun,
  type StudioAgentSubmitMessageRequest,
  type StudioAgentSubmitMessageResult,
  type StudioAgentThreadSnapshot,
  type StudioAgentUpdatePermissionPolicyRequest,
} from "@repo/shared";

import { api } from "@/lib/api";

export interface StudioAgentApiClientOptions {
  workspaceId: string;
  locale: string;
}

/**
 * Strict browser client for the shared Studio Agent protocol.
 *
 * Every request and response crosses a Zod boundary from `@repo/shared`.
 * A surface therefore cannot silently drift from the server contract or
 * manufacture a partial fallback when the runtime is unavailable.
 */
export class StudioAgentApiClient {
  readonly #workspaceId: string;
  readonly #locale: string;

  constructor({ workspaceId, locale }: StudioAgentApiClientOptions) {
    this.#workspaceId = workspaceId;
    this.#locale = locale;
  }

  async resolveThread(
    request: StudioAgentResolveThreadRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentResolveThreadResult> {
    const payload = StudioAgentResolveThreadRequestSchema.parse(request);
    return this.#post(
      "/aurora/studio-agent/threads/resolve",
      payload,
      (value) => StudioAgentEnvelopeSchema(StudioAgentResolveThreadResultSchema).parse(value).data,
      signal
    );
  }

  async getSnapshot(
    threadId: string,
    options: { beforeRootRunId?: string; signal?: AbortSignal } = {}
  ): Promise<StudioAgentThreadSnapshot> {
    return this.#get(
      `/aurora/studio-agent/threads/${encodeURIComponent(threadId)}/snapshot`,
      (value) => StudioAgentEnvelopeSchema(StudioAgentThreadSnapshotSchema).parse(value).data,
      { beforeRootRunId: options.beforeRootRunId },
      options.signal
    );
  }

  async getEventPage(
    threadId: string,
    afterSequence: number,
    limit: number,
    signal?: AbortSignal
  ): Promise<StudioAgentEventPage> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new Error("Studio Agent afterSequence must be a non-negative safe integer.");
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("Studio Agent event page limit must be a positive safe integer.");
    }
    return this.#get(
      `/aurora/studio-agent/threads/${encodeURIComponent(threadId)}/events`,
      (value) => StudioAgentEnvelopeSchema(StudioAgentEventPageSchema).parse(value).data,
      { afterSequence, limit },
      signal
    );
  }

  eventStreamUrl(threadId: string, afterSequence: string | null): string {
    const query = new URLSearchParams();
    if (afterSequence !== null) query.set("afterSequence", afterSequence);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return `/aurora/studio-agent/threads/${encodeURIComponent(threadId)}/events/stream${suffix}`;
  }

  eventStreamHeaders(): Readonly<Record<string, string>> {
    return this.#headers();
  }

  async submitMessage(
    threadId: string,
    request: StudioAgentSubmitMessageRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentSubmitMessageResult> {
    const payload = StudioAgentSubmitMessageRequestSchema.parse(request);
    return this.#post(
      `/aurora/studio-agent/threads/${encodeURIComponent(threadId)}/messages`,
      payload,
      (value) => StudioAgentEnvelopeSchema(StudioAgentSubmitMessageResultSchema).parse(value).data,
      signal
    );
  }

  async registerAttachment(
    threadId: string,
    request: StudioAgentRegisterAttachmentRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentRegisterAttachmentResult> {
    const payload = StudioAgentRegisterAttachmentRequestSchema.parse(request);
    return this.#post(
      `/aurora/studio-agent/threads/${encodeURIComponent(threadId)}/attachments`,
      payload,
      (value) =>
        StudioAgentEnvelopeSchema(StudioAgentRegisterAttachmentResultSchema).parse(value).data,
      signal
    );
  }

  async deleteAttachment(
    threadId: string,
    attachmentId: string,
    signal?: AbortSignal
  ): Promise<StudioAgentDeleteAttachmentResult> {
    return this.#delete(
      `/aurora/studio-agent/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(attachmentId)}`,
      (value) =>
        StudioAgentEnvelopeSchema(StudioAgentDeleteAttachmentResultSchema).parse(value).data,
      signal
    );
  }

  async updatePermissionPolicy(
    threadId: string,
    request: StudioAgentUpdatePermissionPolicyRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentPermissionPolicy> {
    const payload = StudioAgentUpdatePermissionPolicyRequestSchema.parse(request);
    return this.#patch(
      `/aurora/studio-agent/threads/${encodeURIComponent(threadId)}/permission-policy`,
      payload,
      (value) => StudioAgentEnvelopeSchema(StudioAgentPermissionPolicySchema).parse(value).data,
      signal
    );
  }

  async resolveApproval(
    threadId: string,
    approvalId: string,
    request: StudioAgentResolveApprovalRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentResolveApprovalResult> {
    const payload = StudioAgentResolveApprovalRequestSchema.parse(request);
    return this.#post(
      `/aurora/studio-agent/threads/${encodeURIComponent(threadId)}/approvals/${encodeURIComponent(approvalId)}/resolve`,
      payload,
      (value) =>
        StudioAgentEnvelopeSchema(StudioAgentResolveApprovalResultSchema).parse(value).data,
      signal
    );
  }

  async cancelRun(
    threadId: string,
    runId: string,
    request: StudioAgentCancelRunRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentRun> {
    const payload = StudioAgentCancelRunRequestSchema.parse(request);
    return this.#post(
      `/aurora/studio-agent/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/cancel`,
      payload,
      (value) => StudioAgentEnvelopeSchema(StudioAgentRunSchema).parse(value).data,
      signal
    );
  }

  async #get<T>(
    path: string,
    parseEnvelope: (value: unknown) => T,
    params?: Record<string, string | number | boolean | undefined>,
    signal?: AbortSignal
  ): Promise<T> {
    const envelope = await api.get<unknown>(path, {
      raw: true,
      params,
      headers: this.#headers(),
      signal,
    });
    return parseEnvelope(envelope);
  }

  async #post<T>(
    path: string,
    data: unknown,
    parseEnvelope: (value: unknown) => T,
    signal?: AbortSignal
  ): Promise<T> {
    const envelope = await api.post<unknown>(path, {
      raw: true,
      data,
      headers: this.#headers(),
      signal,
    });
    return parseEnvelope(envelope);
  }

  async #patch<T>(
    path: string,
    data: unknown,
    parseEnvelope: (value: unknown) => T,
    signal?: AbortSignal
  ): Promise<T> {
    const envelope = await api.patch<unknown>(path, {
      raw: true,
      data,
      headers: this.#headers(),
      signal,
    });
    return parseEnvelope(envelope);
  }

  async #delete<T>(
    path: string,
    parseEnvelope: (value: unknown) => T,
    signal?: AbortSignal
  ): Promise<T> {
    const envelope = await api.delete<unknown>(path, {
      raw: true,
      headers: this.#headers(),
      signal,
    });
    return parseEnvelope(envelope);
  }

  #headers(): Record<string, string> {
    return {
      "x-fizz-workspace-id": this.#workspaceId,
      "accept-language": this.#locale,
    };
  }
}
