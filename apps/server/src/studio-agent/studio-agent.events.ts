import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  StudioAgentEventDraftSchema,
  type StudioAgentEvent,
  type StudioAgentEventDraft,
} from '@repo/shared/studio-agent';
import { PrismaService } from '../infra/db/db.module';
import { toStudioAgentEvent } from './studio-agent.mapper';

type TransactionClient = Prisma.TransactionClient;

/**
 * The durable journal, and only that.
 *
 * It used to be half a transport: every append was paired with a `wake()` that
 * nudged a Postgres relay into publishing the row. Delivery is
 * `@ably/ai-transport` now — the worker streams the turn onto the thread's
 * channel from inside its `AgentSession` — so an append here reaches nobody,
 * on purpose. What it still does is allocate the thread-total `sequence` and
 * drive the `studio_agent_activities` projection, both inside the caller's
 * transaction.
 */
@Injectable()
export class StudioAgentEventStore {
  constructor(private readonly prisma: PrismaService) {}

  async append(rawDraft: StudioAgentEventDraft): Promise<StudioAgentEvent> {
    const draft = StudioAgentEventDraftSchema.parse(rawDraft);
    try {
      return await this.prisma.$transaction((transaction) =>
        this.appendInTransaction(transaction, draft),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const existing = await this.prisma.studioAgentEvent.findFirst({
        where: {
          threadId: draft.threadId,
          idempotencyKey: draft.idempotencyKey,
        },
      });
      if (!existing) {
        throw error;
      }
      return toStudioAgentEvent(existing);
    }
  }

  /**
   * Append inside a caller-owned transaction so a domain state transition and
   * the journal entry recording it become visible atomically.
   *
   * The caller has nothing to do afterwards, and nothing it is allowed to do:
   * publishing is the worker's, from inside the run it owns.
   */
  async appendInTransaction(
    transaction: TransactionClient,
    rawDraft: StudioAgentEventDraft,
  ): Promise<StudioAgentEvent> {
    const draft = StudioAgentEventDraftSchema.parse(rawDraft);
    const existing = await transaction.studioAgentEvent.findFirst({
      where: {
        threadId: draft.threadId,
        idempotencyKey: draft.idempotencyKey,
      },
    });
    if (existing) {
      return toStudioAgentEvent(existing);
    }

    const thread = await transaction.studioAgentThread.update({
      where: { id: draft.threadId },
      data: { nextEventSequence: { increment: 1 } },
      select: { nextEventSequence: true },
    });
    const sequence = thread.nextEventSequence - 1n;
    const row = await transaction.studioAgentEvent.create({
      data: {
        threadId: draft.threadId,
        runId: draft.runId,
        rootRunId: draft.rootRunId,
        parentRunId: draft.parentRunId,
        sequence,
        type: draft.type,
        payload: draft.payload as Prisma.InputJsonValue,
        idempotencyKey: draft.idempotencyKey,
        occurredAt: new Date(draft.occurredAt),
      },
    });
    await projectMaterializedEvent(transaction, draft, sequence);
    return toStudioAgentEvent(row);
  }
}

async function projectMaterializedEvent(
  transaction: TransactionClient,
  draft: StudioAgentEventDraft,
  sequence: bigint,
): Promise<void> {
  switch (draft.type) {
    case 'activity.started': {
      if (draft.payload.parentActivityId === draft.payload.activityId) {
        throw activityProjectionConflict(
          draft.payload.activityId,
          'An activity cannot be its own parent.',
        );
      }
      if (draft.payload.parentActivityId !== null) {
        const parent = await transaction.studioAgentActivity.findFirst({
          where: {
            id: draft.payload.parentActivityId,
            threadId: draft.threadId,
          },
          select: { id: true },
        });
        if (!parent) {
          throw activityProjectionConflict(
            draft.payload.activityId,
            'The parent activity does not exist in this thread.',
          );
        }
      }

      const startedAt = new Date(draft.payload.startedAt);
      const activity = await transaction.studioAgentActivity.upsert({
        where: { id: draft.payload.activityId },
        create: {
          id: draft.payload.activityId,
          threadId: draft.threadId,
          runId: draft.runId,
          parentActivityId: draft.payload.parentActivityId,
          kind: draft.payload.kind,
          label: draft.payload.label,
          detail: null,
          progress: null,
          status: 'running',
          startedAt,
          completedAt: null,
          firstEventSequence: sequence,
          lastEventSequence: sequence,
        },
        // Event idempotency is handled before sequence allocation. The start
        // record is immutable: reusing an activity id for a different start
        // event is rejected by the validation immediately below.
        update: {},
      });
      if (
        activity.threadId !== draft.threadId ||
        activity.runId !== draft.runId ||
        activity.parentActivityId !== draft.payload.parentActivityId ||
        activity.kind !== draft.payload.kind ||
        activity.label !== draft.payload.label ||
        activity.startedAt.getTime() !== startedAt.getTime() ||
        activity.firstEventSequence !== sequence ||
        activity.lastEventSequence !== sequence ||
        activity.status !== 'running'
      ) {
        throw activityProjectionConflict(
          draft.payload.activityId,
          'The activity id was already used by a different start event.',
        );
      }
      return;
    }
    case 'activity.progress': {
      await updateRunningActivity(
        transaction,
        draft,
        sequence,
        {
          progress: draft.payload.progress,
          ...(draft.payload.detail === null
            ? {}
            : { detail: draft.payload.detail }),
        },
        'progress',
      );
      return;
    }
    case 'activity.completed': {
      await updateRunningActivity(
        transaction,
        draft,
        sequence,
        {
          status: 'succeeded',
          completedAt: new Date(draft.payload.completedAt),
          ...(draft.payload.summary === null
            ? {}
            : { detail: draft.payload.summary }),
        },
        'completion',
      );
      return;
    }
    case 'activity.failed': {
      await updateRunningActivity(
        transaction,
        draft,
        sequence,
        {
          status: 'failed',
          detail: draft.payload.error.message,
          completedAt: new Date(draft.payload.failedAt),
        },
        'failure',
      );
      return;
    }
    case 'activity.cancelled': {
      await updateRunningActivity(
        transaction,
        draft,
        sequence,
        {
          status: 'cancelled',
          completedAt: new Date(draft.payload.cancelledAt),
        },
        'cancellation',
      );
      return;
    }
    default:
      return;
  }
}

type ActivityContinuationDraft = Extract<
  StudioAgentEventDraft,
  {
    type:
      | 'activity.progress'
      | 'activity.completed'
      | 'activity.failed'
      | 'activity.cancelled';
  }
>;

async function updateRunningActivity(
  transaction: TransactionClient,
  draft: ActivityContinuationDraft,
  sequence: bigint,
  data: Prisma.StudioAgentActivityUpdateManyMutationInput,
  transition: string,
): Promise<void> {
  const result = await transaction.studioAgentActivity.updateMany({
    where: {
      id: draft.payload.activityId,
      threadId: draft.threadId,
      runId: draft.runId,
      status: 'running',
      lastEventSequence: { lt: sequence },
    },
    data: {
      ...data,
      lastEventSequence: sequence,
    },
  });
  if (result.count !== 1) {
    throw activityProjectionConflict(
      draft.payload.activityId,
      `The activity ${transition} does not follow a running activity in this run.`,
    );
  }
}

function activityProjectionConflict(
  activityId: string,
  message: string,
): ConflictException {
  return new ConflictException({
    code: 'STUDIO_AGENT_ACTIVITY_PROJECTION_CONFLICT',
    message,
    activityId,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
