import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  StudioAgentEventDraftSchema,
  type StudioAgentEvent,
  type StudioAgentEventDraft,
} from '@repo/shared/studio-agent';
import Redis from 'ioredis';
import { Subject, type Observable } from 'rxjs';
import { PrismaService } from '../infra/db/db.module';
import { REDIS } from '../infra/redis/redis.module';
import { toStudioAgentEvent } from './studio-agent.mapper';

const EVENT_CHANNEL_PREFIX = 'studio-agent:events:';

export interface StudioAgentEventNotification {
  threadId: string;
  sequence: number;
}

/**
 * Redis only wakes connected API pods; PostgreSQL remains the replay source.
 * A dropped notification therefore delays a live refresh until the heartbeat,
 * but can never lose an event.
 */
@Injectable()
export class StudioAgentEventNotifier
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(StudioAgentEventNotifier.name);
  private readonly local = new Subject<StudioAgentEventNotification>();
  private readonly subscriber: Redis;

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    this.subscriber = redis.duplicate();
  }

  async onModuleInit(): Promise<void> {
    this.subscriber.on('pmessage', (_pattern, channel, rawSequence) => {
      const threadId = channel.slice(EVENT_CHANNEL_PREFIX.length);
      const sequence = Number(rawSequence);
      if (
        threadId.length > 0 &&
        Number.isSafeInteger(sequence) &&
        sequence > 0
      ) {
        this.local.next({ threadId, sequence });
      }
    });
    await this.subscriber.psubscribe(`${EVENT_CHANNEL_PREFIX}*`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.local.complete();
    await this.subscriber.quit();
  }

  notifications(): Observable<StudioAgentEventNotification> {
    return this.local.asObservable();
  }

  publish(event: StudioAgentEvent): void {
    const notification = {
      threadId: event.threadId,
      sequence: event.sequence,
    };
    // The originating pod should wake immediately rather than waiting for the
    // Redis round trip.
    this.local.next(notification);
    void this.redis
      .publish(
        `${EVENT_CHANNEL_PREFIX}${event.threadId}`,
        String(event.sequence),
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to publish Studio Agent event notification: ${describe(error)}`,
        );
      });
  }
}

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class StudioAgentEventStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: StudioAgentEventNotifier,
  ) {}

  async append(rawDraft: StudioAgentEventDraft): Promise<StudioAgentEvent> {
    const draft = StudioAgentEventDraftSchema.parse(rawDraft);
    try {
      const event = await this.prisma.$transaction((transaction) =>
        this.appendInTransaction(transaction, draft),
      );
      this.notifier.publish(event);
      return event;
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
   * its replay event become visible atomically. The caller must publish the
   * returned event only after the transaction commits.
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

  publish(event: StudioAgentEvent): void {
    this.notifier.publish(event);
  }

  async page(
    threadId: string,
    afterSequence: number,
    limit: number,
  ): Promise<{
    events: StudioAgentEvent[];
    latestSequence: number;
    hasMore: boolean;
  }> {
    return this.prisma.$transaction(
      async (transaction) => {
        const rows = await transaction.studioAgentEvent.findMany({
          where: {
            threadId,
            sequence: { gt: BigInt(afterSequence) },
          },
          orderBy: { sequence: 'asc' },
          take: limit + 1,
        });
        const hasMore = rows.length > limit;
        const events = rows
          .slice(0, limit)
          .map((row) => toStudioAgentEvent(row));
        const allocator = await transaction.studioAgentThread.findUniqueOrThrow(
          {
            where: { id: threadId },
            select: { nextEventSequence: true },
          },
        );
        return {
          events,
          latestSequence: safeSequence(allocator.nextEventSequence - 1n),
          hasMore,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
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

function safeSequence(value: bigint): number {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new RangeError('Event sequence exceeds the wire contract range.');
  }
  return sequence;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
