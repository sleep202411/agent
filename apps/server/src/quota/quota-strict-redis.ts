import Redis, { type RedisOptions } from 'ioredis';

/**
 * Isolated Redis connection for paid quota state machines.
 *
 * Unlike the shared best-effort connection, this client never queues a paid
 * command while disconnected and never retries forever. A caller therefore
 * gets a bounded failure and can leave its durable PostgreSQL outbox pending
 * for a later reconciliation worker.
 */
export const QUOTA_STRICT_REDIS = Symbol('QUOTA_STRICT_REDIS');

export function requireQuotaRedisUrl(env: NodeJS.ProcessEnv): string {
  const value = env.REDIS_URL?.trim();
  if (!value) {
    throw new Error(
      'Missing required env var: REDIS_URL (quota admission requires Redis).',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL.');
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use the redis:// or rediss:// protocol.');
  }
  return value;
}

export const QUOTA_STRICT_REDIS_OPTIONS: RedisOptions = {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  commandTimeout: 2_000,
  connectTimeout: 2_000,
  autoResendUnfulfilledCommands: false,
  autoResubscribe: false,
  // Connection recovery continues in the background; individual paid
  // commands still fail immediately because they are never queued offline.
  retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
};

export function createStrictQuotaRedis(url: string): Redis {
  return new Redis(url, QUOTA_STRICT_REDIS_OPTIONS);
}

export class StrictQuotaRedisLifecycle {
  constructor(private readonly client: Redis) {}

  onApplicationShutdown(): void {
    // `disconnect(false)` drops in-flight work instead of putting a paid
    // command back onto an offline queue during process shutdown.
    this.client.disconnect(false);
  }
}
