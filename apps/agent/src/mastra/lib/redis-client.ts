import Redis, { type RedisOptions } from "ioredis";

let client: Redis | null = null;

/**
 * Lazy-initialized Redis client singleton shared across the Mastra server,
 * tools, and workflow runtimes. Production expects Redis Stack; all of
 * Redis Stack's extra commands (RediSearch, RedisJSON, Bloom) go through
 * this same connection via `client.call('FT.SEARCH', ...)` style invocations.
 */
export function getRedis(): Redis {
  if (client) return client;

  const url = process.env.REDIS_URL;
  const options: RedisOptions = {
    lazyConnect: false,
    maxRetriesPerRequest: null, // BullMQ needs null; queries will wait on reconnect
    enableReadyCheck: true,
    reconnectOnError: (err) => {
      const msg = err?.message ?? "";
      return msg.includes("READONLY") || msg.includes("ECONNRESET");
    },
  };

  client = url ? new Redis(url, options) : new Redis(options);

  client.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[redis] connection error:", err?.message ?? err);
  });

  return client;
}

/** Test-only: close and reset the singleton so subsequent getRedis() re-creates. */
export async function __resetRedisForTests(): Promise<void> {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
  }
}
