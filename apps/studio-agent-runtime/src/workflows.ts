import {
  ActivityCancellationType,
  CancellationScope,
  ChildWorkflowCancellationType,
  ParentClosePolicy,
  condition,
  defineSignal,
  isCancellation,
  proxyActivities,
  rootCause,
  setHandler,
  startChild,
} from "@temporalio/workflow";
import {
  STUDIO_AGENT_ACTIVITY_TASK_QUEUE,
  STUDIO_AGENT_SCHEMA_VERSION,
  StudioAgentApprovalSignalSchema,
  StudioAgentCancelSignalSchema,
  StudioAgentInputSignalSchema,
  StudioAgentWorkflowInputSchema,
  type StudioAgentApprovalSignal,
  type StudioAgentCancelSignal,
  type StudioAgentChildRunDescriptor,
  type StudioAgentInputSignal,
  type StudioAgentModelStepOutcome,
  type StudioAgentPreparedAction,
  type StudioAgentWorkflowInput,
} from "@repo/shared/studio-agent";
import type {
  StudioAgentDenyActionRequest,
  StudioAgentExecuteActionRequest,
  StudioAgentRunTransitionRequest,
} from "@repo/shared/studio-agent-api";
import type { StudioAgentActivities } from "./activities.js";
import { StudioAgentSignalInbox } from "./signal-inbox.js";

export const studioAgentInputSignal = defineSignal<[StudioAgentInputSignal]>("studio-agent.input");
export const studioAgentApprovalSignal =
  defineSignal<[StudioAgentApprovalSignal]>("studio-agent.approval");
export const studioAgentCancelSignal =
  defineSignal<[StudioAgentCancelSignal]>("studio-agent.cancel");

const { runModelStep } = proxyActivities<Pick<StudioAgentActivities, "runModelStep">>({
  taskQueue: STUDIO_AGENT_ACTIVITY_TASK_QUEUE,
  startToCloseTimeout: "16 minutes",
  // The activity emits an independent 5s heartbeat (activities.ts) so this
  // window is never gated on model stream cadence; 30s leaves margin for a
  // brief worker event-loop stall without masking a genuinely dead activity.
  heartbeatTimeout: "30 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 1 },
});

const { executeAction } = proxyActivities<Pick<StudioAgentActivities, "executeAction">>({
  taskQueue: STUDIO_AGENT_ACTIVITY_TASK_QUEUE,
  // Direct actions are deliberately limited to short, transactional,
  // idempotent effects. Anything that cannot finish inside this envelope must
  // be represented as a cancellable child workflow instead of holding steer
  // and stop requests hostage behind a long activity.
  startToCloseTimeout: "45 seconds",
  scheduleToCloseTimeout: "2 minutes",
  heartbeatTimeout: "10 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    initialInterval: "500 milliseconds",
    backoffCoefficient: 2,
    maximumInterval: "5 seconds",
    maximumAttempts: 3,
  },
});

const gatewayActivities = proxyActivities<
  Pick<StudioAgentActivities, "transitionRun" | "denyAction" | "resolveApproval" | "consumeInput">
>({
  taskQueue: STUDIO_AGENT_ACTIVITY_TASK_QUEUE,
  startToCloseTimeout: "45 seconds",
  scheduleToCloseTimeout: "3 minutes",
  heartbeatTimeout: "10 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    initialInterval: "500 milliseconds",
    backoffCoefficient: 2,
    maximumInterval: "10 seconds",
    maximumAttempts: 5,
  },
});

export interface StudioAgentWorkflowResult {
  status: "completed" | "cancelled";
  outcome: StudioAgentModelStepOutcome | null;
}

type RunTransitionCommand<T = StudioAgentRunTransitionRequest> = T extends unknown
  ? Omit<T, "schemaVersion" | "workflow">
  : never;

export async function studioAgentWorkflow(
  rawInput: StudioAgentWorkflowInput
): Promise<StudioAgentWorkflowResult> {
  const input = StudioAgentWorkflowInputSchema.parse(rawInput);
  const inbox = new StudioAgentSignalInbox();
  let activeScope: CancellationScope | null = null;
  let terminalPersisted = false;

  setHandler(studioAgentInputSignal, (rawSignal) => {
    const parsed = StudioAgentInputSignalSchema.safeParse(rawSignal);
    if (
      !parsed.success ||
      parsed.data.threadId !== input.threadId ||
      parsed.data.targetRunId !== input.runId
    ) {
      return;
    }
    inbox.addInput(parsed.data);
    if (parsed.data.delivery !== "enqueue") {
      activeScope?.cancel();
    }
  });
  setHandler(studioAgentApprovalSignal, (rawSignal) => {
    const parsed = StudioAgentApprovalSignalSchema.safeParse(rawSignal);
    if (!parsed.success || parsed.data.targetRunId !== input.runId) {
      return;
    }
    inbox.addApproval(parsed.data);
  });
  setHandler(studioAgentCancelSignal, (rawSignal) => {
    const parsed = StudioAgentCancelSignalSchema.safeParse(rawSignal);
    if (
      !parsed.success ||
      parsed.data.threadId !== input.threadId ||
      parsed.data.targetRunId !== input.runId
    ) {
      return;
    }
    inbox.requestCancellation(parsed.data);
    activeScope?.cancel();
  });

  const transition = (request: RunTransitionCommand) =>
    gatewayActivities.transitionRun({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      workflow: input,
      ...request,
    } as StudioAgentRunTransitionRequest);

  const runInterruptibly = async <T>(operation: () => Promise<T>): Promise<T> => {
    const scope = new CancellationScope({ cancellable: true });
    activeScope = scope;
    try {
      return await scope.run(operation);
    } finally {
      if (activeScope === scope) {
        activeScope = null;
      }
    }
  };

  const cancelRun = async (
    reason: string,
    requestedByInputId: string | null
  ): Promise<StudioAgentWorkflowResult> => {
    await CancellationScope.nonCancellable(() =>
      transition({
        transition: "cancel",
        reason,
        requestedByInputId,
      })
    );
    terminalPersisted = true;
    return { status: "cancelled", outcome: null };
  };

  const handleInterrupt = async (): Promise<"continue" | "stopped" | null> => {
    const cancellation = inbox.cancellation();
    if (cancellation) {
      await cancelRun(cancellation.reason, null);
      return "stopped";
    }
    const interrupt = inbox.takeInterrupt();
    if (!interrupt) {
      return null;
    }
    if (interrupt.delivery === "stop_and_send") {
      await cancelRun("Superseded by a stop-and-send input.", interrupt.inputId);
      return "stopped";
    }
    await CancellationScope.nonCancellable(() => gatewayActivities.consumeInput(interrupt));
    return "continue";
  };

  try {
    await transition({ transition: "start" });

    while (true) {
      const beforeStep = await handleInterrupt();
      if (beforeStep === "stopped") {
        return { status: "cancelled", outcome: null };
      }

      let outcome: StudioAgentModelStepOutcome;
      try {
        outcome = await runInterruptibly(() => runModelStep(input));
      } catch (error) {
        if (isCancellation(error)) {
          const interruption = await handleInterrupt();
          if (interruption === "continue") {
            continue;
          }
          if (interruption === "stopped") {
            return { status: "cancelled", outcome: null };
          }
        }
        throw error;
      }

      const afterStep = await handleInterrupt();
      if (afterStep === "continue") {
        continue;
      }
      if (afterStep === "stopped") {
        return { status: "cancelled", outcome: null };
      }

      let restartModel = false;
      for (const prepared of outcome.preparedActions) {
        let actionResult: "done" | "restart" | "stopped";
        try {
          actionResult = await processPreparedAction({
            input,
            prepared,
            inbox,
            transition,
            runInterruptibly,
            handleInterrupt,
          });
        } catch (error) {
          if (isCancellation(error)) {
            const interruption = await handleInterrupt();
            if (interruption === "continue") {
              restartModel = true;
              break;
            }
            if (interruption === "stopped") {
              return { status: "cancelled", outcome: null };
            }
          }
          throw error;
        }
        if (actionResult === "stopped") {
          return { status: "cancelled", outcome: null };
        }
        if (actionResult === "restart") {
          restartModel = true;
          break;
        }
      }
      if (restartModel) {
        continue;
      }

      if (outcome.childRuns.length > 0) {
        try {
          await runInterruptibly(() =>
            Promise.all(outcome.childRuns.map((descriptor) => runChild(input, descriptor)))
          );
        } catch (error) {
          if (isCancellation(error)) {
            const interruption = await handleInterrupt();
            if (interruption === "continue") {
              continue;
            }
            if (interruption === "stopped") {
              return { status: "cancelled", outcome: null };
            }
          }
          throw error;
        }
      }

      if (outcome.directive === "continue") {
        continue;
      }
      if (outcome.directive === "wait_for_input") {
        await transition({
          transition: "wait",
          reason: "input",
          referenceId: outcome.stepId,
        });
        await condition(() => inbox.peekInterrupt() !== null || inbox.cancellation() !== null);
        const interruption = await handleInterrupt();
        if (interruption === "continue") {
          await transition({
            transition: "resume",
            resumedFrom: "input",
            referenceId: outcome.stepId,
          });
          continue;
        }
        return { status: "cancelled", outcome: null };
      }

      await transition({ transition: "complete", outcome });
      terminalPersisted = true;
      return { status: "completed", outcome };
    }
  } catch (error) {
    if (terminalPersisted) {
      throw error;
    }
    if (isCancellation(error)) {
      await CancellationScope.nonCancellable(() =>
        transition({
          transition: "cancel",
          reason: "Temporal workflow cancellation requested.",
          requestedByInputId: null,
        })
      );
      throw error;
    }
    await CancellationScope.nonCancellable(() =>
      transition({
        transition: "fail",
        error: workflowError(error),
      })
    );
    throw error;
  }
}

async function processPreparedAction(input: {
  input: StudioAgentWorkflowInput;
  prepared: StudioAgentPreparedAction;
  inbox: StudioAgentSignalInbox;
  transition(request: RunTransitionCommand): Promise<unknown>;
  runInterruptibly<T>(operation: () => Promise<T>): Promise<T>;
  handleInterrupt(): Promise<"continue" | "stopped" | null>;
}): Promise<"done" | "restart" | "stopped"> {
  if (input.input.runId !== input.prepared.action.runId) {
    throw new Error("Prepared action belongs to a different workflow run.");
  }
  const { prepared, inbox, transition, runInterruptibly, handleInterrupt } = input;
  if (prepared.permissionDecision === "deny") {
    return "done";
  }
  if (prepared.permissionDecision === "allow") {
    await runInterruptibly(() => executePreparedAction(prepared));
    return "done";
  }

  const approval = prepared.approval;
  if (!approval) {
    throw new Error("Approval-gated action is missing its approval record.");
  }
  await transition({
    transition: "wait",
    reason: "approval",
    referenceId: approval.approvalId,
  });

  const expiresInMs =
    approval.expiresAt === null
      ? null
      : Math.max(0, new Date(approval.expiresAt).getTime() - Date.now());
  const wakeCondition = () =>
    inbox.hasApproval(approval.approvalId, prepared.action.actionId, prepared.action.inputHash) ||
    inbox.peekInterrupt() !== null ||
    inbox.cancellation() !== null;
  const wokeBeforeExpiry =
    expiresInMs === null
      ? (await condition(wakeCondition), true)
      : await condition(wakeCondition, expiresInMs);

  if (!wokeBeforeExpiry) {
    await gatewayActivities.denyAction(
      denyRequest(prepared, "Approval expired.", approval.approvalId, "expired")
    );
    await transition({
      transition: "resume",
      resumedFrom: "approval",
      referenceId: approval.approvalId,
    });
    return "done";
  }

  if (inbox.cancellation() !== null) {
    const interruption = await handleInterrupt();
    if (interruption !== "stopped") {
      throw new Error("Cancellation did not stop the approval wait.");
    }
    return "stopped";
  }

  // The server serializes approval decisions and interrupting inputs under the
  // thread lock. If an approval signal exists, the approval transaction won
  // that race and must be honored before a later steer is consumed.
  const decision = inbox.takeApproval(
    approval.approvalId,
    prepared.action.actionId,
    prepared.action.inputHash
  );
  if (decision) {
    await gatewayActivities.resolveApproval(decision);
    try {
      if (decision.decision === "approved") {
        await runInterruptibly(() => executePreparedAction(prepared));
      }
    } finally {
      // The approval decision has already committed, so the run must leave
      // waiting_for_approval even if a steer cancels the approved action
      // mid-execution. If the cancellation threw over this resume the run would
      // stay parked, and the restarted model step's next `complete` transition
      // would 409 against waiting_for_approval and fail the whole turn. Run it
      // non-cancellable so the steer that triggered the cancel cannot also skip
      // the resume.
      await CancellationScope.nonCancellable(() =>
        transition({
          transition: "resume",
          resumedFrom: "approval",
          referenceId: approval.approvalId,
        })
      );
    }
    return "done";
  }

  if (inbox.peekInterrupt() !== null) {
    await gatewayActivities.denyAction(
      denyRequest(prepared, "Action superseded by a newer input.", approval.approvalId, "cancelled")
    );
    const interruption = await handleInterrupt();
    if (!interruption) {
      throw new Error("Pending interruption disappeared before it was handled.");
    }
    if (interruption === "continue") {
      await transition({
        transition: "resume",
        resumedFrom: "approval",
        referenceId: approval.approvalId,
      });
      return "restart";
    }
    return "stopped";
  }

  throw new Error("Approval wake-up did not contain a matching decision.");
}

async function executePreparedAction(prepared: StudioAgentPreparedAction): Promise<void> {
  const request: StudioAgentExecuteActionRequest = {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    actionId: prepared.action.actionId,
    runId: prepared.action.runId,
    inputHash: prepared.action.inputHash,
  };
  await executeAction(request);
}

function denyRequest(
  prepared: StudioAgentPreparedAction,
  reason: string,
  approvalId: string,
  disposition: StudioAgentDenyActionRequest["disposition"]
): StudioAgentDenyActionRequest {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    actionId: prepared.action.actionId,
    runId: prepared.action.runId,
    approvalId,
    actionInputHash: prepared.action.inputHash,
    disposition,
    reason,
    decidedAt: new Date().toISOString(),
  };
}

async function runChild(
  parent: StudioAgentWorkflowInput,
  descriptor: StudioAgentChildRunDescriptor
): Promise<StudioAgentWorkflowResult> {
  if (
    descriptor.threadId !== parent.threadId ||
    descriptor.rootRunId !== parent.rootRunId ||
    descriptor.parentRunId !== parent.runId
  ) {
    throw new Error("Child run descriptor does not belong to this parent workflow.");
  }
  return (
    await startChild(studioAgentWorkflow, {
      workflowId: descriptor.runId,
      parentClosePolicy: ParentClosePolicy.REQUEST_CANCEL,
      cancellationType: ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
      args: [
        {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          threadId: descriptor.threadId,
          runId: descriptor.runId,
          rootRunId: descriptor.rootRunId,
          parentRunId: descriptor.parentRunId,
          kind: "task",
          scenario: descriptor.scenario,
          permissionPolicy: descriptor.permissionPolicy,
        },
      ],
    })
  ).result();
}

function workflowError(error: unknown) {
  const message = rootCause(error) ?? String(error);
  return {
    code: "runtime.workflow_failed" as const,
    message: message.slice(0, 8_000) || "Studio Agent workflow failed.",
    retryable: false,
    details: null,
  };
}
