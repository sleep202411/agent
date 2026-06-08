/**
 * EntityEventsService — publishes entity-change events to a per-user
 * Redis channel. Mirrors the agent-side `publishEntityEvent` helper;
 * used whenever Nest itself performs a mutation (e.g. the
 * confirmProjectParams short-circuit saves params to Java and then
 * needs to tell the user's open tabs to refetch).
 *
 * Subscriber fans this out over WS (see EntityEventsGateway).
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import {
  entityEventsChannel,
  type EntityEvent,
} from '@repo/shared/entity-events';
import { describeUnknown } from '../../common/values';

type PublishInput = Omit<EntityEvent, 'ts'>;

@Injectable()
export class EntityEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(EntityEventsService.name);
  private readonly publisher: Redis | null;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn('REDIS_URL unset — EntityEventsService is a no-op');
      this.publisher = null;
      return;
    }
    this.publisher = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    this.publisher.on('error', (err: unknown) =>
      this.logger.warn(`publisher error: ${describeUnknown(err)}`),
    );
  }

  async onModuleDestroy() {
    try {
      await this.publisher?.quit();
    } catch {
      this.logger.debug('publisher quit skipped during shutdown');
    }
  }

  async publish(userId: string, input: PublishInput): Promise<void> {
    if (!this.publisher) return;
    const event: EntityEvent = { ...input, ts: Date.now() };
    try {
      await this.publisher.publish(
        entityEventsChannel(userId),
        JSON.stringify(event),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `publish failed userId=${userId} entity=${input.entity}/${input.action}: ${msg}`,
      );
    }
  }
}
