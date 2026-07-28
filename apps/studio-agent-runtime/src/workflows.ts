import {
  ActivityCancellationType,
  ApplicationFailure,
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
  STUDIO_AGENT_CLIENT_CANCELLED_FAILURE_TYPE,
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
  StudioAgentCloseRunRequest,
  StudioAgentDenyActionRequest,
  StudioAgentExecuteActionRequest,
  StudioAgentRunTransitionRequest,
} from "@repo/shared/studio-agent-api";
import type { StudioAgentActivities } from "./activities.js";
import { StudioAgentSignalInbox, type StudioAgentApprovalChallenge } from "./signal-inbox.js";

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

/**
 * The delivery half of the run lifecycle: two activities that bracket the turn
 * on the conversation channel.
 *
 * `openAgentRun` pages the channel's history until the client's `ai-input` is
 * in the tree and only then publishes `ai-run-start`, so its window has to
 * cover a full history drain on a long thread; `closeAgentRun` publishes the
 * terminal that unsticks every subscriber's UI — opening the run itself if it
 * has to — so it retries hard and is invoked non-cancellably. Both are ordinary
 * activities, so the workflow stays deterministic.
 */
const deliveryActivities = proxyActivities<
  Pick<StudioAgentActivities, "openAgentRun" | "suspendAgentRun" | "closeAgentRun">
>({
  taskQueue: STUDIO_AGENT_ACTIVITY_TASK_QUEUE,
  startToCloseTimeout: "60 seconds",
  scheduleToCloseTimeout: "5 minutes",
  heartbeatTimeout: "10 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    initialInterval: "500 milliseconds",
    backoffCoefficient: 2,
    maximumInterval: "10 seconds",
    maximumAttempts: 5,
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
    await closeRun("cancelled");
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

  let terminalDelivered = false;
  /**
   * Publish the run's terminal, once, on every exit path.
   *
   * Ably's production guidance: a turn that exhausts its retries without
   * `run.end` leaves the Run OPEN, and every subscriber sits on `streaming`
   * forever. Non-cancellable for the same reason the terminal DB transition is
   * — a steer or a cancel arriving mid-teardown must not skip it.
   *
   * DELIBERATELY UNGATED ON WHETHER THE OPEN SUCCEEDED. It used to be gated,
   * and that is precisely how a run that failed in `openAgentRun` published
   * nothing at all: Postgres recorded `failed`, the invocation POST had already
   * returned 201, and the browser — whose only live source of truth is this
   * channel — was never told anything. `closeAgentRun` now opens the run itself
   * when there is no `ai-run-start` to adopt, so "we could not open it" is a
   * reason to publish the terminal, not a reason to skip it. The only guard is
   * once-only.
   */
  const closeRun = async (
    reason: StudioAgentCloseRunRequest["reason"],
    error: StudioAgentCloseRunRequest["error"] = null
  ): Promise<void> => {
    if (terminalDelivered) return;
    terminalDelivered = true;
    await CancellationScope.nonCancellable(() =>
      deliveryActivities.closeAgentRun({
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        workflow: input,
        reason,
        error,
      })
    );
  };

  const openRun = async (trigger: StudioAgentWorkflowInput["delivery"]) => {
    if (!trigger) return;
    await deliveryActivities.openAgentRun({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      workflow: input,
      trigger,
    });
  };

  try {
    await transition({ transition: "start" });
    // Opened AFTER the control plane accepted the run and BEFORE any output, so
    // the channel never advertises a turn Postgres refused to start.
    await openRun(input.delivery);

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

      // THE SUSPEND / RESUME LEG. The model did not run these calls — the AI
      // SDK gated them on `needsApproval` and finished the step — so nothing
      // else this step produced may land until the creator has answered.
      let approvals: ApprovalOutcomeByAction | null = null;
      if (outcome.directive === "wait_for_approval") {
        const parked = await parkForApproval({
          input,
          gated: outcome.preparedActions.filter(
            (prepared) => prepared.permissionDecision === "ask"
          ),
          inbox,
          transition,
          openRun,
          handleInterrupt,
        });
        if (parked.result === "stopped") {
          return { status: "cancelled", outcome: null };
        }
        if (parked.result === "restart") {
          continue;
        }
        approvals = parked.approvals;
      }

      let restartModel = false;
      for (const prepared of outcome.preparedActions) {
        let actionResult: "done" | "restart" | "stopped";
        try {
          actionResult = await processPreparedAction({
            input,
            prepared,
            approvals,
            runInterruptibly,
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

      // A refused delegation starts nothing: the control plane recorded it as a
      // terminal `failed` action inside the prepare transaction, and the model
      // reads it back as a tool result on the step this `continue` directive
      // buys it. Only accepted preparations become child workflows.
      const startedChildRuns = outcome.childRuns.filter(
        (preparation) => preparation.outcome === "started"
      );
      if (startedChildRuns.length > 0) {
        try {
          await runInterruptibly(() =>
            Promise.all(
              startedChildRuns.map((preparation) => runChild(input, preparation.descriptor))
            )
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

      // `wait_for_approval` continues for the same reason `continue` does: the
      // approved calls have now produced tool results, and the model owes the
      // creator a reply that reads them. A denied call is a result too.
      if (outcome.directive === "continue" || outcome.directive === "wait_for_approval") {
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
      await closeRun("complete");
      return { status: "completed", outcome };
    }
  } catch (error) {
    if (terminalPersisted) {
      await closeRun("error", workflowError(error));
      throw error;
    }
    // The creator pressed stop. Same durable outcome as any other stop, and the
    // workflow COMPLETES — a turn the creator ended is not a workflow failure.
    // Handled here, in ONE place, rather than beside every activity that can
    // raise it: every such throw already funnels through this catch.
    if (isClientCancellation(error)) {
      return cancelRun(CREATOR_CANCELLED_REASON, null);
    }
    if (isCancellation(error)) {
      await CancellationScope.nonCancellable(() =>
        transition({
          transition: "cancel",
          reason: "Temporal workflow cancellation requested.",
          requestedByInputId: null,
        })
      );
      await closeRun("cancelled");
      throw error;
    }
    const failure = workflowError(error);
    await CancellationScope.nonCancellable(() =>
      transition({
        transition: "fail",
        error: failure,
      })
    );
    // WITH the failure, not just the word "error". This terminal is the only
    // thing a creator receives from a turn that died before it produced a
    // single part, so it has to carry why.
    await closeRun("error", failure);
    throw error;
  }
}

const CREATOR_CANCELLED_REASON = "The creator stopped the turn.";

/**
 * Did an activity report that the CREATOR cancelled this run on the channel?
 *
 * Temporal wraps an activity's `ApplicationFailure` in an `ActivityFailure`, so
 * the type is read off the cause chain rather than the top-level error. Matched
 * by the shared constant, never by a string literal here — a rename that missed
 * this file would silently turn every creator cancel back into a billed error.
 */
function isClientCancellation(error: unknown): boolean {
  for (let current: unknown = error; current != null; current = (current as Error).cause) {
    if (
      current instanceof ApplicationFailure &&
      current.type === STUDIO_AGENT_CLIENT_CANCELLED_FAILURE_TYPE
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The creator's answer, indexed by the action it belongs to.
 *
 * A plain record keyed by action id, not a Map: workflow code is replayed, and
 * the value crosses no activity boundary — this exists purely so the execution
 * loop below can ask "was THIS one approved" without re-deriving the answer.
 */
type ApprovalOutcomeByAction = Record<string, "approved" | "denied">;

interface ApprovalParkResult {
  result: "resumed" | "restart" | "stopped";
  approvals: ApprovalOutcomeByAction | null;
}

/**
 * Park the turn on the creator, VISIBLY, and bring it back.
 *
 * FOUR THINGS HAPPEN HERE AND THE ORDER OF TWO OF THEM IS THE BUG FIX.
 *
 * 1. Postgres records `waiting_for_approval`, so the run is durably parked.
 * 2. The CHANNEL records `ai-run-suspend`, so every subscriber stops rendering
 *    a spinner. This step did not exist before, and its absence is why a run
 *    could sit 90+ seconds looking like it was working.
 * 3. When the answer arrives, the run RESUMES on the channel through the
 *    trigger the answer carried — `adoptRun()` refuses a suspended run, and only
 *    an input event stamped with the run-id makes `createRun().start()` publish
 *    `ai-run-resume` rather than a duplicate `ai-run-start`.
 * 4. The DB `resume` transition runs BEFORE any approved action executes.
 *
 * POINT 4 IS THE 409. It used to run in a `finally`, i.e. AFTER
 * `executeAction`, so the capability executor read the run as
 * `waiting_for_approval` and refused with
 * `STUDIO_AGENT_RUN_NOT_EXECUTABLE` — "Run <id> cannot execute an action from
 * waiting_for_approval" — which `invokeGateway` classifies as a non-retryable
 * 409 and which therefore failed the whole turn. Approving anything was
 * impossible; the only reason the bug survived is that nothing had ever
 * produced a `tool-approval-request` for a creator to answer. The resume is now
 * unconditional and first: the decision has already committed, so the run is no
 * longer waiting for it whatever happens to the action afterwards.
 */
async function parkForApproval(input: {
  input: StudioAgentWorkflowInput;
  gated: readonly StudioAgentPreparedAction[];
  inbox: StudioAgentSignalInbox;
  transition(request: RunTransitionCommand): Promise<unknown>;
  openRun(trigger: StudioAgentWorkflowInput["delivery"]): Promise<void>;
  handleInterrupt(): Promise<"continue" | "stopped" | null>;
}): Promise<ApprovalParkResult> {
  const { gated, inbox, transition, openRun, handleInterrupt } = input;
  if (gated.length === 0) {
    throw new Error("A turn cannot wait for approval with no approval-gated action.");
  }
  if (!input.input.delivery) {
    // Unreachable by construction: `planCapabilities` withholds every ask-gated
    // capability from a run with no channel, precisely because there would be
    // nowhere to answer. Stated as a failure rather than a wait so the bug
    // surfaces as a failed turn instead of a child workflow parked for the
    // approval's whole TTL.
    throw new Error("A run with no conversation channel cannot ask for approval.");
  }
  const challenges: StudioAgentApprovalChallenge[] = gated.map((prepared) => {
    if (!prepared.approval) {
      throw new Error("Approval-gated action is missing its approval record.");
    }
    return {
      approvalId: prepared.approval.approvalId,
      actionId: prepared.action.actionId,
      actionInputHash: prepared.action.inputHash,
    };
  });
  // The whole park is referenced by the first challenge's approval: the wait /
  // resume event pair needs one stable id, and every gated call of one step is
  // answered together.
  const referenceId = challenges[0]!.approvalId;

  await transition({
    transition: "wait",
    reason: "approval",
    referenceId,
  });
  await deliveryActivities.suspendAgentRun({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    workflow: input.input,
  });

  const deadlines = gated
    .map((prepared) => prepared.approval?.expiresAt ?? null)
    .filter((value): value is string => value !== null)
    .map((value) => new Date(value).getTime());
  const expiresInMs =
    deadlines.length === 0 ? null : Math.max(0, Math.min(...deadlines) - Date.now());

  const wakeCondition = () =>
    inbox.hasApprovals(challenges) ||
    inbox.peekInterrupt() !== null ||
    inbox.cancellation() !== null;
  const wokeBeforeExpiry =
    expiresInMs === null
      ? (await condition(wakeCondition), true)
      : await condition(wakeCondition, expiresInMs);

  if (!wokeBeforeExpiry) {
    for (const prepared of gated) {
      await gatewayActivities.denyAction(
        denyRequest(prepared, "Approval expired.", prepared.approval!.approvalId, "expired")
      );
    }
    await resumeAfterApproval({ input: input.input, transition, openRun, referenceId });
    return { result: "resumed", approvals: {} };
  }

  if (inbox.cancellation() !== null) {
    const interruption = await handleInterrupt();
    if (interruption !== "stopped") {
      throw new Error("Cancellation did not stop the approval wait.");
    }
    return { result: "stopped", approvals: null };
  }

  // The server serializes approval decisions and interrupting inputs under the
  // thread lock. If an approval signal exists, the approval transaction won
  // that race and must be honored before a later steer is consumed.
  const answered = inbox.takeApprovals(challenges);
  if (answered) {
    // The decisions THIS park is holding, not whatever else the carrying signal
    // mentioned. Normally identical — one continuation answers one step's gated
    // calls — but committing the signal verbatim would make the durable
    // decisions and the `approvals` map below able to disagree, and then an
    // action recorded as still pending would be executed as approved.
    await gatewayActivities.resolveApproval({
      ...answered.signal,
      decisions: answered.decisions,
    });
    // THE RESUME, BEFORE ANY EXECUTION. See this function's header.
    await resumeAfterApproval({
      input: input.input,
      transition,
      openRun,
      referenceId,
      resumeDelivery: answered.resumeDelivery,
    });
    const approvals: ApprovalOutcomeByAction = {};
    for (const decision of answered.decisions) {
      approvals[decision.actionId] = decision.decision;
    }
    return { result: "resumed", approvals };
  }

  if (inbox.peekInterrupt() !== null) {
    for (const prepared of gated) {
      await gatewayActivities.denyAction(
        denyRequest(
          prepared,
          "Action superseded by a newer input.",
          prepared.approval!.approvalId,
          "cancelled"
        )
      );
    }
    const interruption = await handleInterrupt();
    if (!interruption) {
      throw new Error("Pending interruption disappeared before it was handled.");
    }
    if (interruption === "continue") {
      await resumeAfterApproval({ input: input.input, transition, openRun, referenceId });
      return { result: "restart", approvals: null };
    }
    return { result: "stopped", approvals: null };
  }

  throw new Error("Approval wake-up did not contain a matching decision.");
}

/**
 * Leave `waiting_for_approval` in Postgres and, when there is a trigger for it,
 * on the channel.
 *
 * Non-cancellable, and for the same reason it always was: the decision has
 * already committed, so a steer arriving mid-teardown must not leave the run
 * parked — the next model step's `complete` transition would 409 against
 * `waiting_for_approval` and fail the turn.
 *
 * `resumeDelivery` is absent on the paths where no creator answer exists (an
 * expiry, a supersede). The channel run then stays suspended until the next
 * model step's own trigger arrives, which is honest: nothing resumed it.
 */
async function resumeAfterApproval(args: {
  input: StudioAgentWorkflowInput;
  transition(request: RunTransitionCommand): Promise<unknown>;
  openRun(trigger: StudioAgentWorkflowInput["delivery"]): Promise<void>;
  referenceId: string;
  resumeDelivery?: NonNullable<StudioAgentWorkflowInput["delivery"]>;
}): Promise<void> {
  await CancellationScope.nonCancellable(async () => {
    await args.transition({
      transition: "resume",
      resumedFrom: "approval",
      referenceId: args.referenceId,
    });
    if (args.resumeDelivery) {
      await args.openRun(args.resumeDelivery);
    }
  });
}

/**
 * Run one prepared action, now that its verdict is settled.
 *
 * This no longer waits for anything. An `ask` action reaches here only after
 * {@link parkForApproval} committed the creator's decision and resumed the run,
 * so the only question left is whether the answer was yes. A `denied` answer
 * has already been written terminal by the control plane — there is nothing to
 * execute and nothing to report.
 */
async function processPreparedAction(input: {
  input: StudioAgentWorkflowInput;
  prepared: StudioAgentPreparedAction;
  approvals: ApprovalOutcomeByAction | null;
  runInterruptibly<T>(operation: () => Promise<T>): Promise<T>;
}): Promise<"done" | "restart" | "stopped"> {
  if (input.input.runId !== input.prepared.action.runId) {
    throw new Error("Prepared action belongs to a different workflow run.");
  }
  const { prepared, approvals, runInterruptibly } = input;
  if (prepared.permissionDecision === "deny") {
    return "done";
  }
  if (prepared.permissionDecision === "allow") {
    await runInterruptibly(() => executePreparedAction(prepared));
    return "done";
  }
  if (approvals?.[prepared.action.actionId] === "approved") {
    await runInterruptibly(() => executePreparedAction(prepared));
  }
  return "done";
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
          // A delegated run has no triggering input event, so it has no
          // identity on the conversation channel. Its output is durable-only.
          delivery: null,
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
