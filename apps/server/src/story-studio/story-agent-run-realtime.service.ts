import { Inject, Injectable, Logger } from '@nestjs/common';
import { backgroundTasksEnabled } from '../common/background-tasks';
import { AiOutboxEventType, Prisma } from '@prisma/client';
import {
  StoryAgentRunRealtimeEventSchema,
  type AssetEvent,
  type StoryAgentRunDto,
} from '@repo/shared';
import { enqueueRealtimeEvent } from '../ai-generation/outbox.service';
import { PrismaService } from '../infra/db/db.module';
import { storyProjectChannel } from '../infra/realtime/realtime-groups';
import {
  REALTIME_PROVIDER,
  type RealtimeProvider,
} from '../infra/realtime/realtime-provider';

export interface StoryAgentRealtimeDispatch {
  outboxId: string;
  eventId: string;
  userId: string;
  event: AssetEvent;
}

/**
 * Durable, project-scoped Story Agent lifecycle fan-out.
 *
 * Callers enqueue from the same transaction as their state transition. After
 * commit, `publishCommitted` accelerates delivery; if that optimistic publish
 * fails, the shared durable outbox dispatcher retries it. The event id makes a
 * dispatcher race harmless for clients.
 */
@Injectable()
export class StoryAgentRunRealtimeService {
  private readonly logger = new Logger(StoryAgentRunRealtimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REALTIME_PROVIDER)
    private readonly realtime: RealtimeProvider,
  ) {}

  async enqueue(
    tx: Prisma.TransactionClient,
    run: StoryAgentRunDto,
  ): Promise<StoryAgentRealtimeDispatch> {
    const channel = storyProjectChannel(run.projectId);
    const payload = StoryAgentRunRealtimeEventSchema.parse({
      kind: 'story_agent_run_changed',
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      run,
      ts: Date.now(),
    });
    const envelope = await enqueueRealtimeEvent(tx, {
      channel,
      eventType: AiOutboxEventType.story_agent_run_changed,
      payload: payload as unknown as Prisma.InputJsonValue,
      userId: run.initiator.id,
    });
    return {
      outboxId: envelope.outboxId,
      eventId: envelope.eventId,
      userId: run.initiator.id,
      event: {
        ...payload,
        channel,
        seq: Number(envelope.seq),
        eventId: envelope.eventId,
      },
    };
  }

  async publishCommitted(
    dispatch: StoryAgentRealtimeDispatch | null,
  ): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (!dispatch) return;
    try {
      await this.realtime.publishAssetEvent(dispatch.userId, dispatch.event);
      await this.prisma.aiEventOutbox.updateMany({
        where: {
          id: dispatch.outboxId,
          dispatchedAt: null,
          deadAt: null,
        },
        data: {
          dispatchedAt: new Date(),
          attempt: { increment: 1 },
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          nextAttemptAt: null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Optimistic Story Agent event publish failed event=${dispatch.eventId}: ${errorText(error)}`,
      );
      // The durable dispatcher owns retries and DLQ handling.
    }
  }
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
