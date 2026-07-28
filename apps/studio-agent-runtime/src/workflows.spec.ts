import { ApplicationFailure } from "@temporalio/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STUDIO_AGENT_CLIENT_CANCELLED_FAILURE_TYPE,
  STUDIO_AGENT_SCHEMA_VERSION,
  type StudioAgentChildRunPreparation,
  type StudioAgentModelStepOutcome,
  type StudioAgentWorkflowInput,
} from "@repo/shared/studio-agent";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_RUN_ID = "22222222-2222-4222-8222-222222222222";
const THREAD_ID = "33333333-3333-4333-8333-333333333333";
const POLICY_ID = "44444444-4444-4444-8444-444444444444";
const ACTION_ID = "55555555-5555-4555-8555-555555555555";
const STEP_ID = "66666666-6666-4666-8666-666666666666";
const HASH = "a".repeat(64);
const NOW = "2026-07-27T00:00:00.000Z";

// Hoisted so the mock factory below — which vitest lifts above the imports —
// can close over the same doubles the tests assert on.
const doubles = vi.hoisted(() => ({
  activities: {
    openAgentRun: vi.fn(),
    closeAgentRun: vi.fn(),
    runModelStep: vi.fn(),
    transitionRun: vi.fn(),
    executeAction: vi.fn(),
    denyAction: vi.fn(),
    resolveApproval: vi.fn(),
    consumeInput: vi.fn(),
  },
  startChild: vi.fn(),
}));

/**
 * A deterministic stand-in for the workflow sandbox.
 *
 * The workflow's orchestration decisions — which activity runs, which child
 * starts — are ordinary control flow; the durability machinery around them is
 * Temporal's and is not what these tests are about. Replacing the module lets
 * the real `studioAgentWorkflow` run in-process against recorded doubles.
 */
vi.mock("@temporalio/workflow", async () => {
  // The real failure classes: `isClientCancellation` matches on
  // `instanceof ApplicationFailure` plus `.type`, so a hand-rolled stand-in
  // would make the test pass for the wrong reason.
  const { ApplicationFailure } = await import("@temporalio/common");
  class CancellationScope {
    run<T>(operation: () => Promise<T>): Promise<T> {
      return operation();
    }
    cancel(): void {
      // Nothing in these tests cancels.
    }
    static nonCancellable<T>(operation: () => Promise<T>): Promise<T> {
      return operation();
    }
  }
  return {
    ActivityCancellationType: {
      WAIT_CANCELLATION_COMPLETED: "WAIT_CANCELLATION_COMPLETED",
    },
    ApplicationFailure,
    CancellationScope,
    ChildWorkflowCancellationType: {
      WAIT_CANCELLATION_COMPLETED: "WAIT_CANCELLATION_COMPLETED",
    },
    ParentClosePolicy: { REQUEST_CANCEL: "REQUEST_CANCEL" },
    condition: vi.fn(async () => true),
    defineSignal: (name: string) => ({ name }),
    isCancellation: () => false,
    proxyActivities: () => doubles.activities,
    rootCause: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    setHandler: vi.fn(),
    startChild: doubles.startChild,
  };
});

const { studioAgentWorkflow } = await import("./workflows.js");

describe("studioAgentWorkflow child-run preparations", () => {
  beforeEach(() => {
    // `reset`, not `clear`: a test that ends early would otherwise leave an
    // unconsumed `mockResolvedValueOnce` for the next one to pick up.
    vi.resetAllMocks();
    doubles.activities.transitionRun.mockResolvedValue({});
    doubles.startChild.mockResolvedValue({
      result: async () => ({ status: "completed", outcome: null }),
    });
  });

  /**
   * The last fatal gate, from the workflow's side.
   *
   * A refused delegation is a terminal `failed` action the control plane already
   * recorded — there is no child to run, and trying to start one from a
   * preparation that carries no descriptor is exactly the crash the old
   * descriptor-only contract could not express. The turn must survive it and
   * give the model the step in which it corrects the call.
   */
  it("starts no child workflow for a refused delegation and lets the turn continue", async () => {
    doubles.activities.runModelStep
      .mockResolvedValueOnce(outcome({ childRuns: [refused()], directive: "continue" }))
      .mockResolvedValueOnce(outcome({ childRuns: [], directive: "complete" }));

    await expect(studioAgentWorkflow(workflowInput())).resolves.toMatchObject({
      status: "completed",
    });

    expect(doubles.startChild).not.toHaveBeenCalled();
    // The refusal bought the model another step rather than ending the turn.
    expect(doubles.activities.runModelStep).toHaveBeenCalledTimes(2);
    expect(transitions()).toEqual(["start", "complete"]);
  });

  it("starts a child workflow for an accepted delegation", async () => {
    doubles.activities.runModelStep.mockResolvedValueOnce(
      outcome({ childRuns: [started()], directive: "complete" })
    );

    await expect(studioAgentWorkflow(workflowInput())).resolves.toMatchObject({
      status: "completed",
    });

    expect(doubles.startChild).toHaveBeenCalledTimes(1);
    expect(doubles.startChild.mock.calls[0]?.[1]).toMatchObject({
      workflowId: CHILD_RUN_ID,
    });
  });

  it("starts only the accepted delegation when a step mixes both outcomes", async () => {
    doubles.activities.runModelStep.mockResolvedValueOnce(
      outcome({ childRuns: [refused(), started()], directive: "complete" })
    );

    await expect(studioAgentWorkflow(workflowInput())).resolves.toMatchObject({
      status: "completed",
    });

    expect(doubles.startChild).toHaveBeenCalledTimes(1);
    expect(doubles.startChild.mock.calls[0]?.[1]).toMatchObject({
      workflowId: CHILD_RUN_ID,
    });
  });
});

/**
 * The delivery lifecycle, which is the half a subscriber actually sees.
 *
 * `run.end` is not bookkeeping: Ably's production guidance is that a turn which
 * exhausts its retries without it leaves the Run OPEN, and every browser
 * watching sits on `streaming` forever with no way to recover but a reload.
 * These are the cases where forgetting it is easiest.
 */
describe("studioAgentWorkflow delivery lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    doubles.activities.transitionRun.mockResolvedValue({});
  });

  it("opens the run only after the control plane accepted it, and closes it on completion", async () => {
    doubles.activities.runModelStep.mockResolvedValueOnce(
      outcome({ childRuns: [], directive: "complete" })
    );

    await expect(studioAgentWorkflow(deliveredInput())).resolves.toMatchObject({
      status: "completed",
    });

    expect(doubles.activities.openAgentRun).toHaveBeenCalledTimes(1);
    // The `start` transition is what admits the run; publishing `ai-run-start`
    // before it would advertise a turn Postgres could still refuse.
    expect(doubles.activities.transitionRun.mock.invocationCallOrder[0]).toBeLessThan(
      doubles.activities.openAgentRun.mock.invocationCallOrder[0] as number
    );
    expect(doubles.activities.closeAgentRun).toHaveBeenCalledTimes(1);
    expect(doubles.activities.closeAgentRun.mock.calls[0]?.[0]).toMatchObject({
      reason: "complete",
      workflow: { runId: RUN_ID },
    });
  });

  it("still publishes the run terminal when the turn throws, carrying why", async () => {
    doubles.activities.runModelStep.mockRejectedValueOnce(new Error("provider exploded"));

    await expect(studioAgentWorkflow(deliveredInput())).rejects.toThrow("provider exploded");

    expect(transitions()).toEqual(["start", "fail"]);
    expect(doubles.activities.closeAgentRun).toHaveBeenCalledTimes(1);
    expect(doubles.activities.closeAgentRun.mock.calls[0]?.[0]).toMatchObject({
      reason: "error",
      error: { code: "runtime.workflow_failed", message: "provider exploded" },
    });
  });

  /**
   * THE SILENT FAILURE, FROM THE WORKFLOW'S SIDE.
   *
   * This assertion used to read `not.toHaveBeenCalled()`, on the theory that a
   * run with no `ai-run-start` has nothing to close. What that produced in
   * production was a creator watching an empty panel forever while Postgres
   * recorded the run as `failed` and the invocation POST had already returned
   * 201 — no token, no error, no terminal, nothing on the only channel the
   * browser is listening to. `closeAgentRun` now opens the run in order to end
   * it, so the terminal is owed here, not skipped.
   */
  it("publishes the run terminal even when the open never succeeded", async () => {
    doubles.activities.openAgentRun.mockRejectedValueOnce(new Error("ably unreachable"));

    await expect(studioAgentWorkflow(deliveredInput())).rejects.toThrow("ably unreachable");

    expect(transitions()).toEqual(["start", "fail"]);
    expect(doubles.activities.closeAgentRun).toHaveBeenCalledTimes(1);
    expect(doubles.activities.closeAgentRun.mock.calls[0]?.[0]).toMatchObject({
      reason: "error",
      error: { message: "ably unreachable" },
    });
  });

  it("publishes exactly one terminal even when the failure arrives after the durable terminal", async () => {
    doubles.activities.runModelStep.mockResolvedValueOnce(
      outcome({ childRuns: [], directive: "complete" })
    );
    doubles.activities.transitionRun.mockImplementation(async (request: { transition: string }) => {
      if (request.transition === "complete") {
        return {};
      }
      return {};
    });
    doubles.activities.closeAgentRun.mockRejectedValueOnce(new Error("terminal publish failed"));

    await expect(studioAgentWorkflow(deliveredInput())).rejects.toThrow("terminal publish failed");

    expect(doubles.activities.closeAgentRun).toHaveBeenCalledTimes(1);
  });

  /**
   * The stop button. `session.cancel(runId)` fires the run's abort signal
   * inside the activity; the activity names it; the workflow must take its
   * ordinary cancel path — a durable `cancel` transition and a `cancelled`
   * terminal — and COMPLETE, because a turn the creator ended is not a failure.
   */
  it("records a creator cancel as a cancelled run rather than an error", async () => {
    doubles.activities.runModelStep.mockRejectedValueOnce(
      ApplicationFailure.nonRetryable(
        "The creator cancelled the run on the conversation channel.",
        STUDIO_AGENT_CLIENT_CANCELLED_FAILURE_TYPE
      )
    );

    await expect(studioAgentWorkflow(deliveredInput())).resolves.toEqual({
      status: "cancelled",
      outcome: null,
    });

    expect(transitions()).toEqual(["start", "cancel"]);
    expect(doubles.activities.transitionRun.mock.calls[1]?.[0]).toMatchObject({
      transition: "cancel",
    });
    expect(doubles.activities.closeAgentRun).toHaveBeenCalledTimes(1);
    expect(doubles.activities.closeAgentRun.mock.calls[0]?.[0]).toMatchObject({
      reason: "cancelled",
    });
  });

  it("records a creator cancel that arrived while the run was still opening", async () => {
    doubles.activities.openAgentRun.mockRejectedValueOnce(
      ApplicationFailure.nonRetryable(
        "unable to start run; run was cancelled before start()",
        STUDIO_AGENT_CLIENT_CANCELLED_FAILURE_TYPE
      )
    );

    await expect(studioAgentWorkflow(deliveredInput())).resolves.toEqual({
      status: "cancelled",
      outcome: null,
    });

    expect(transitions()).toEqual(["start", "cancel"]);
    expect(doubles.activities.closeAgentRun.mock.calls[0]?.[0]).toMatchObject({
      reason: "cancelled",
    });
  });

  it("opens no run for a delegated task, which has no channel identity", async () => {
    doubles.activities.runModelStep.mockResolvedValueOnce(
      outcome({ childRuns: [], directive: "complete" })
    );

    await expect(studioAgentWorkflow(workflowInput())).resolves.toMatchObject({
      status: "completed",
    });

    // Not "called with delivery: null" — not scheduled at all. A delegated task
    // has no trigger event, and `openAgentRun` now takes the trigger as an
    // argument, so there is nothing to hand it.
    expect(doubles.activities.openAgentRun).not.toHaveBeenCalled();
    expect(doubles.activities.closeAgentRun).toHaveBeenCalledTimes(1);
  });
});

function deliveredInput(): StudioAgentWorkflowInput {
  return {
    ...workflowInput(),
    delivery: {
      inputEventId: "evt-01J000000000000000000000",
      channelName: `studio-agent:thread:${THREAD_ID}`,
    },
  };
}

function transitions(): string[] {
  return doubles.activities.transitionRun.mock.calls.map(
    (call) => (call[0] as { transition: string }).transition
  );
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
    delivery: null,
  };
}

function outcome(
  overrides: Pick<StudioAgentModelStepOutcome, "childRuns" | "directive">
): StudioAgentModelStepOutcome {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    stepId: STEP_ID,
    providerResponseId: null,
    assistantSegments: [],
    preparedActions: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: null,
      reasoningTokens: null,
    },
    completedAt: NOW,
    ...overrides,
  };
}

function started(): StudioAgentChildRunPreparation {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    outcome: "started",
    descriptor: {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      threadId: THREAD_ID,
      runId: CHILD_RUN_ID,
      rootRunId: RUN_ID,
      parentRunId: RUN_ID,
      task: { taskKey: "draft_branch", title: "Draft branch" },
      scenario: { id: "story.studio.assistant", version: "1.0.0" },
      permissionPolicy: { policyId: POLICY_ID, revision: 1 },
      triggerMessageId: null,
    },
  };
}

function refused(): StudioAgentChildRunPreparation {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    outcome: "refused",
    action: {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      actionId: ACTION_ID,
      threadId: THREAD_ID,
      runId: RUN_ID,
      toolCallId: "call_fixture",
      toolName: "cap_fixture_0123456789ab",
      capability: { id: "studio.task.delegate", version: "1.0.0" },
      effect: "read",
      risk: "low",
      status: "failed",
      title: "Delegate studio task",
      summary: "Run an independent, cancellable child task.",
      target: null,
      input: { taskKey: "draft_branch", title: "Draft branch" },
      inputHash: HASH,
      approvalId: null,
      idempotencyKey: `action:${RUN_ID}:${STEP_ID}:delegate-malformed`,
      output: null,
      error: {
        code: "studio_agent.invalid_action_input",
        message:
          "The capability input is invalid and was not executed. Correct it and call the tool again. instruction: is required",
        retryable: false,
        details: { issues: [{ path: "instruction", message: "is required" }] },
      },
      createdAt: NOW,
      startedAt: NOW,
      completedAt: NOW,
    },
  };
}
