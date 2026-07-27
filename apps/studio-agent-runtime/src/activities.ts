import { ApplicationFailure, CancelledFailure, Context } from "@temporalio/activity";
import {
  type StudioAgentAction,
  type StudioAgentActionExecution,
  type StudioAgentApproval,
  type StudioAgentApprovalSignal,
  type StudioAgentInput,
  type StudioAgentInputSignal,
  type StudioAgentModelStepOutcome,
  type StudioAgentRun,
  type StudioAgentWorkflowInput,
} from "@repo/shared/studio-agent";
import type {
  StudioAgentDenyActionRequest,
  StudioAgentExecuteActionRequest,
  StudioAgentRunTransitionRequest,
} from "@repo/shared/studio-agent-api";
import type { RuntimeModelConfig } from "./config.js";
import {
  RuntimeGatewayHttpError,
  RuntimeGatewayProtocolError,
  type StudioAgentRuntimeGateway,
} from "./gateway-client.js";
import { runQwenModelStep } from "./model-runner.js";

// Temporal fails the model activity if no heartbeat arrives within
// workflows.ts' heartbeatTimeout. During generation the only heartbeats come
// from stream parts, so a long time-to-first-token (common for a large
// storyboard context, and for the non-streaming compaction generateText call)
// looks like a hang and fails the run with no retry. An independent timer
// keeps the activity alive across TTFT and inter-token gaps regardless of
// provider latency. Kept well under heartbeatTimeout.
const MODEL_STEP_HEARTBEAT_INTERVAL_MS = 5_000;

export interface StudioAgentActivities {
  runModelStep(workflow: StudioAgentWorkflowInput): Promise<StudioAgentModelStepOutcome>;
  transitionRun(request: StudioAgentRunTransitionRequest): Promise<StudioAgentRun>;
  executeAction(request: StudioAgentExecuteActionRequest): Promise<StudioAgentActionExecution>;
  denyAction(request: StudioAgentDenyActionRequest): Promise<StudioAgentAction>;
  resolveApproval(signalValue: StudioAgentApprovalSignal): Promise<StudioAgentApproval>;
  consumeInput(signalValue: StudioAgentInputSignal): Promise<StudioAgentInput>;
}

export function createStudioAgentActivities(dependencies: {
  gateway: StudioAgentRuntimeGateway;
  modelConfig: RuntimeModelConfig;
}): StudioAgentActivities {
  const { gateway, modelConfig } = dependencies;
  return {
    async runModelStep(workflow) {
      const context = Context.current();
      const heartbeat = setInterval(() => {
        try {
          context.heartbeat({ phase: "model_step_alive" });
        } catch {
          // The activity finished between the timer firing and clearInterval;
          // a heartbeat after completion is meaningless, not an error.
        }
      }, MODEL_STEP_HEARTBEAT_INTERVAL_MS);
      try {
        return await runQwenModelStep(workflow, {
          gateway,
          config: modelConfig,
          observer: {
            signal: context.cancellationSignal,
            heartbeat(details) {
              context.heartbeat(details);
            },
            now: () => new Date(),
          },
        });
      } catch (error) {
        // A steer / stop_and_send cancels the activity's cancellationSignal.
        // Temporal records the activity as *cancelled* (letting the workflow
        // resume or supersede) only when the thrown error is a CancelledFailure
        // (or a DOMException named AbortError). The AI SDK surfaces a mid-stream
        // abort as an `abort` stream part that model-runner rethrows as a plain
        // Error, and in-flight gateway calls reject on the aborted signal too —
        // both would otherwise be recorded as a genuine failure and fail the
        // whole run, dropping the user's steering input. Coerce anything seen
        // while cancelled into a CancelledFailure.
        if (context.cancellationSignal.aborted) {
          throw new CancelledFailure(
            error instanceof Error ? error.message : "The model step was cancelled."
          );
        }
        throw error;
      } finally {
        clearInterval(heartbeat);
      }
    },
    async transitionRun(request) {
      const context = Context.current();
      return withGatewayHeartbeat(
        context,
        { transition: request.transition, phase: "requesting" },
        () => invokeGateway(() => gateway.transitionRun(request, context.cancellationSignal))
      );
    },
    async executeAction(request) {
      const context = Context.current();
      // Cancelling the HTTP wait does not roll back a control-plane transaction
      // that has already begun. The action id is the canonical idempotency
      // fence, so a retry or reconnect observes the committed terminal result
      // while steer/stop does not wait on an unreachable gateway for minutes.
      return withGatewayHeartbeat(context, { actionId: request.actionId, phase: "executing" }, () =>
        invokeGateway(() => gateway.executeAction(request, context.cancellationSignal))
      );
    },
    async denyAction(request) {
      const context = Context.current();
      return withGatewayHeartbeat(context, { actionId: request.actionId, phase: "denying" }, () =>
        invokeGateway(() => gateway.denyAction(request, context.cancellationSignal))
      );
    },
    async resolveApproval(signalValue) {
      const context = Context.current();
      return withGatewayHeartbeat(
        context,
        { approvalId: signalValue.approvalId, phase: "resolving" },
        () => invokeGateway(() => gateway.resolveApproval(signalValue, context.cancellationSignal))
      );
    },
    async consumeInput(signalValue) {
      const context = Context.current();
      return withGatewayHeartbeat(
        context,
        { inputId: signalValue.inputId, phase: "consuming" },
        () => invokeGateway(() => gateway.consumeInput(signalValue, context.cancellationSignal))
      );
    },
  };
}

// The gateway proxy activities carry a 10s heartbeatTimeout but the control
// plane's HTTP call can legitimately take up to the gateway's own timeout
// (~30s, e.g. under a lock or a slow DB). Heartbeating only before the call
// then meant any response slower than 10s tripped a spurious heartbeat timeout
// — burning retries and eventually failing the run. An independent timer keeps
// the activity alive while the single in-flight call runs; it never masks a
// dead worker because the startToClose timeout still bounds the whole activity.
const GATEWAY_HEARTBEAT_INTERVAL_MS = 3_000;

async function withGatewayHeartbeat<T>(
  context: Context,
  details: Record<string, unknown>,
  operation: () => Promise<T>
): Promise<T> {
  context.heartbeat(details);
  const timer = setInterval(() => {
    try {
      context.heartbeat(details);
    } catch {
      // The activity settled between the timer firing and clearInterval.
    }
  }, GATEWAY_HEARTBEAT_INTERVAL_MS);
  try {
    return await operation();
  } finally {
    clearInterval(timer);
  }
}

async function invokeGateway<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RuntimeGatewayProtocolError) {
      throw ApplicationFailure.nonRetryable(error.message, "studio_agent_gateway_protocol_error");
    }
    if (error instanceof RuntimeGatewayHttpError && isNonRetryableHttpStatus(error.status)) {
      throw ApplicationFailure.nonRetryable(
        error.message,
        "studio_agent_gateway_command_rejected",
        { status: error.status }
      );
    }
    throw error;
  }
}

function isNonRetryableHttpStatus(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 425, 429].includes(status);
}
