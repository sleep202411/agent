import {
  ActivityCancellationType,
  ApplicationFailure,
  CancellationScope,
  ParentClosePolicy,
  allHandlersFinished,
  condition,
  continueAsNew,
  defineSignal,
  defineUpdate,
  getExternalWorkflowHandle,
  isCancellation,
  log,
  proxyActivities,
  setHandler,
  sleep,
  startChild,
  uuid4,
  workflowInfo,
  type ChildWorkflowHandle,
} from "@temporalio/workflow";

import type * as activities from "./activities.js";
import { attemptAdmissionDecision, attemptIdentity } from "./attempt-sequence.js";
import {
  CANCEL_AGENT_INVOCATION_UPDATE,
  ENQUEUE_AGENT_INVOCATION_UPDATE,
  AGGREGATE_ATTEMPT_CURSOR_LIMIT,
  LIFECYCLE_REPAIR_CYCLES_PER_RUN,
  OPEN_RUN_MAX_ATTEMPTS,
  RECENT_ATTEMPT_ID_LIMIT,
  agentInvocationLifecycleProjectionSchema,
  agentCancellationCommandSchema,
  agentInvocationCommandSchema,
  agentSessionWorkflowInputSchema,
  lifecycleProjectionWorkflowInputSchema,
  type AgentCancellationCommand,
  type AgentCancellationResult,
  type AgentInvocationAdmission,
  type AgentInvocationCommand,
  type AgentInvocationLifecycleProjection,
  type AgentInvocationLifecycleStatus,
  type AgentPublicError,
  type AgentSessionWorkflowInput,
  type AggregateAttemptCursor,
  type DurableAttemptIdentity,
  type DurableRunIds,
  type LifecycleProjectionWorkflowInput,
} from "./contracts.js";
import { createAgentPublicError } from "./public-error.js";
import { agentTaskQueues } from "./task-queues.js";

export { agentLongDocumentAnalysisWorkflow } from "./long-document-workflows.js";

const MAX_PENDING_INVOCATIONS = 512;
const MAX_INVOCATIONS_PER_WORKFLOW_RUN = 256;
const LIFECYCLE_PROJECTION_MAX_LIFETIME = "7 days";

export const enqueueAgentInvocationUpdate = defineUpdate<
  AgentInvocationAdmission,
  [AgentInvocationCommand]
>(ENQUEUE_AGENT_INVOCATION_UPDATE);
export const cancelAgentInvocationUpdate = defineUpdate<
  AgentCancellationResult,
  [AgentCancellationCommand]
>(CANCEL_AGENT_INVOCATION_UPDATE);
export const PROJECT_AGENT_INVOCATION_LIFECYCLE_SIGNAL =
  "projectFizzDragonAgentInvocationLifecycle";
export const projectAgentInvocationLifecycleSignal = defineSignal<
  [AgentInvocationLifecycleProjection]
>(PROJECT_AGENT_INVOCATION_LIFECYCLE_SIGNAL);

function invocationActivityClients() {
  const queues = agentTaskQueues(workflowInfo().taskQueue);
  return {
    open: proxyActivities<Pick<typeof activities, "openRunActivity">>({
      taskQueue: queues.control,
      startToCloseTimeout: "90 seconds",
      scheduleToCloseTimeout: "8 minutes",
      heartbeatTimeout: "3 seconds",
      cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
      retry: {
        initialInterval: "500 milliseconds",
        backoffCoefficient: 2,
        maximumInterval: "15 seconds",
        maximumAttempts: OPEN_RUN_MAX_ATTEMPTS,
      },
    }),
    inference: proxyActivities<Pick<typeof activities, "runInferenceActivity">>({
      taskQueue: queues.inference,
      startToCloseTimeout: "20 minutes",
      scheduleToCloseTimeout: "45 minutes",
      heartbeatTimeout: "3 seconds",
      cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
      retry: {
        initialInterval: "1 second",
        backoffCoefficient: 2,
        maximumInterval: "20 seconds",
        maximumAttempts: 3,
      },
    }),
    tool: proxyActivities<Pick<typeof activities, "executeToolActivity">>({
      taskQueue: queues.tool,
      startToCloseTimeout: "2 minutes",
      scheduleToCloseTimeout: "10 minutes",
      heartbeatTimeout: "3 seconds",
      cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
      retry: {
        initialInterval: "500 milliseconds",
        backoffCoefficient: 2,
        maximumInterval: "10 seconds",
        maximumAttempts: 5,
      },
    }),
    cleanup: proxyActivities<Pick<typeof activities, "endRunActivity">>({
      taskQueue: queues.cleanup,
      startToCloseTimeout: "90 seconds",
      scheduleToCloseTimeout: "15 minutes",
      heartbeatTimeout: "3 seconds",
      cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
      retry: {
        initialInterval: "500 milliseconds",
        backoffCoefficient: 2,
        maximumInterval: "20 seconds",
        maximumAttempts: 20,
      },
    }),
  };
}

function lifecycleActivityClient() {
  const queues = agentTaskQueues(workflowInfo().taskQueue);
  return proxyActivities<Pick<typeof activities, "reportInvocationLifecycleActivity">>({
    taskQueue: queues.lifecycle,
    startToCloseTimeout: "30 seconds",
    scheduleToCloseTimeout: "3 minutes",
    heartbeatTimeout: "3 seconds",
    cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
    retry: {
      initialInterval: "500 milliseconds",
      backoffCoefficient: 2,
      maximumInterval: "20 seconds",
      maximumAttempts: 5,
    },
  });
}

/**
 * One durable entity Workflow owns one signed agent session. Updates are
 * synchronously admitted and the main loop is the only invocation consumer, so
 * no two model/tool chains can adopt the same Ably conversation concurrently.
 */
export async function fizzDragonAgentSessionWorkflow(
  rawInput: AgentSessionWorkflowInput
): Promise<void> {
  const input = agentSessionWorkflowInputSchema.parse(rawInput);
  const queue: AgentInvocationCommand[] = [...input.pendingInvocations];
  const queuedAttemptIds = new Set(queue.map((command) => command.attemptId));
  const cancelledInvocationIds = new Set(input.cancelledPendingInvocationIds);
  const recentAttempts = [...input.recentAttempts];
  const recentAttemptIds = new Set(recentAttempts.map((attempt) => attempt.attemptId));
  const acceptedAttempts = new Map<string, DurableAttemptIdentity>([
    ...recentAttempts.map((attempt) => [attempt.attemptId, attempt] as const),
    ...queue.map((command) => [command.attemptId, attemptIdentity(command)] as const),
  ]);
  const aggregateAttemptOrder = input.aggregateAttempts.map((cursor) => cursor.invocationId);
  const aggregateAttempts = new Map<string, AggregateAttemptCursor>(
    input.aggregateAttempts.map((cursor) => [cursor.invocationId, cursor])
  );
  let activeInvocationId: string | undefined;
  let activeCancellationScope: CancellationScope | undefined;
  let processedInvocations = 0;

  setHandler(
    enqueueAgentInvocationUpdate,
    (rawCommand) => {
      const command = agentInvocationCommandSchema.parse(rawCommand) as AgentInvocationCommand;
      const acceptedAttempt = acceptedAttempts.get(command.attemptId);
      const aggregate = aggregateAttempts.get(command.invocationId);
      const decision = attemptAdmissionDecision({
        command,
        acceptedAttempt,
        aggregate,
      });
      if (decision !== "accepted") {
        return invocationAdmission(command, decision);
      }
      if (queue.length >= MAX_PENDING_INVOCATIONS) {
        return invocationAdmission(command, "queue-full");
      }

      if (!aggregate && !ensureAggregateCursorCapacity()) {
        return invocationAdmission(command, "queue-full");
      }

      acceptedAttempts.set(command.attemptId, attemptIdentity(command));
      queuedAttemptIds.add(command.attemptId);
      queue.push(command);
      aggregateAttempts.set(command.invocationId, {
        ...attemptIdentity(command),
        phase: "admitted",
      });
      if (!aggregate) aggregateAttemptOrder.push(command.invocationId);
      return invocationAdmission(command, "accepted");
    },
    {
      validator: (rawCommand) => {
        const command = agentInvocationCommandSchema.parse(rawCommand);
        if (
          command.invocation.sessionName !== input.sessionName ||
          command.context.sessionName !== input.sessionName
        ) {
          throw new Error("Invocation command does not belong to this session Workflow.");
        }
      },
    }
  );
  setHandler(
    cancelAgentInvocationUpdate,
    (rawCommand) => {
      const command = agentCancellationCommandSchema.parse(rawCommand);
      if (command.invocationId === activeInvocationId) {
        cancelledInvocationIds.add(command.invocationId);
        activeCancellationScope?.cancel();
        return cancellationResult(command.invocationId, "cancellation-requested");
      }
      if (queue.some((pending) => pending.invocationId === command.invocationId)) {
        cancelledInvocationIds.add(command.invocationId);
        return cancellationResult(command.invocationId, "cancellation-requested");
      }
      if (aggregateAttempts.get(command.invocationId)?.phase === "terminal") {
        return cancellationResult(command.invocationId, "already-terminal");
      }
      return cancellationResult(command.invocationId, "not-active");
    },
    {
      validator: (rawCommand) => {
        const command = agentCancellationCommandSchema.parse(rawCommand);
        if (command.sessionName !== input.sessionName) {
          throw new Error("Cancellation command does not belong to this session Workflow.");
        }
      },
    }
  );

  while (true) {
    // Rejected Updates grow history without ever queueing work, so an idle
    // session must wake for Temporal's continue-as-new suggestion too.
    // Temporal terminates a run that reaches the hard history limit, and that
    // silently destroys the attempt-dedupe and approval cursors this Workflow
    // owns.
    await condition(() => queue.length > 0 || shouldContinueAsNew());

    const command = queue.shift();
    if (!command) {
      await continueAsNewIfRequired();
      continue;
    }
    queuedAttemptIds.delete(command.attemptId);
    activeInvocationId = command.invocationId;
    const cancellationScope = new CancellationScope();
    activeCancellationScope = cancellationScope;
    let aggregatePhase: AggregateAttemptCursor["phase"] = "terminal";

    try {
      if (cancelledInvocationIds.has(command.invocationId)) {
        await CancellationScope.nonCancellable(() =>
          projectInitialLifecycle(command, lifecycleProjection(command, "cancelled", null))
        );
        log.info("Cancelled queued Agent invocation before execution", {
          invocationId: command.invocationId,
        });
      } else {
        const outcome = await cancellationScope.run(() => executeInvocation(command));
        aggregatePhase = outcome === "waiting_for_approval" ? "waiting_for_approval" : "terminal";
      }
    } catch (error) {
      if (isCancellation(error)) {
        if (!cancelledInvocationIds.has(command.invocationId)) throw error;
        log.info("Cancelled active Agent invocation", {
          invocationId: command.invocationId,
        });
      } else {
        const publicError = terminalErrorFor(error);
        log.error("Agent invocation failed without terminating its session", {
          invocationId: command.invocationId,
          code: publicError.code,
          diagnosticId: publicError.diagnosticId,
        });
      }
    } finally {
      activeCancellationScope = undefined;
      activeInvocationId = undefined;
      cancelledInvocationIds.delete(command.invocationId);
      aggregateAttempts.set(command.invocationId, {
        ...attemptIdentity(command),
        phase: aggregatePhase,
      });
      rememberAttempt(command);
      processedInvocations += 1;
    }

    await continueAsNewIfRequired();
  }

  function shouldContinueAsNew(): boolean {
    const info = workflowInfo();
    return info.continueAsNewSuggested || info.targetWorkerDeploymentVersionChanged;
  }

  async function continueAsNewIfRequired(): Promise<void> {
    if (processedInvocations < MAX_INVOCATIONS_PER_WORKFLOW_RUN && !shouldContinueAsNew()) return;
    await condition(allHandlersFinished);
    await continueAsNew<typeof fizzDragonAgentSessionWorkflow>({
      schemaVersion: "agent-session-workflow/v2",
      sessionName: input.sessionName,
      pendingInvocations: [...queue],
      cancelledPendingInvocationIds: queue
        .map((command) => command.invocationId)
        .filter((invocationId) => cancelledInvocationIds.has(invocationId)),
      recentAttempts: [...recentAttempts],
      aggregateAttempts: aggregateAttemptOrder.flatMap((invocationId) => {
        const cursor = aggregateAttempts.get(invocationId);
        return cursor ? [cursor] : [];
      }),
    });
  }

  function rememberAttempt(command: AgentInvocationCommand): void {
    if (!recentAttemptIds.has(command.attemptId)) {
      recentAttemptIds.add(command.attemptId);
      recentAttempts.push(attemptIdentity(command));
    }
    while (recentAttempts.length > RECENT_ATTEMPT_ID_LIMIT) {
      const expired = recentAttempts.shift();
      if (expired && !queuedAttemptIds.has(expired.attemptId)) {
        recentAttemptIds.delete(expired.attemptId);
        acceptedAttempts.delete(expired.attemptId);
      }
    }
  }

  function ensureAggregateCursorCapacity(): boolean {
    if (aggregateAttempts.size < AGGREGATE_ATTEMPT_CURSOR_LIMIT) return true;
    const terminalIndex = aggregateAttemptOrder.findIndex(
      (invocationId) => aggregateAttempts.get(invocationId)?.phase === "terminal"
    );
    if (terminalIndex < 0) return false;
    const [expiredInvocationId] = aggregateAttemptOrder.splice(terminalIndex, 1);
    if (expiredInvocationId) aggregateAttempts.delete(expiredInvocationId);
    return true;
  }
}

/**
 * Durable, ordered product-lifecycle projection. The session Workflow only
 * waits for Temporal to record the child start/signal; a slow or unavailable
 * product gateway can therefore never head-of-line block the next invocation.
 *
 * The child keeps the ordered projection queue and retries each transition
 * until acknowledged. Activity attempts and schedule time are bounded, while
 * continue-as-new bounds Workflow history during a prolonged outage.
 */
export async function agentInvocationLifecycleProjectionWorkflow(
  rawInput: LifecycleProjectionWorkflowInput
): Promise<void> {
  const input = lifecycleProjectionWorkflowInputSchema.parse(rawInput);
  const pending = [...input.pendingProjections];
  const invocationId = pending[0]?.invocationId;
  if (!invocationId) {
    throw ApplicationFailure.nonRetryable(
      "Lifecycle projection requires at least one transition.",
      "AGENT_LIFECYCLE_PROJECTION_EMPTY"
    );
  }
  let repairCycle = input.repairCycle;
  const lifecycleActivities = lifecycleActivityClient();

  setHandler(projectAgentInvocationLifecycleSignal, (rawProjection) => {
    const parsed = agentInvocationLifecycleProjectionSchema.safeParse(rawProjection);
    if (!parsed.success || parsed.data.invocationId !== invocationId) {
      log.error("Rejected an invalid lifecycle projection signal", { invocationId });
      return;
    }
    const projection = parsed.data;
    const previous = pending.at(-1);
    if (
      previous?.status === projection.status &&
      previous.runId === projection.runId &&
      previous.error?.diagnosticId === projection.error?.diagnosticId
    ) {
      return;
    }
    pending.push(projection);
  });

  while (true) {
    await condition(() => pending.length > 0);
    const projection = pending[0];
    if (!projection) continue;

    try {
      await lifecycleActivities.reportInvocationLifecycleActivity(projection);
      pending.shift();
      repairCycle = 0;
      if (isTerminalLifecycleStatus(projection.status) && pending.length === 0) {
        return;
      }
    } catch (error) {
      const publicError = terminalErrorFor(error);
      if (!publicError.retryable) {
        // The product refused this transition permanently — an unknown, already
        // terminal, or never-admitted invocation. Repeating a callback that can
        // never be accepted would keep one Workflow alive for the lifetime of
        // the namespace.
        log.error("Abandoned a permanently refused lifecycle projection", {
          invocationId,
          status: projection.status,
          code: publicError.code,
          diagnosticId: publicError.diagnosticId,
        });
        return;
      }
      const nextRepairCycle = repairCycle + 1;
      log.error("Lifecycle projection remains pending for durable repair", {
        invocationId,
        status: projection.status,
        repairCycle: nextRepairCycle,
        code: publicError.code,
        diagnosticId: publicError.diagnosticId,
      });

      if (nextRepairCycle % LIFECYCLE_REPAIR_CYCLES_PER_RUN === 0) {
        await condition(allHandlersFinished);
        await continueAsNew<typeof agentInvocationLifecycleProjectionWorkflow>({
          schemaVersion: "agent-lifecycle-projection-workflow/v1",
          pendingProjections: [...pending],
          repairCycle: nextRepairCycle,
        });
      }
      repairCycle = nextRepairCycle;
      await sleep(lifecycleRepairDelayMs(repairCycle));
    }
  }
}

function invocationAdmission(
  command: Pick<AgentInvocationCommand, "invocationId" | "attemptId" | "attemptOrdinal">,
  status: AgentInvocationAdmission["status"]
): AgentInvocationAdmission {
  return {
    schemaVersion: "agent-invocation-admission/v1",
    invocationId: command.invocationId,
    attemptId: command.attemptId,
    attemptOrdinal: command.attemptOrdinal,
    status,
  };
}

function cancellationResult(
  invocationId: string,
  status: AgentCancellationResult["status"]
): AgentCancellationResult {
  return {
    schemaVersion: "agent-cancellation-result/v1",
    invocationId,
    status,
  };
}

type InvocationExecutionOutcome = "waiting_for_approval" | "terminal";

async function executeInvocation(
  input: AgentInvocationCommand
): Promise<InvocationExecutionOutcome> {
  const activityClients = invocationActivityClients();
  let ids: DurableRunIds | undefined;
  let lifecycleProjectorCreation: Promise<LifecycleProjector> | undefined;

  try {
    const opened = await activityClients.open.openRunActivity({
      invocation: input.invocation,
      // Ably's Invocation and Step identities belong to one input attempt.
      // Approval continuations reuse the product invocation/run aggregate but
      // must never reuse the preceding transport invocation or step.
      invocationId: input.attemptId,
      provisionalRunId: input.provisionalRunId,
    });
    if (opened.kind === "already-terminal") {
      const status =
        opened.status === "complete"
          ? "succeeded"
          : opened.status === "error"
            ? "failed"
            : "cancelled";
      await projectLifecycle(
        status,
        opened.status === "error"
          ? createAgentPublicError({
              fallbackCode: "AGENT_RUN_ALREADY_FAILED",
              diagnosticId: uuid4(),
              retryable: false,
            })
          : null
      );
      return "terminal";
    }

    const durableIds = opened.ids;
    ids = durableIds;
    // The "running" projection costs a projector child start plus two workflow
    // tasks that the first model token does not depend on, so it runs beside
    // the tool/inference chain instead of ahead of it. Ordering is preserved
    // because every later projection serializes behind the projector's
    // creation before signalling. The rejection handler keeps a failed child
    // start from becoming an unhandled Workflow rejection; the next projection
    // recreates the projector, exactly like the pre-overlap failure path in
    // which "running" failed before inference and "failed" recreated it.
    const runningProjected = projectLifecycle("running", null);
    runningProjected.catch((error: unknown) => {
      const publicError = terminalErrorFor(error);
      log.error("Deferred running-lifecycle projection failed", {
        invocationId: input.invocationId,
        code: publicError.code,
        diagnosticId: publicError.diagnosticId,
      });
    });

    for (const call of opened.approvedToolCalls) {
      await activityClients.tool.executeToolActivity({
        ids: durableIds,
        sessionName: input.invocation.sessionName,
        context: input.context,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        arguments: call.input,
      });
    }

    for (let iteration = 0; iteration < input.maxModelSteps; iteration += 1) {
      const outcome = await activityClients.inference.runInferenceActivity({
        ids: durableIds,
        sessionName: input.invocation.sessionName,
        context: input.context,
      });

      if (
        outcome.kind === "complete" ||
        outcome.kind === "cancelled" ||
        outcome.kind === "awaiting-approval"
      ) {
        await projectLifecycle(
          outcome.kind === "complete"
            ? "succeeded"
            : outcome.kind === "awaiting-approval"
              ? "waiting_for_approval"
              : "cancelled",
          null
        );
        return outcome.kind === "awaiting-approval" ? "waiting_for_approval" : "terminal";
      }
      if (outcome.kind === "continue") continue;

      for (const call of outcome.toolCalls) {
        await activityClients.tool.executeToolActivity({
          ids: durableIds,
          sessionName: input.invocation.sessionName,
          context: input.context,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          arguments: call.input,
        });
      }
    }

    throw ApplicationFailure.nonRetryable(
      "The agent exceeded its bounded model/tool iteration budget.",
      "AGENT_ITERATION_LIMIT"
    );
  } catch (error) {
    const cancelled = isCancellation(error);
    const publicError = cancelled ? null : terminalErrorFor(error);
    await CancellationScope.nonCancellable(async () => {
      if (ids) {
        const cleanupIds = ids;
        try {
          if (cancelled) {
            await activityClients.cleanup.endRunActivity({
              ids: cleanupIds,
              sessionName: input.invocation.sessionName,
              reason: "cancelled",
            });
          } else {
            await activityClients.cleanup.endRunActivity({
              ids: cleanupIds,
              sessionName: input.invocation.sessionName,
              reason: "error",
              error: publicError ?? undefined,
            });
          }
        } catch (cleanupError) {
          // The signed lifecycle row is the durable product truth and must
          // terminalize even when Ably itself is the failing dependency. Never
          // replace the causal invocation error with a best-effort transport
          // cleanup error or leave every client polling a permanently-running
          // row.
          const cleanupPublicError = terminalErrorFor(cleanupError);
          log.error("Unable to publish terminal Ably Run state", {
            invocationId: input.invocationId,
            code: cleanupPublicError.code,
            diagnosticId: cleanupPublicError.diagnosticId,
          });
        }
      }
      if (cancelled) {
        await projectLifecycle("cancelled", null);
      } else {
        await projectLifecycle("failed", publicError);
      }
    });
    throw error;
  }

  /**
   * Projection is never cancellable. A Stop cancels the model/tool chain, not
   * the durable product row every client reconnects to — and the projector is a
   * child Workflow, so a cancellable scope would terminate the projector itself
   * and strand the invocation non-terminal.
   *
   * The first projection creates the projector; every later projection awaits
   * that same in-flight creation before signalling. That serialization is what
   * lets the "running" projection run beside the model/tool chain without a
   * concurrent terminal projection ever racing a second `startChild` for the
   * same projector Workflow ID, and it keeps the product row's transitions in
   * emission order. A failed creation clears the memo so the next projection
   * recreates the projector with itself as the first transition — the
   * projector then still terminalizes the aggregate.
   */
  async function projectLifecycle(
    status: AgentInvocationLifecycleStatus,
    error: AgentPublicError | null
  ): Promise<void> {
    const projection = lifecycleProjection(input, status, error);
    await CancellationScope.nonCancellable(async () => {
      const creation = lifecycleProjectorCreation;
      if (!creation) {
        await createLifecycleProjector(projection);
        return;
      }
      let projector: LifecycleProjector;
      try {
        projector = await creation;
      } catch {
        // The creating projection surfaced this failure through its own
        // rejection; this projection restarts the projector so the aggregate
        // still reaches a durable terminal row.
        await createLifecycleProjector(projection);
        return;
      }
      await projector.signal(projection);
    });
  }

  async function createLifecycleProjector(
    firstProjection: AgentInvocationLifecycleProjection
  ): Promise<void> {
    const creation = projectInitialLifecycle(input, firstProjection);
    lifecycleProjectorCreation = creation;
    try {
      await creation;
    } catch (error) {
      if (lifecycleProjectorCreation === creation) lifecycleProjectorCreation = undefined;
      throw error;
    }
  }
}

function lifecycleProjection(
  input: AgentInvocationCommand,
  status: AgentInvocationLifecycleStatus,
  error: AgentPublicError | null
): AgentInvocationLifecycleProjection {
  return agentInvocationLifecycleProjectionSchema.parse({
    schemaVersion: "agent-invocation-lifecycle-projection/v1",
    invocationId: input.invocationId,
    attemptId: input.attemptId,
    attemptOrdinal: input.attemptOrdinal,
    runId: input.provisionalRunId,
    context: input.context,
    status,
    error,
  });
}

type LifecycleProjector = Readonly<{
  signal(projection: AgentInvocationLifecycleProjection): Promise<void>;
}>;

/**
 * Attempt zero creates the aggregate's projector. Approval continuations use
 * a new durable attempt identity but signal that same projector, preserving
 * one monotonic product invocation/run lifecycle.
 */
async function projectInitialLifecycle(
  input: AgentInvocationCommand,
  firstProjection: AgentInvocationLifecycleProjection
): Promise<LifecycleProjector> {
  if (input.attemptOrdinal > 0) {
    const existing = getExternalWorkflowHandle(lifecycleProjectorWorkflowId(input));
    await existing.signal(projectAgentInvocationLifecycleSignal, firstProjection);
    return {
      signal: (projection) => existing.signal(projectAgentInvocationLifecycleSignal, projection),
    };
  }

  const child: ChildWorkflowHandle<typeof agentInvocationLifecycleProjectionWorkflow> =
    await startChild(agentInvocationLifecycleProjectionWorkflow, {
      workflowId: lifecycleProjectorWorkflowId(input),
      taskQueue: agentTaskQueues(workflowInfo().taskQueue).workflow,
      parentClosePolicy: ParentClosePolicy.ABANDON,
      // ABANDON is required because the session Workflow continue-as-news
      // constantly, so nothing else closes a projector that parks on an
      // approval the user never answers. Bound its lifetime instead of leaking
      // one open execution per abandoned approval.
      workflowExecutionTimeout: LIFECYCLE_PROJECTION_MAX_LIFETIME,
      args: [
        {
          schemaVersion: "agent-lifecycle-projection-workflow/v1",
          pendingProjections: [firstProjection],
          repairCycle: 0,
        },
      ],
    });
  return {
    signal: (projection) => child.signal(projectAgentInvocationLifecycleSignal, projection),
  };
}

function lifecycleProjectorWorkflowId(input: Pick<AgentInvocationCommand, "invocationId">): string {
  return `agent-lifecycle-${input.invocationId}`;
}

function terminalErrorFor(error: unknown): AgentPublicError {
  return createAgentPublicError({
    error,
    fallbackCode: "AGENT_RUNTIME_FAILED",
    diagnosticId: uuid4(),
  });
}

function isTerminalLifecycleStatus(status: AgentInvocationLifecycleStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function lifecycleRepairDelayMs(repairCycle: number): number {
  return Math.min(10 * 60_000, 1_000 * 2 ** Math.min(repairCycle - 1, 9));
}
