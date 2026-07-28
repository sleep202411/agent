import { ApplicationFailure } from "@temporalio/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  type StudioAgentApprovalSignal,
  type StudioAgentModelStepOutcome,
  type StudioAgentPreparedAction,
  type StudioAgentWorkflowInput,
} from "@repo/shared/studio-agent";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "33333333-3333-4333-8333-333333333333";
const POLICY_ID = "44444444-4444-4444-8444-444444444444";
const ACTION_ID = "55555555-5555-4555-8555-555555555555";
const STEP_ID = "66666666-6666-4666-8666-666666666666";
const APPROVAL_ID = "77777777-7777-4777-8777-777777777777";
const HASH = "a".repeat(64);
const NOW = "2026-07-28T00:00:00.000Z";
const TRIGGER_EVENT_ID = "evt-01J000000000000000000000";
/** The `ai-input` the BROWSER published to carry the creator's decision. */
const RESUME_EVENT_ID = "evt-01J000000000000000000099";

const doubles = vi.hoisted(() => ({
  activities: {
    openAgentRun: vi.fn(),
    suspendAgentRun: vi.fn(),
    closeAgentRun: vi.fn(),
    runModelStep: vi.fn(),
    transitionRun: vi.fn(),
    executeAction: vi.fn(),
    denyAction: vi.fn(),
    resolveApproval: vi.fn(),
    consumeInput: vi.fn(),
  },
  handlers: new Map<string, (signal: unknown) => void>(),
}));

/**
 * A sandbox stand-in that can actually DELIVER A SIGNAL and WAIT ON A CONDITION.
 *
 * The existing workflow spec stubs `setHandler` away and makes `condition`
 * resolve `true` immediately, which is fine for tests about activity ordering
 * but cannot express an approval at all: the whole flow is "park on a predicate,
 * receive a signal, wake". So this file records the handlers and polls the
 * predicate, which is the minimum needed for the park to be real.
 */
vi.mock("@temporalio/workflow", async () => {
  const { ApplicationFailure } = await import("@temporalio/common");
  class CancellationScope {
    run<T>(operation: () => Promise<T>): Promise<T> {
      return operation();
    }
    cancel(): void {}
    static nonCancellable<T>(operation: () => Promise<T>): Promise<T> {
      return operation();
    }
  }
  return {
    ActivityCancellationType: { WAIT_CANCELLATION_COMPLETED: "WAIT_CANCELLATION_COMPLETED" },
    ApplicationFailure,
    CancellationScope,
    ChildWorkflowCancellationType: { WAIT_CANCELLATION_COMPLETED: "WAIT_CANCELLATION_COMPLETED" },
    ParentClosePolicy: { REQUEST_CANCEL: "REQUEST_CANCEL" },
    condition: async (predicate: () => boolean) => {
      // Bounded so a predicate that can never hold fails the test rather than
      // hanging the suite; 1000 microtask turns is far more than any activity
      // double here needs.
      for (let turn = 0; turn < 1_000; turn += 1) {
        if (predicate()) return true;
        await Promise.resolve();
      }
      return false;
    },
    defineSignal: (name: string) => ({ name }),
    isCancellation: () => false,
    proxyActivities: () => doubles.activities,
    rootCause: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    setHandler: (signal: { name: string }, handler: (value: unknown) => void) => {
      doubles.handlers.set(signal.name, handler);
    },
    startChild: vi.fn(),
  };
});

const { studioAgentWorkflow } = await import("./workflows.js");

/**
 * THE 409, MODELLED HONESTLY.
 *
 * `StudioAgentCapabilityExecutor.execute` refuses an action whose run is not
 * `running` — "Run <id> cannot execute an action from waiting_for_approval",
 * `STUDIO_AGENT_RUN_NOT_EXECUTABLE`, HTTP 409 — and `invokeGateway` classifies a
 * 409 as NON-RETRYABLE, so the whole turn dies. That gate is the entire reason
 * approving anything was impossible, and a double that always succeeds cannot
 * see it. This one tracks the run's status from the transitions the workflow
 * actually performs and enforces the same rule.
 */
function controlPlane() {
  let runStatus = "queued";
  doubles.activities.transitionRun.mockImplementation(
    async (request: { transition: string; reason?: string }) => {
      if (request.transition === "start") runStatus = "running";
      if (request.transition === "wait") {
        runStatus = request.reason === "approval" ? "waiting_for_approval" : "waiting_for_input";
      }
      if (request.transition === "resume") runStatus = "running";
      if (request.transition === "complete") runStatus = "succeeded";
      if (request.transition === "cancel") runStatus = "cancelled";
      return {};
    }
  );
  doubles.activities.executeAction.mockImplementation(async () => {
    if (runStatus !== "running") {
      throw ApplicationFailure.nonRetryable(
        `Run ${RUN_ID} cannot execute an action from ${runStatus}.`,
        "studio_agent_gateway_command_rejected",
        { status: 409 }
      );
    }
    return {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      executionId: ACTION_ID,
      actionId: ACTION_ID,
      status: "succeeded",
    };
  });
  return { status: () => runStatus };
}

/** The creator answering, delivered exactly where the browser would: after the suspend. */
function answerOnSuspend(decision: "approved" | "denied") {
  doubles.activities.suspendAgentRun.mockImplementation(async () => {
    doubles.handlers.get("studio-agent.approval")?.(approvalSignal(decision));
  });
}

describe("studioAgentWorkflow tool approval", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    doubles.handlers.clear();
    doubles.activities.resolveApproval.mockResolvedValue([]);
  });

  /**
   * THE BUG, AS A TEST. Reproduced 2/2 in production: approving a pending action
   * failed the turn with HTTP 409 `STUDIO_AGENT_RUN_NOT_EXECUTABLE`, because the
   * `resume` transition used to live in a `finally` that ran AFTER
   * `executeAction`. Move it back there and this test fails with that exact
   * message.
   */
  it("resumes the run in Postgres BEFORE executing an approved action, so the executor does not 409", async () => {
    controlPlane();
    answerOnSuspend("approved");
    doubles.activities.runModelStep
      .mockResolvedValueOnce(
        outcome({ preparedActions: [askAction()], directive: "wait_for_approval" })
      )
      .mockResolvedValueOnce(outcome({ directive: "complete" }));

    await expect(studioAgentWorkflow(deliveredInput())).resolves.toMatchObject({
      status: "completed",
    });

    expect(doubles.activities.executeAction).toHaveBeenCalledTimes(1);
    const resumeCall = doubles.activities.transitionRun.mock.calls.findIndex(
      (call) => (call[0] as { transition: string }).transition === "resume"
    );
    expect(resumeCall).toBeGreaterThanOrEqual(0);
    expect(doubles.activities.transitionRun.mock.invocationCallOrder[resumeCall]).toBeLessThan(
      doubles.activities.executeAction.mock.invocationCallOrder[0] as number
    );
    expect(transitions()).toEqual(["start", "wait", "resume", "complete"]);
  });

  /**
   * The gap that left a parked turn looking alive: the run stayed OPEN on the
   * channel for as long as the creator took to answer, so every subscriber
   * rendered a spinner. `RunInfo` is the panel's only source of truth for
   * liveness, so nothing but `ai-run-suspend` can correct it.
   */
  it("publishes the suspend on the channel before it waits, and before any decision exists", async () => {
    controlPlane();
    answerOnSuspend("approved");
    doubles.activities.runModelStep
      .mockResolvedValueOnce(
        outcome({ preparedActions: [askAction()], directive: "wait_for_approval" })
      )
      .mockResolvedValueOnce(outcome({ directive: "complete" }));

    await studioAgentWorkflow(deliveredInput());

    expect(doubles.activities.suspendAgentRun).toHaveBeenCalledTimes(1);
    expect(doubles.activities.suspendAgentRun.mock.calls[0]?.[0]).toMatchObject({
      workflow: { runId: RUN_ID },
    });
    // Ordered after the durable `wait` and before the decision is committed:
    // the channel must not advertise a pause Postgres has not recorded, and it
    // must not wait for the creator to answer first.
    expect(doubles.activities.suspendAgentRun.mock.invocationCallOrder[0]).toBeGreaterThan(
      doubles.activities.transitionRun.mock.invocationCallOrder[1] as number
    );
    expect(doubles.activities.suspendAgentRun.mock.invocationCallOrder[0]).toBeLessThan(
      doubles.activities.resolveApproval.mock.invocationCallOrder[0] as number
    );
  });

  /**
   * WHY A RESTART SURVIVES. Nothing process-local carries the resume: the run
   * comes back through the trigger the SIGNAL carried, which Temporal has made
   * durable. Reusing `workflow.delivery` instead — the original prompt's event —
   * would republish `ai-run-start` for an already-started run (that event has no
   * `run-id` header, so `resolveTriggerMetadata` reports no continuation) and
   * the suspended run would never resume.
   */
  it("resumes the channel run through the trigger the creator's answer carried, not the original prompt's", async () => {
    controlPlane();
    answerOnSuspend("approved");
    doubles.activities.runModelStep
      .mockResolvedValueOnce(
        outcome({ preparedActions: [askAction()], directive: "wait_for_approval" })
      )
      .mockResolvedValueOnce(outcome({ directive: "complete" }));

    await studioAgentWorkflow(deliveredInput());

    expect(doubles.activities.openAgentRun).toHaveBeenCalledTimes(2);
    expect(doubles.activities.openAgentRun.mock.calls[0]?.[0]).toMatchObject({
      trigger: { inputEventId: TRIGGER_EVENT_ID },
    });
    expect(doubles.activities.openAgentRun.mock.calls[1]?.[0]).toMatchObject({
      trigger: { inputEventId: RESUME_EVENT_ID },
    });
  });

  it("declines without executing anything, and still resumes and finishes the turn", async () => {
    controlPlane();
    answerOnSuspend("denied");
    doubles.activities.runModelStep
      .mockResolvedValueOnce(
        outcome({ preparedActions: [askAction()], directive: "wait_for_approval" })
      )
      .mockResolvedValueOnce(outcome({ directive: "complete" }));

    await expect(studioAgentWorkflow(deliveredInput())).resolves.toMatchObject({
      status: "completed",
    });

    expect(doubles.activities.executeAction).not.toHaveBeenCalled();
    // The decision still has to be committed and the run still has to leave
    // `waiting_for_approval`, or the next step's `complete` transition 409s.
    expect(doubles.activities.resolveApproval).toHaveBeenCalledTimes(1);
    expect(transitions()).toEqual(["start", "wait", "resume", "complete"]);
    expect(doubles.activities.closeAgentRun.mock.calls[0]?.[0]).toMatchObject({
      reason: "complete",
    });
  });

  /**
   * The whole gated set is answered together — `useChat` only fires the
   * continuation once every approval on the message has a response — so the
   * workflow parks ONCE and resumes ONCE however many calls the step gated.
   */
  it("parks once for a step that gated two calls and executes only the approved one", async () => {
    controlPlane();
    const second = askAction({
      actionId: "88888888-8888-4888-8888-888888888888",
      approvalId: "99999999-9999-4999-8999-999999999999",
      toolCallId: "call-2",
    });
    doubles.activities.suspendAgentRun.mockImplementation(async () => {
      doubles.handlers.get("studio-agent.approval")?.({
        ...approvalSignal("approved"),
        decisions: [decisionFor(askAction(), "approved"), decisionFor(second, "denied")],
      });
    });
    doubles.activities.runModelStep
      .mockResolvedValueOnce(
        outcome({ preparedActions: [askAction(), second], directive: "wait_for_approval" })
      )
      .mockResolvedValueOnce(outcome({ directive: "complete" }));

    await expect(studioAgentWorkflow(deliveredInput())).resolves.toMatchObject({
      status: "completed",
    });

    expect(doubles.activities.suspendAgentRun).toHaveBeenCalledTimes(1);
    expect(doubles.activities.executeAction).toHaveBeenCalledTimes(1);
    expect(doubles.activities.executeAction.mock.calls[0]?.[0]).toMatchObject({
      actionId: ACTION_ID,
    });
    expect(transitions()).toEqual(["start", "wait", "resume", "complete"]);
  });

  /**
   * A channel-less run cannot be asked. `planCapabilities` withholds every
   * ask-gated capability from a delegated task for exactly this reason, so
   * reaching here is a bug — and it must FAIL the turn rather than park a child
   * workflow for the approval's whole TTL.
   */
  it("fails a delegated task that somehow gated a call instead of parking it forever", async () => {
    controlPlane();
    doubles.activities.runModelStep.mockResolvedValueOnce(
      outcome({ preparedActions: [askAction()], directive: "wait_for_approval" })
    );

    await expect(studioAgentWorkflow(workflowInput())).rejects.toThrow(
      "A run with no conversation channel cannot ask for approval."
    );
    expect(doubles.activities.suspendAgentRun).not.toHaveBeenCalled();
  });
});

function transitions(): string[] {
  return doubles.activities.transitionRun.mock.calls.map(
    (call) => (call[0] as { transition: string }).transition
  );
}

function decisionFor(prepared: StudioAgentPreparedAction, decision: "approved" | "denied") {
  return {
    // Non-null: every fixture here is ask-gated.
    approvalId: prepared.approval!.approvalId,
    actionId: prepared.action.actionId,
    actionInputHash: prepared.action.inputHash,
    decision,
  };
}

function approvalSignal(decision: "approved" | "denied"): StudioAgentApprovalSignal {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: THREAD_ID,
    targetRunId: RUN_ID,
    decisions: [decisionFor(askAction(), decision)],
    resumeDelivery: {
      inputEventId: RESUME_EVENT_ID,
      channelName: `studio-agent:thread:${THREAD_ID}`,
    },
    actorId: "user:creator",
    note: null,
    decidedAt: NOW,
  };
}

function askAction(
  overrides: { actionId?: string; approvalId?: string; toolCallId?: string } = {}
): StudioAgentPreparedAction {
  const actionId = overrides.actionId ?? ACTION_ID;
  const approvalId = overrides.approvalId ?? APPROVAL_ID;
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    permissionDecision: "ask",
    action: {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      actionId,
      threadId: THREAD_ID,
      runId: RUN_ID,
      toolCallId: "call_fixture",
      toolName: "cap_fixture_0123456789ab",
      capability: { id: "story.canvas.apply_change_set", version: "1.0.0" },
      effect: "write",
      risk: "medium",
      status: "waiting_for_approval",
      title: "Apply change set",
      summary: "Apply the requested edit to the draft.",
      target: null,
      input: { patch: [] },
      inputHash: HASH,
      approvalId,
      idempotencyKey: `action:${RUN_ID}:${STEP_ID}:${overrides.toolCallId ?? "call-1"}`,
      output: null,
      error: null,
      createdAt: NOW,
      startedAt: null,
      completedAt: null,
    },
    approval: {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      approvalId,
      threadId: THREAD_ID,
      runId: RUN_ID,
      actionId,
      status: "pending",
      reason: "Deletions always require explicit confirmation.",
      actionInputHash: HASH,
      requestedAt: NOW,
      expiresAt: null,
      decision: null,
    },
  };
}

function deliveredInput(): StudioAgentWorkflowInput {
  return {
    ...workflowInput(),
    delivery: {
      inputEventId: TRIGGER_EVENT_ID,
      channelName: `studio-agent:thread:${THREAD_ID}`,
    },
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
    delivery: null,
  };
}

function outcome(
  overrides: Partial<
    Pick<StudioAgentModelStepOutcome, "childRuns" | "directive" | "preparedActions">
  >
): StudioAgentModelStepOutcome {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    stepId: STEP_ID,
    providerResponseId: null,
    assistantSegments: [],
    preparedActions: [],
    childRuns: [],
    directive: "complete",
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
