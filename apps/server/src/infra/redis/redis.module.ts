import { requiredEnv } from '../../common/required-env';
/**
 * Redis module — single ioredis client shared across modules that
 * need it (idempotency, rate limiting, future BullMQ).
 *
 * BullMQ creates its own ioredis connections internally (one per
 * queue + one per worker) since it can't share a connection used by
 * other clients (it issues blocking commands). So this module's
 * client is only for non-blocking ops (SET/GET/INCR).
 */
import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

class RedisLifecycle implements OnApplicationShutdown {
  constructor(private readonly client: Redis) {}
  async onApplicationShutdown() {
    await this.client.quit();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () => {
        const url = requiredEnv('REDIS_URL');
        // `lazyConnect: false` — we want the connection eagerly so
        // /ready can probe it; default `enableOfflineQueue: true`
        // buffers commands if we lose Redis temporarily.
        return new Redis(url, {
          maxRetriesPerRequest: null,
          retryStrategy: (times) => Math.min(times * 200, 5_000),
        });
      },
    },
    {
      provide: 'REDIS_LIFECYCLE',
      useFactory: (client: Redis) => new RedisLifecycle(client),
      inject: [REDIS],
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
