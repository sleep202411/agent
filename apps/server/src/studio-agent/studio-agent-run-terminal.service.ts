import { ConflictException, Injectable } from '@nestjs/common';
import {
  Prisma,
  type StudioAgentRun as StudioAgentRunRow,
} from '@prisma/client';
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  StudioAgentActionExecutionSchema,
  StudioAgentContextCompactionModelExecutionPlanSchema,
  StudioAgentEventDraftSchema,
  StudioAgentMessagePartSchema,
  StudioAgentPermissionPolicySchema,
  StudioAgentTaskDescriptorSchema,
  StudioAgentWorkflowInputSchema,
  type StudioAgentActionExecution,
  type StudioAgentError,
  type StudioAgentEvent,
  type StudioAgentEventDraft,
  type StudioAgentMessagePart,
} from '@repo/shared/studio-agent';
import { randomUUID } from 'node:crypto';
import {
  StudioAgentConfigService,
  studioAgentRootBudgetData,
} from './studio-agent.config';
import { StudioAgentEventStore } from './studio-agent.events';
import { toStudioAgentApproval, toStudioAgentRun } from './studio-agent.mapper';
import { StudioAgentQuotaService } from './studio-agent-quota.service';

export type StudioAgentTerminalTransition =
  | {
      status: 'succeeded';
      summary: string | null;
      outputMessageId: string | null;
    }
  | {
      status: 'failed';
      error: StudioAgentError;
      reason: string;
    }
  | {
      status: 'cancelled';
      reason: string;
    };

export interface StudioAgentTerminalPromotion {
  requestedInputId?: string;
}

export interface StudioAgentTerminalResult {
  run: StudioAgentRunRow;
  events: StudioAgentEvent[];
}

type TransactionClient = Prisma.TransactionClient;

const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const ACTIVE_ACTION_STATUSES = [
  'proposed',
  'waiting_for_approval',
  'queued',
  'running',
] as const;

/**
 * Owns the canonical run terminal transaction.
 *
 * Every caller holds the thread lock before entering this service. That makes
 * root detachment and queued-input promotion one serializable domain decision,
 * independent of whether termination originated in Temporal or the outbox.
 */
@Injectable()
export class StudioAgentRunTerminalService {
  constructor(
    private readonly config: StudioAgentConfigService,
    private readonly events: StudioAgentEventStore,
    private readonly quota: StudioAgentQuotaService,
  ) {}

  async terminalizeInTransaction(
    transaction: TransactionClient,
    run: StudioAgentRunRow,
    transition: StudioAgentTerminalTransition,
    now: Date,
    promotion: StudioAgentTerminalPromotion = {},
  ): Promise<StudioAgentTerminalResult> {
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      return { run, events: [] };
    }

    const events = await this.cancelActiveDescendants(
      transaction,
      run,
      now,
      descendantReason(transition),
    );
    await this.cleanupAcceptedInputs(
      transaction,
      run,
      run.parentRunId === null,
      promotion.requestedInputId,
    );

    let updated: StudioAgentRunRow;
    if (transition.status === 'cancelled') {
      const cancellation = await this.terminalizeCancelledRun(
        transaction,
        run,
        now,
        transition.reason,
        false,
      );
      updated = cancellation.run;
      events.push(...cancellation.events);
    } else {
      if (transition.status === 'failed') {
        events.push(
          ...(await this.cleanupRunResources(
            transaction,
            run,
            now,
            'failed',
            transition.error,
            transition.reason,
          )),
        );
      }
      updated = await transaction.studioAgentRun.update({
        where: { id: run.id },
        data:
          transition.status === 'succeeded'
            ? { status: 'succeeded', completedAt: now }
            : {
                status: 'failed',
                startedAt: run.startedAt ?? now,
                completedAt: now,
                error: transition.error as Prisma.InputJsonValue,
              },
      });
      events.push(
        ...(await this.appendRunTerminalEvents(
          transaction,
          run,
          transition,
          now,
        )),
      );
    }

    if (run.parentRunId === null) {
      await this.quota.markRootTerminalInTransaction(
        transaction,
        run.id,
        transition.status,
        now,
      );
      await transaction.studioAgentThread.updateMany({
        where: { id: run.threadId, activeRunId: run.id },
        data: { activeRunId: null },
      });
      events.push(
        ...(await this.promoteNextInput(
          transaction,
          run,
          now,
          promotion.requestedInputId,
        )),
      );
    }

    return { run: updated, events };
  }

  private async appendRunTerminalEvents(
    transaction: TransactionClient,
    run: StudioAgentRunRow,
    transition: Exclude<StudioAgentTerminalTransition, { status: 'cancelled' }>,
    now: Date,
  ): Promise<StudioAgentEvent[]> {
    const events: StudioAgentEvent[] = [];
    if (transition.status === 'succeeded') {
      events.push(
        await this.events.appendInTransaction(
          transaction,
          eventForRun(
            run,
            'run.completed',
            {
              outputMessageId: transition.outputMessageId,
              summary: transition.summary,
              completedAt: now.toISOString(),
            },
            `run:${run.id}:completed`,
            now,
          ),
        ),
      );
      if (run.kind === 'task') {
        events.push(
          await this.events.appendInTransaction(
            transaction,
            eventForRun(
              run,
              'task.completed',
              {
                task: requireTask(run),
                summary: transition.summary,
                completedAt: now.toISOString(),
              },
              `run:${run.id}:task-completed`,
              now,
            ),
          ),
          ...(await this.completeChildAction(
            transaction,
            run,
            'succeeded',
            now,
            transition.summary,
            null,
          )),
        );
      }
      return events;
    }

    events.push(
      await this.events.appendInTransaction(
        transaction,
        eventForRun(
          run,
          'run.failed',
          { error: transition.error, failedAt: now.toISOString() },
          `run:${run.id}:failed`,
          now,
        ),
      ),
    );
    if (run.kind === 'task') {
      events.push(
        await this.events.appendInTransaction(
          transaction,
          eventForRun(
            run,
            'task.failed',
            {
              task: requireTask(run),
              error: transition.error,
              failedAt: now.toISOString(),
            },
            `run:${run.id}:task-failed`,
            now,
          ),
        ),
        ...(await this.completeChildAction(
          transaction,
          run,
          'failed',
          now,
          null,
          transition.error,
        )),
      );
    }
    return events;
  }

  private async cancelActiveDescendants(
    transaction: TransactionClient,
    ancestor: StudioAgentRunRow,
    now: Date,
    reason: string,
  ): Promise<StudioAgentEvent[]> {
    const rootedRuns = await transaction.studioAgentRun.findMany({
      where: { rootRunId: ancestor.rootRunId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const byId = new Map(rootedRuns.map((run) => [run.id, run]));
    const descendants = rootedRuns
      .map((run) => ({
        run,
        depth: descendantDepth(run, ancestor.id, byId),
      }))
      .filter(
        (
          candidate,
        ): candidate is {
          run: (typeof rootedRuns)[number];
          depth: number;
        } =>
          candidate.depth !== null &&
          candidate.depth > 0 &&
          isActiveRunStatus(candidate.run.status),
      )
      .sort(
        (left, right) =>
          right.depth - left.depth ||
          right.run.createdAt.getTime() - left.run.createdAt.getTime() ||
          right.run.id.localeCompare(left.run.id),
      );

    const events: StudioAgentEvent[] = [];
    for (const descendant of descendants) {
      const cancellation = await this.terminalizeCancelledRun(
        transaction,
        descendant.run,
        now,
        reason,
      );
      events.push(...cancellation.events);
    }
    return events;
  }

  private async terminalizeCancelledRun(
    transaction: TransactionClient,
    run: StudioAgentRunRow,
    now: Date,
    reason: string,
    cleanupInputs = true,
  ): Promise<{ run: StudioAgentRunRow; events: StudioAgentEvent[] }> {
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      return { run, events: [] };
    }
    if (cleanupInputs) {
      await this.cleanupAcceptedInputs(transaction, run, false);
    }
    const events = await this.cleanupRunResources(
      transaction,
      run,
      now,
      'cancelled',
      null,
      reason,
    );
    const updated = await transaction.studioAgentRun.update({
      where: { id: run.id },
      data: {
        status: 'cancelled',
        startedAt: run.startedAt ?? now,
        completedAt: now,
        error: Prisma.DbNull,
      },
    });
    events.push(
      await this.events.appendInTransaction(
        transaction,
        eventForRun(
          run,
          'run.cancelled',
          { reason, cancelledAt: now.toISOString() },
          `run:${run.id}:cancelled`,
          now,
        ),
      ),
    );
    if (run.kind === 'task') {
      events.push(
        await this.events.appendInTransaction(
          transaction,
          eventForRun(
            run,
            'task.cancelled',
            {
              task: requireTask(run),
              reason,
              cancelledAt: now.toISOString(),
            },
            `run:${run.id}:task-cancelled`,
            now,
          ),
        ),
        ...(await this.completeChildAction(
          transaction,
          run,
          'cancelled',
          now,
          null,
          null,
        )),
      );
    }
    return { run: updated, events };
  }

  private async cleanupAcceptedInputs(
    transaction: TransactionClient,
    run: StudioAgentRunRow,
    preserveEnqueue: boolean,
    requestedInputId?: string,
  ): Promise<void> {
    await transaction.studioAgentInput.updateMany({
      where: {
        targetRunId: run.id,
        status: 'accepted',
        ...(preserveEnqueue
          ? {
              delivery: { not: 'enqueue' },
              ...(requestedInputId ? { id: { not: requestedInputId } } : {}),
            }
          : {}),
      },
      data: { status: 'cancelled' },
    });
  }

  private async cleanupRunResources(
    transaction: TransactionClient,
    run: StudioAgentRunRow,
    now: Date,
    attemptStatus: 'failed' | 'cancelled',
    error: StudioAgentError | null,
    reason: string,
  ): Promise<StudioAgentEvent[]> {
    const events: StudioAgentEvent[] = [];
    const attempts = await transaction.studioAgentModelAttempt.findMany({
      where: { runId: run.id, status: 'running' },
      include: { assistantMessage: true },
      orderBy: [{ ordinal: 'asc' }, { id: 'asc' }],
    });
    for (const attempt of attempts) {
      if (attempt.purpose === 'context_compaction') {
        const plan = StudioAgentContextCompactionModelExecutionPlanSchema.parse(
          attempt.contextPlan,
        );
        await transaction.studioAgentModelAttempt.update({
          where: { id: attempt.id },
          data: {
            status: attemptStatus,
            completedAt: now,
            finishReason: attemptStatus,
            error:
              attemptStatus === 'failed'
                ? (error as Prisma.InputJsonValue)
                : Prisma.DbNull,
          },
        });
        const activityStarted = await transaction.studioAgentEvent.findFirst({
          where: {
            threadId: run.threadId,
            idempotencyKey: `model:${attempt.stepId}:activity:started`,
          },
          select: { eventId: true },
        });
        if (activityStarted) {
          events.push(
            await this.events.appendInTransaction(
              transaction,
              eventForRun(
                run,
                attemptStatus === 'cancelled'
                  ? 'activity.cancelled'
                  : 'activity.failed',
                attemptStatus === 'cancelled'
                  ? {
                      activityId: plan.compaction.activityId,
                      cancelledAt: now.toISOString(),
                    }
                  : {
                      activityId: plan.compaction.activityId,
                      error: error!,
                      failedAt: now.toISOString(),
                    },
                `model:${attempt.stepId}:activity:terminal`,
                now,
              ),
            ),
          );
        }
        continue;
      }
      if (
        attempt.assistantMessage === null ||
        attempt.assistantMessageId === null ||
        attempt.segmentId === null
      ) {
        throw dataIntegrity(
          `Response attempt ${attempt.id} has no assistant segment.`,
        );
      }
      const parts = parseMessageParts(attempt.assistantMessage.parts);
      const content =
        parts.find(
          (part): part is Extract<StudioAgentMessagePart, { type: 'text' }> =>
            part.type === 'text',
        )?.text ?? '';
      await transaction.studioAgentMessage.update({
        where: { id: attempt.assistantMessageId },
        data: { status: attemptStatus, completedAt: now },
      });
      await transaction.studioAgentModelAttempt.update({
        where: { id: attempt.id },
        data: {
          status: attemptStatus,
          completedAt: now,
          finishReason: attemptStatus,
          error:
            attemptStatus === 'failed'
              ? (error as Prisma.InputJsonValue)
              : Prisma.DbNull,
        },
      });
      events.push(
        await this.events.appendInTransaction(
          transaction,
          eventForRun(
            run,
            'assistant.segment.completed',
            {
              messageId: attempt.assistantMessageId,
              segmentId: attempt.segmentId,
              content,
              finishReason:
                attemptStatus === 'cancelled' ? 'cancelled' : 'error',
              providerResponseId: attempt.providerResponseId,
              usage: {
                inputTokens: attempt.inputTokens ?? 0,
                outputTokens: attempt.outputTokens ?? 0,
                cachedInputTokens: attempt.cachedInputTokens,
                reasoningTokens: attempt.reasoningTokens,
              },
              completedAt: now.toISOString(),
            },
            `model:${attempt.stepId}:segment:${attempt.segmentId}:terminal`,
            now,
          ),
        ),
      );
      const activityStarted = await transaction.studioAgentEvent.findFirst({
        where: {
          threadId: run.threadId,
          idempotencyKey: `model:${attempt.stepId}:activity:started`,
        },
        select: { eventId: true },
      });
      if (activityStarted) {
        events.push(
          await this.events.appendInTransaction(
            transaction,
            eventForRun(
              run,
              attemptStatus === 'cancelled'
                ? 'activity.cancelled'
                : 'activity.failed',
              attemptStatus === 'cancelled'
                ? {
                    activityId: attempt.stepId,
                    cancelledAt: now.toISOString(),
                  }
                : {
                    activityId: attempt.stepId,
                    error: error!,
                    failedAt: now.toISOString(),
                  },
              `model:${attempt.stepId}:activity:terminal`,
              now,
            ),
          ),
        );
      }
    }
    await transaction.studioAgentMessage.updateMany({
      where: {
        runId: run.id,
        role: 'assistant',
        status: { in: ['accepted', 'streaming'] },
      },
      data: { status: attemptStatus, completedAt: now },
    });

    const approvals = await transaction.studioAgentApproval.findMany({
      where: { runId: run.id, status: 'pending' },
      orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
    });
    for (const approval of approvals) {
      const updated = await transaction.studioAgentApproval.update({
        where: { id: approval.id },
        data: { status: 'cancelled', decision: Prisma.DbNull },
      });
      events.push(
        await this.events.appendInTransaction(
          transaction,
          eventForRun(
            run,
            'approval.resolved',
            { approval: toStudioAgentApproval(updated) },
            `approval:${approval.id}:resolved`,
            now,
          ),
        ),
      );
    }

    const actions = await transaction.studioAgentAction.findMany({
      where: {
        runId: run.id,
        status: { in: [...ACTIVE_ACTION_STATUSES] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const action of actions) {
      await transaction.studioAgentAction.update({
        where: { id: action.id },
        data: {
          status: 'cancelled',
          startedAt: action.startedAt ?? now,
          completedAt: now,
          output: Prisma.DbNull,
          changeSet: Prisma.DbNull,
          error: Prisma.DbNull,
        },
      });
      events.push(
        await this.events.appendInTransaction(
          transaction,
          eventForRun(
            run,
            'action.completed',
            {
              execution: cancelledExecution(
                action.id,
                now,
                action.startedAt ?? now,
              ),
            },
            `action:${action.id}:terminal`,
            now,
          ),
        ),
      );
    }

    await transaction.studioAgentCommandOutbox.updateMany({
      where: { runId: run.id, status: 'pending' },
      data: {
        status: 'dead_letter',
        deadLetteredAt: now,
        leaseToken: null,
        leaseOwner: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
        lastErrorCode:
          attemptStatus === 'cancelled'
            ? 'STUDIO_AGENT_RUN_CANCELLED'
            : 'STUDIO_AGENT_RUN_FAILED',
        lastErrorDetail: reason,
      },
    });
    return events;
  }

  private async completeChildAction(
    transaction: TransactionClient,
    run: StudioAgentRunRow,
    status: 'succeeded' | 'failed' | 'cancelled',
    now: Date,
    summary: string | null,
    error: StudioAgentError | null,
  ): Promise<StudioAgentEvent[]> {
    const action = await requireParentAction(transaction, run);
    if (isTerminalAction(action.status)) return [];
    const output =
      status === 'succeeded' ? { runId: run.id, status, summary } : null;
    await transaction.studioAgentAction.update({
      where: { id: action.id },
      data: {
        status,
        startedAt: action.startedAt ?? now,
        completedAt: now,
        output:
          output === null ? Prisma.DbNull : (output as Prisma.InputJsonValue),
        error:
          error === null ? Prisma.DbNull : (error as Prisma.InputJsonValue),
      },
    });
    const execution = StudioAgentActionExecutionSchema.parse({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      executionId: run.id,
      actionId: action.id,
      status,
      output,
      error,
      changeSet: null,
      startedAt: (action.startedAt ?? now).toISOString(),
      completedAt: now.toISOString(),
    });
    return [
      await this.events.appendInTransaction(
        transaction,
        eventForRun(
          action.run,
          'action.completed',
          { execution },
          `action:${action.id}:terminal`,
          now,
        ),
      ),
    ];
  }

  private async promoteNextInput(
    transaction: TransactionClient,
    previousRoot: StudioAgentRunRow,
    promotedAt: Date,
    requestedInputId?: string,
  ): Promise<StudioAgentEvent[]> {
    const thread = await transaction.studioAgentThread.findUniqueOrThrow({
      where: { id: previousRoot.threadId },
    });
    if (thread.activeRunId !== null) return [];

    const input = requestedInputId
      ? await transaction.studioAgentInput.findFirst({
          where: {
            id: requestedInputId,
            threadId: previousRoot.threadId,
            targetRunId: previousRoot.id,
            status: 'accepted',
            delivery: 'stop_and_send',
          },
          include: { targetRun: true },
        })
      : await transaction.studioAgentInput.findFirst({
          where: {
            targetRunId: previousRoot.id,
            status: 'accepted',
            delivery: 'enqueue',
          },
          include: { targetRun: true },
          orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
        });
    if (!input) {
      if (requestedInputId) {
        throw dataIntegrity(
          'The stop-and-send input requesting cancellation is not promotable.',
        );
      }
      return [];
    }

    const policy = StudioAgentPermissionPolicySchema.parse(
      thread.permissionPolicy,
    );
    const runId = randomUUID();
    const run = await transaction.studioAgentRun.create({
      data: {
        id: runId,
        threadId: input.threadId,
        rootRunId: runId,
        depth: 0,
        kind: 'turn',
        trigger: 'resume',
        triggerMessageId: input.messageId,
        scenarioId: input.targetRun.scenarioId,
        scenarioVersion: input.targetRun.scenarioVersion,
        executionScopeContainer:
          input.submissionScopeContainer as Prisma.InputJsonValue,
        executionScopeFocus:
          input.submissionScopeFocus === null
            ? Prisma.DbNull
            : (input.submissionScopeFocus as Prisma.InputJsonValue),
        locale: input.submissionLocale,
        permissionPolicy: policy as unknown as Prisma.InputJsonValue,
        workflowId: runId,
      },
    });
    await transaction.studioAgentRunBudget.create({
      data: {
        rootRunId: run.id,
        threadId: run.threadId,
        ...studioAgentRootBudgetData(this.config.value, promotedAt),
      },
    });
    await transaction.studioAgentThread.update({
      where: { id: input.threadId },
      data: { activeRunId: run.id },
    });
    await transaction.studioAgentInput.update({
      where: { id: input.id },
      data: {
        status: 'promoted',
        promotedToRunId: run.id,
        consumedAt: promotedAt,
      },
    });
    await transaction.studioAgentCommandOutbox.create({
      data: {
        threadId: run.threadId,
        runId: run.id,
        type: 'start',
        payload: workflowForRun(run) as unknown as Prisma.InputJsonValue,
        idempotencyKey: `run:${run.id}:start`,
        nextAttemptAt: promotedAt,
      },
    });
    await transaction.studioAgentInput.updateMany({
      where: {
        targetRunId: previousRoot.id,
        status: 'accepted',
        delivery: 'enqueue',
        id: { not: input.id },
      },
      data: { targetRunId: run.id },
    });

    return [
      await this.events.appendInTransaction(
        transaction,
        eventForRun(
          previousRoot,
          'input.promoted',
          {
            inputId: input.id,
            promotedToRunId: run.id,
            promotedAt: promotedAt.toISOString(),
          },
          `input:${input.id}:promoted`,
          promotedAt,
        ),
      ),
      await this.events.appendInTransaction(
        transaction,
        eventForRun(
          run,
          'run.created',
          { run: toStudioAgentRun(run) },
          `run:${run.id}:created`,
          promotedAt,
        ),
      ),
    ];
  }
}

function descendantReason(transition: StudioAgentTerminalTransition): string {
  switch (transition.status) {
    case 'succeeded':
      return 'Cancelled because the ancestor run completed.';
    case 'failed':
      return 'Cancelled because an ancestor run failed.';
    case 'cancelled':
      return transition.reason;
  }
}

function cancelledExecution(
  actionId: string,
  completedAt: Date,
  startedAt: Date,
): StudioAgentActionExecution {
  return StudioAgentActionExecutionSchema.parse({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    executionId: randomUUID(),
    actionId,
    status: 'cancelled',
    output: null,
    error: null,
    changeSet: null,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
  });
}

function isTerminalAction(status: string): boolean {
  return ['succeeded', 'failed', 'denied', 'cancelled'].includes(status);
}

function isActiveRunStatus(status: string): boolean {
  return [
    'queued',
    'running',
    'waiting_for_approval',
    'waiting_for_input',
    'cancelling',
  ].includes(status);
}

function descendantDepth<
  TRun extends { id: string; parentRunId: string | null },
>(
  candidate: TRun,
  ancestorId: string,
  byId: ReadonlyMap<string, TRun>,
): number | null {
  let current: TRun | undefined = candidate;
  let depth = 0;
  const visited = new Set<string>();
  while (current.parentRunId !== null) {
    if (visited.has(current.id)) {
      throw dataIntegrity('Studio Agent run hierarchy contains a cycle.');
    }
    visited.add(current.id);
    depth += 1;
    if (current.parentRunId === ancestorId) return depth;
    current = byId.get(current.parentRunId);
    if (!current) return null;
  }
  return null;
}

function parseMessageParts(raw: unknown): StudioAgentMessagePart[] {
  if (!Array.isArray(raw)) {
    throw dataIntegrity('Canonical message parts must be an array.');
  }
  return raw.map((part) => StudioAgentMessagePartSchema.parse(part));
}

function requireTask(run: StudioAgentRunRow) {
  return StudioAgentTaskDescriptorSchema.parse(run.task);
}

async function requireParentAction(
  transaction: TransactionClient,
  run: StudioAgentRunRow,
) {
  if (!run.parentRunId || !run.sourceStepId || !run.sourceToolCallId) {
    throw dataIntegrity(`Task run ${run.id} has no parent tool lineage.`);
  }
  const action = await transaction.studioAgentAction.findFirst({
    where: {
      runId: run.parentRunId,
      stepId: run.sourceStepId,
      toolCallId: run.sourceToolCallId,
    },
    include: { run: true },
  });
  if (!action) {
    throw dataIntegrity(`Task run ${run.id} has no parent action.`);
  }
  return action;
}

function workflowForRun(run: StudioAgentRunRow) {
  const policy = StudioAgentPermissionPolicySchema.parse(run.permissionPolicy);
  return StudioAgentWorkflowInputSchema.parse({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: run.threadId,
    runId: run.id,
    rootRunId: run.rootRunId,
    parentRunId: run.parentRunId,
    kind: run.kind,
    scenario: { id: run.scenarioId, version: run.scenarioVersion },
    permissionPolicy: {
      policyId: policy.policyId,
      revision: policy.revision,
    },
  });
}

function eventForRun<
  TType extends StudioAgentEventDraft['type'],
  TDraft extends Extract<StudioAgentEventDraft, { type: TType }>,
>(
  run: StudioAgentRunRow,
  type: TType,
  payload: TDraft['payload'],
  idempotencyKey: string,
  occurredAt: Date,
): TDraft {
  return StudioAgentEventDraftSchema.parse({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: run.threadId,
    runId: run.id,
    rootRunId: run.rootRunId,
    parentRunId: run.parentRunId,
    type,
    payload,
    occurredAt: occurredAt.toISOString(),
    idempotencyKey,
  }) as TDraft;
}

function dataIntegrity(message: string): ConflictException {
  return new ConflictException({
    code: 'STUDIO_AGENT_DATA_INTEGRITY_ERROR',
    message,
  });
}
