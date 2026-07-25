import {
  StudioAgentActionExecutionSchema,
  StudioAgentActionSchema,
  StudioAgentApprovalSchema,
  StudioAgentChildRunDescriptorSchema,
  StudioAgentCompleteContextCompactionRequestSchema,
  StudioAgentContextCompactionCommitResultSchema,
  StudioAgentEventDraftSchema,
  StudioAgentEventSchema,
  StudioAgentFailContextCompactionRequestSchema,
  StudioAgentInputSchema,
  StudioAgentModelExecutionPlanSchema,
  StudioAgentPreparedActionSchema,
  StudioAgentRunSchema,
  type StudioAgentAction,
  type StudioAgentActionExecution,
  type StudioAgentApproval,
  type StudioAgentApprovalSignal,
  type StudioAgentChildRunDescriptor,
  type StudioAgentCompleteContextCompactionRequest,
  type StudioAgentContextCompactionCommitResult,
  type StudioAgentEvent,
  type StudioAgentEventDraft,
  type StudioAgentFailContextCompactionRequest,
  type StudioAgentInput,
  type StudioAgentInputSignal,
  type StudioAgentModelExecutionPlan,
  type StudioAgentPreparedAction,
  type StudioAgentPrepareActionRequest,
  type StudioAgentRun,
  type StudioAgentWorkflowInput,
} from "@repo/shared/studio-agent";
import {
  StudioAgentDenyActionRequestSchema,
  StudioAgentEnvelopeSchema,
  StudioAgentExecuteActionRequestSchema,
  StudioAgentRunTransitionRequestSchema,
  type StudioAgentDenyActionRequest,
  type StudioAgentExecuteActionRequest,
  type StudioAgentRunTransitionRequest,
} from "@repo/shared/studio-agent-api";
import type { z } from "zod";
import type { RuntimeGatewayConfig } from "./config.js";

const RUNTIME_API_PREFIX = "internal/studio-agent/runtime/";

// A single transient control-plane blip — a 502/503/504 during a rolling
// server deploy, or a dropped connection — must not kill a run. The model step
// runs with no activity-level retry (maximumAttempts: 1) and streams frequent
// event POSTs, so one failed delta would otherwise end the whole turn. Every
// request carries an idempotency key, so a retry that lands after a silent
// success is deduped server-side; deterministic 4xx and caller cancellation
// (steer/stop) are never retried.
const GATEWAY_MAX_ATTEMPTS = 3;
const GATEWAY_RETRY_BASE_DELAY_MS = 200;
const GATEWAY_RETRY_MAX_DELAY_MS = 2_000;
const GATEWAY_TRANSIENT_STATUSES = new Set([502, 503, 504]);

export interface StudioAgentRuntimeGateway {
  appendEvent(draft: StudioAgentEventDraft, signal?: AbortSignal): Promise<StudioAgentEvent>;
  loadModelPlan(
    workflow: StudioAgentWorkflowInput,
    signal?: AbortSignal
  ): Promise<StudioAgentModelExecutionPlan>;
  completeContextCompaction(
    request: StudioAgentCompleteContextCompactionRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentContextCompactionCommitResult>;
  failContextCompaction(
    request: StudioAgentFailContextCompactionRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentEvent>;
  prepareAction(
    request: StudioAgentPrepareActionRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentPreparedAction>;
  prepareChildRun(
    request: StudioAgentPrepareActionRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentChildRunDescriptor>;
  executeAction(
    request: StudioAgentExecuteActionRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentActionExecution>;
  denyAction(
    request: StudioAgentDenyActionRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentAction>;
  resolveApproval(
    signalValue: StudioAgentApprovalSignal,
    signal?: AbortSignal
  ): Promise<StudioAgentApproval>;
  consumeInput(
    signalValue: StudioAgentInputSignal,
    signal?: AbortSignal
  ): Promise<StudioAgentInput>;
  transitionRun(
    request: StudioAgentRunTransitionRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentRun>;
}

export class RuntimeGatewayHttpError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    super(
      `Studio Agent Runtime Gateway returned HTTP ${status}: ${truncateForError(responseBody)}`
    );
    this.name = "RuntimeGatewayHttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class RuntimeGatewayProtocolError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "RuntimeGatewayProtocolError";
  }
}

export class RuntimeGatewayClient implements StudioAgentRuntimeGateway {
  readonly #baseUrl: URL;
  readonly #token: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(config: RuntimeGatewayConfig, fetchImplementation: typeof fetch = fetch) {
    this.#baseUrl = ensureTrailingSlash(config.baseUrl);
    this.#token = config.token;
    this.#timeoutMs = config.timeoutMs;
    this.#fetch = fetchImplementation;
  }

  appendEvent(draft: StudioAgentEventDraft, signal?: AbortSignal): Promise<StudioAgentEvent> {
    return this.#post(
      "events",
      StudioAgentEventDraftSchema.parse(draft),
      StudioAgentEventSchema,
      signal
    );
  }

  loadModelPlan(
    workflow: StudioAgentWorkflowInput,
    signal?: AbortSignal
  ): Promise<StudioAgentModelExecutionPlan> {
    return this.#post("model-plan", workflow, StudioAgentModelExecutionPlanSchema, signal);
  }

  completeContextCompaction(
    request: StudioAgentCompleteContextCompactionRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentContextCompactionCommitResult> {
    return this.#post(
      "context-compactions/complete",
      StudioAgentCompleteContextCompactionRequestSchema.parse(request),
      StudioAgentContextCompactionCommitResultSchema,
      signal
    );
  }

  failContextCompaction(
    request: StudioAgentFailContextCompactionRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentEvent> {
    return this.#post(
      "context-compactions/terminal",
      StudioAgentFailContextCompactionRequestSchema.parse(request),
      StudioAgentEventSchema,
      signal
    );
  }

  prepareAction(
    request: StudioAgentPrepareActionRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentPreparedAction> {
    return this.#post("actions/prepare", request, StudioAgentPreparedActionSchema, signal);
  }

  prepareChildRun(
    request: StudioAgentPrepareActionRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentChildRunDescriptor> {
    return this.#post("child-runs/prepare", request, StudioAgentChildRunDescriptorSchema, signal);
  }

  executeAction(
    request: StudioAgentExecuteActionRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentActionExecution> {
    return this.#post(
      "actions/execute",
      StudioAgentExecuteActionRequestSchema.parse(request),
      StudioAgentActionExecutionSchema,
      signal
    );
  }

  denyAction(
    request: StudioAgentDenyActionRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentAction> {
    return this.#post(
      "actions/deny",
      StudioAgentDenyActionRequestSchema.parse(request),
      StudioAgentActionSchema,
      signal
    );
  }

  resolveApproval(
    signalValue: StudioAgentApprovalSignal,
    signal?: AbortSignal
  ): Promise<StudioAgentApproval> {
    return this.#post("approvals/resolve", signalValue, StudioAgentApprovalSchema, signal);
  }

  consumeInput(
    signalValue: StudioAgentInputSignal,
    signal?: AbortSignal
  ): Promise<StudioAgentInput> {
    return this.#post("inputs/consume", signalValue, StudioAgentInputSchema, signal);
  }

  transitionRun(
    request: StudioAgentRunTransitionRequest,
    signal?: AbortSignal
  ): Promise<StudioAgentRun> {
    return this.#post(
      "runs/transition",
      StudioAgentRunTransitionRequestSchema.parse(request),
      StudioAgentRunSchema,
      signal
    );
  }

  async #post<T>(
    path: string,
    request: unknown,
    responseSchema: z.ZodType<T>,
    callerSignal?: AbortSignal
  ): Promise<T> {
    const url = new URL(`${RUNTIME_API_PREFIX}${path}`, this.#baseUrl);
    const body = JSON.stringify(request);
    for (let attempt = 1; ; attempt += 1) {
      const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-studio-agent-runtime-token": this.#token,
          },
          body,
          signal,
        });
      } catch (error) {
        // Caller cancellation (steer/stop) is terminal — never retry it.
        // A dropped connection or per-attempt timeout is transient.
        if (callerSignal?.aborted || attempt >= GATEWAY_MAX_ATTEMPTS) {
          throw error;
        }
        await this.#backoffBeforeRetry(attempt, callerSignal);
        continue;
      }
      const responseBody = await response.text();
      if (!response.ok) {
        if (
          GATEWAY_TRANSIENT_STATUSES.has(response.status) &&
          !callerSignal?.aborted &&
          attempt < GATEWAY_MAX_ATTEMPTS
        ) {
          await this.#backoffBeforeRetry(attempt, callerSignal);
          continue;
        }
        throw new RuntimeGatewayHttpError(response.status, responseBody);
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(responseBody);
      } catch (error) {
        throw new RuntimeGatewayProtocolError(
          "Studio Agent Runtime Gateway returned invalid JSON.",
          error
        );
      }
      try {
        return StudioAgentEnvelopeSchema(responseSchema).parse(decoded).data;
      } catch (error) {
        throw new RuntimeGatewayProtocolError(
          "Studio Agent Runtime Gateway returned a response outside the shared contract.",
          error
        );
      }
    }
  }

  async #backoffBeforeRetry(attempt: number, callerSignal?: AbortSignal): Promise<void> {
    const delay = Math.min(
      GATEWAY_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
      GATEWAY_RETRY_MAX_DELAY_MS
    );
    await new Promise<void>((resolve, reject) => {
      if (callerSignal?.aborted) {
        reject(callerSignal.reason ?? new Error("The gateway request was cancelled."));
        return;
      }
      const timer = setTimeout(() => {
        callerSignal?.removeEventListener("abort", onAbort);
        resolve();
      }, delay);
      const onAbort = () => {
        clearTimeout(timer);
        reject(callerSignal!.reason ?? new Error("The gateway request was cancelled."));
      };
      callerSignal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

function ensureTrailingSlash(url: URL): URL {
  const normalized = new URL(url);
  if (!normalized.pathname.endsWith("/")) {
    normalized.pathname += "/";
  }
  return normalized;
}

function truncateForError(value: string): string {
  const normalized = value.trim();
  return normalized.length <= 2_000 ? normalized : `${normalized.slice(0, 2_000)}…`;
}
