import { ApplicationFailure, CancelledFailure } from "@temporalio/activity";
import { MockActivityEnvironment } from "@temporalio/testing";
import { DefaultLogger } from "@temporalio/worker";
import { describe, expect, it, vi } from "vitest";
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  type StudioAgentActionExecution,
  type StudioAgentWorkflowInput,
} from "@repo/shared/studio-agent";
import type {
  StudioAgentDenyActionRequest,
  StudioAgentExecuteActionRequest,
} from "@repo/shared/studio-agent-api";
import { createStudioAgentActivities } from "./activities.js";
import { RuntimeGatewayHttpError } from "./gateway-client.js";
import type { StudioAgentRuntimeGateway } from "./gateway-client.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const ACTION_ID = "22222222-2222-4222-8222-222222222222";
const THREAD_ID = "55555555-5555-4555-8555-555555555555";
const POLICY_ID = "66666666-6666-4666-8666-666666666666";
const HASH = "a".repeat(64);

describe("Studio Agent activities", () => {
  it("lets a dispatched transactional action reach canonical completion", async () => {
    const execute = vi.fn(
      async (
        request: StudioAgentExecuteActionRequest,
        signal?: AbortSignal
      ): Promise<StudioAgentActionExecution> => {
        expect(request.actionId).toBe(ACTION_ID);
        expect(signal).toBeInstanceOf(AbortSignal);
        return actionExecution();
      }
    );
    const activities = createStudioAgentActivities({
      gateway: gateway({ executeAction: execute }),
      modelConfig: modelConfig(),
    });
    const environment = activityEnvironment();

    await expect(environment.run(activities.executeAction, executeRequest())).resolves.toEqual(
      actionExecution()
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it("coerces a cancel-time model failure into a Temporal cancellation so steer/stop resumes instead of failing the run", async () => {
    const environment = activityEnvironment();
    const activities = createStudioAgentActivities({
      gateway: gateway({
        loadModelPlan: async () => {
          // steer / stop_and_send cancels the activity; the AI SDK then surfaces
          // the mid-stream abort as an `abort` part that model-runner rethrows
          // as a plain Error.
          environment.cancel();
          await Promise.resolve();
          throw new Error("The model stream was aborted.");
        },
      }),
      modelConfig: modelConfig(),
    });

    const failure = await environment
      .run(activities.runModelStep, workflowInput())
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CancelledFailure);
  });

  it("propagates a genuine (non-cancellation) model failure unchanged", async () => {
    const environment = activityEnvironment();
    const activities = createStudioAgentActivities({
      gateway: gateway({
        loadModelPlan: async () => {
          throw new Error("provider exploded");
        },
      }),
      modelConfig: modelConfig(),
    });

    const failure = await environment
      .run(activities.runModelStep, workflowInput())
      .catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(CancelledFailure);
    expect((failure as Error).message).toContain("provider exploded");
  });

  it("heartbeats independently of model stream cadence so a long time-to-first-token cannot fail the run", async () => {
    vi.useFakeTimers();
    try {
      const environment = activityEnvironment();
      const heartbeats: Array<Record<string, unknown>> = [];
      environment.on("heartbeat", (details) => heartbeats.push(details as Record<string, unknown>));
      let releasePlan!: () => void;
      const planGate = new Promise<void>((resolve) => {
        releasePlan = resolve;
      });
      const activities = createStudioAgentActivities({
        gateway: gateway({
          loadModelPlan: async () => {
            // Simulate the provider not yet returning a first token.
            await planGate;
            throw new Error("end test");
          },
        }),
        modelConfig: modelConfig(),
      });

      const run = environment.run(activities.runModelStep, workflowInput()).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(11_000);
      expect(heartbeats).toContainEqual({ phase: "model_step_alive" });
      releasePlan();
      await run;
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks rejected control-plane commands as non-retryable", async () => {
    const activities = createStudioAgentActivities({
      gateway: gateway({
        denyAction: async () => {
          throw new RuntimeGatewayHttpError(422, "invalid action transition");
        },
      }),
      modelConfig: modelConfig(),
    });
    const environment = activityEnvironment();

    const failure = await environment
      .run(activities.denyAction, denyRequest())
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApplicationFailure);
    expect(failure).toMatchObject({
      type: "studio_agent_gateway_command_rejected",
      nonRetryable: true,
    });
  });
});

function activityEnvironment(): MockActivityEnvironment {
  return new MockActivityEnvironment(undefined, {
    logger: new DefaultLogger("ERROR"),
  });
}

function gateway(overrides: Partial<StudioAgentRuntimeGateway>): StudioAgentRuntimeGateway {
  const unused = async (): Promise<never> => {
    throw new Error("Unexpected gateway call.");
  };
  return {
    appendEvent: unused,
    loadModelPlan: unused,
    completeContextCompaction: unused,
    failContextCompaction: unused,
    prepareAction: unused,
    prepareChildRun: unused,
    executeAction: unused,
    denyAction: unused,
    resolveApproval: unused,
    consumeInput: unused,
    transitionRun: unused,
    ...overrides,
  };
}

function modelConfig() {
  return {
    apiKey: "test",
    baseUrl: undefined,
    textModelId: "qwen3-max",
    visionModelId: "qwen3-vl-plus",
    timeoutMs: 120_000,
    maxOutputTokens: 8_192,
    deltaBytes: 1_024,
    deltaIntervalMs: 50,
  };
}

function workflowInput(): StudioAgentWorkflowInput {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: THREAD_ID,
    runId: RUN_ID,
    rootRunId: RUN_ID,
    parentRunId: null,
    kind: "turn",
    scenario: { id: "story.studio.assistant", version: "1.0.0" },
    permissionPolicy: { policyId: POLICY_ID, revision: 1 },
  };
}

function executeRequest(): StudioAgentExecuteActionRequest {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    actionId: ACTION_ID,
    runId: RUN_ID,
    inputHash: HASH,
  };
}

function denyRequest(): StudioAgentDenyActionRequest {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    actionId: ACTION_ID,
    runId: RUN_ID,
    approvalId: "33333333-3333-4333-8333-333333333333",
    actionInputHash: HASH,
    disposition: "expired",
    reason: "Approval expired.",
    decidedAt: "2026-07-24T01:00:00.000Z",
  };
}

function actionExecution(): StudioAgentActionExecution {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    executionId: "44444444-4444-4444-8444-444444444444",
    actionId: ACTION_ID,
    status: "succeeded",
    output: { applied: true },
    error: null,
    changeSet: null,
    startedAt: "2026-07-24T01:00:00.000Z",
    completedAt: "2026-07-24T01:00:01.000Z",
  };
}
