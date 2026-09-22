import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { RateLimitService } from './rate-limit.service';

const fixtureUrl = process.env.REDIS_RATE_LIMIT_INTEGRATION_URL;
if (fixtureUrl && fixtureUrl !== 'redis://127.0.0.1:56385/15') {
  throw new Error(
    'Rate-limit integration requires the owned loopback Redis fixture',
  );
}
const suite = fixtureUrl ? describe : describe.skip;
suite('rate-limit expiry recovery (Redis)', () => {
  let redis: Redis;
  let service: RateLimitService;
  const keys: string[] = [];
  beforeAll(async () => {
    redis = new Redis(fixtureUrl!);
    await redis.ping();
    service = new RateLimitService(redis);
  });
  afterAll(async () => {
    try {
      if (keys.length) await redis.del(...keys);
    } finally {
      redis.disconnect();
    }
  });
  function request(max = 3) {
    const args = {
      bucket: 'fixture',
      actorId: randomUUID(),
      max,
      windowSec: 3600,
    };
    const now = Math.floor(Date.now() / 1000);
    const key = `ratelimit:${args.bucket}:${args.actorId}:${now - (now % args.windowSec)}`;
    keys.push(key);
    return { args, key };
  }
  it('repairs a counter left without expiry by an interrupted admission', async () => {
    const { args, key } = request();
    await redis.set(key, '1');
    await expect(service.guard(args)).resolves.toMatchObject({ remaining: 1 });
    expect(await redis.ttl(key)).toBeGreaterThan(0);
    expect(await redis.get(key)).toBe('2');
  });
  it('keeps the existing expiry rather than extending it on each request', async () => {
    const { args, key } = request();
    await redis.set(key, '1', 'EX', 120);
    await service.guard(args);
    expect(await redis.ttl(key)).toBeLessThanOrEqual(120);
    expect(await redis.ttl(key)).toBeGreaterThan(0);
  });
  it('preserves fail-open behavior for a Redis command failure', async () => {
    const { args, key } = request();
    await redis.set(key, 'not-a-counter');
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      await expect(service.guard(args)).resolves.toEqual({
        remaining: args.max,
        resetInSec: args.windowSec,
      });
      expect(warning).toHaveBeenCalledTimes(1);
      expect(await redis.get(key)).toBe('not-a-counter');
    } finally {
      warning.mockRestore();
    }
  });
  it('counts concurrent admissions exactly and expires the shared counter', async () => {
    const { args, key } = request(2);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => service.guard(args)),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(2);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(2);
    expect(await redis.get(key)).toBe('4');
    expect(await redis.ttl(key)).toBeGreaterThan(0);
  });
});
