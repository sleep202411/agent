import {
  StudioAgentArchiveThreadResponseSchema,
  StudioAgentCancelRunRequestSchema,
  StudioAgentDeleteAttachmentResultSchema,
  StudioAgentEnvelopeSchema,
  StudioAgentInvocationRequestSchema,
  StudioAgentInvocationResultSchema,
  StudioAgentPermissionPolicySchema,
  StudioAgentRegisterAttachmentRequestSchema,
  StudioAgentRegisterAttachmentResultSchema,
  StudioAgentResolveThreadRequestSchema,
  StudioAgentResolveThreadResultSchema,
  StudioAgentRunSchema,
  StudioAgentThreadSnapshotSchema,
  StudioAgentUpdatePermissionPolicyRequestSchema,
  type StudioAgentArchiveThreadResponse,
  type StudioAgentCancelRunRequest,
  type StudioAgentDeleteAttachmentResult,
  type StudioAgentInvocationRequest,
  type StudioAgentInvocationResult,
  type StudioAgentPermissionPolicy,
  type StudioAgentRegisterAttachmentRequest,
  type StudioAgentRegisterAttachmentResult,
  type StudioAgentResolveThreadRequest,
  type StudioAgentResolveThreadResult,
  type StudioAgentRun,
  type StudioAgentThreadSnapshot,
  type StudioAgentUpdatePermissionPolicyRequest,
} from "@repo/shared";

import { api } from "@/lib/api";

import { parseStudioAgentRealtimeGrant, type StudioAgentRealtimeGrant } from "./realtime-grant";
import { STUDIO_AGENT_INVOCATION_PATH } from "./transport-contract";

/**
 * Unwrap the shared `{ code: 200, data }` envelope around the realtime grant.
 *
 * Every other method parses through `StudioAgentEnvelopeSchema`, which takes a
 * Zod schema for its payload. The grant has none and will not get one: it is a
 * transport credential, not part of the Studio Agent domain contract, and its
 * own validator (`parseStudioAgentRealtimeGrant`) is stricter than a schema
 * would be. This mirrors the envelope's contract exactly — literal 200, `data`,
 * nothing else — so the two cannot drift.
 */
function unwrapStudioAgentEnvelope(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Studio Agent response is not an envelope.");
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.code !== 200 || !("data" in envelope) || Object.keys(envelope).length !== 2) {
    throw new Error("Studio Agent response envelope is malformed.");
  }
  return envelope.data;
}

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

  /**
   * Mint this thread's conversation-channel grant.
   *
   * Called to open the connection and again for every token renewal, so the
   * server re-runs the thread's authorization for the life of the
   * subscription: revoking access stops delivery at the next refresh instead of
   * at the next page load. The account key never leaves the server, and the
   * channel name is the server's to choose — see `realtime-grant.ts`.
   */
  async createRealtimeGrant(
    threadId: string,
    signal?: AbortSignal
  ): Promise<StudioAgentRealtimeGrant> {
    return this.#get(
      `/aurora/studio-agent/threads/${encodeURIComponent(threadId)}/realtime-token`,
      (value) => parseStudioAgentRealtimeGrant(unwrapStudioAgentEnvelope(value)),
      undefined,
      signal
    );
  }

  /**
   * Wake a turn for an input the transport has already published.
   *
   * `ChatTransport` issues this POST itself for a fresh send — it is the `api`
   * the provider is given, and the body is composed by the same
   * {@link StudioAgentInvocationRequestSchema}. This method exists for the one
   * write `useChat` cannot model: a prompt aimed at a run that is already in
   * flight (steer / enqueue). `useChat` serialises on `status === "ready"`, so
   * a mid-turn send has to publish through `ClientView.send(input, { runId })`
   * and wake the control plane itself.
   *
   * Same endpoint, same body, same codec, same channel — one delivery
   * mechanism with two callers, not two mechanisms.
   */
  async sendInvocation(
    request: StudioAgentInvocationRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentInvocationResult> {
    const payload = StudioAgentInvocationRequestSchema.parse(request);
    return this.#post(
      STUDIO_AGENT_INVOCATION_PATH,
      payload,
      (value) => StudioAgentEnvelopeSchema(StudioAgentInvocationResultSchema).parse(value).data,
      signal
    );
  }

  /**
   * The DURABLE half of a stop, and the only one that reaches a parked turn.
   *
   * `session.cancel(runId)` on the channel fires the abort signal of whatever
   * run object an activity is currently holding. That is the fast path and it
   * is the one that stops a live token stream in milliseconds — but it can only
   * reach a turn that is INSIDE a model step. A creator who presses stop while
   * a tool is executing, while the workflow is between activities, or while the
   * turn is parked waiting for an approval or for input, publishes `ai-cancel`
   * to a worker that has no run registered for it, and nothing happens: the
   * panel says "stopping" and the turn runs to completion anyway.
   *
   * This route is what covers those windows. It writes `cancelling` in Postgres
   * and enqueues the command the outbox turns into the workflow's
   * `studio-agent.cancel` signal, which cancels the active Temporal scope
   * wherever the workflow happens to be — including a `condition()` that no
   * activity is holding at all.
   *
   * Both are published on every stop. They converge on ONE outcome: whichever
   * arrives first drives the workflow through `cancelRun`, and the second is a
   * no-op (the service returns early once the run leaves an active status, and
   * the outbox row is upserted on a fixed idempotency key).
   */
  /**
   * "New conversation." Retires this thread; the next `resolveThread` opens a
   * fresh one. Nothing is deleted — see the server contract for why archiving
   * is the whole mechanism, and why it never refuses a live turn.
   */
  async archiveThread(
    threadId: string,
    signal?: AbortSignal
  ): Promise<StudioAgentArchiveThreadResponse> {
    return this.#post(
      `/aurora/studio-agent/threads/${encodeURIComponent(threadId)}/archive`,
      {},
      (value) =>
        StudioAgentEnvelopeSchema(StudioAgentArchiveThreadResponseSchema).parse(value).data,
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
