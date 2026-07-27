import {
  QUOTA_STRICT_REDIS_OPTIONS,
  requireQuotaRedisUrl,
} from './quota-strict-redis';

describe('strict paid quota Redis policy', () => {
  it('fails disconnected and in-flight commands within a finite bound', () => {
    expect(QUOTA_STRICT_REDIS_OPTIONS).toMatchObject({
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 2_000,
      connectTimeout: 2_000,
      autoResendUnfulfilledCommands: false,
    });
    const retry = QUOTA_STRICT_REDIS_OPTIONS.retryStrategy;
    expect(retry?.(1)).toBe(200);
    expect(retry?.(10)).toBe(2_000);
    expect(retry?.(100)).toBe(5_000);
  });

  it('requires an explicit valid Redis URL instead of a production fallback', () => {
    expect(() => requireQuotaRedisUrl({})).toThrow(
      'Missing required env var: REDIS_URL',
    );
    expect(() => requireQuotaRedisUrl({ REDIS_URL: '   ' })).toThrow(
      'Missing required env var: REDIS_URL',
    );
    expect(() =>
      requireQuotaRedisUrl({ REDIS_URL: 'https://redis.example.com' }),
    ).toThrow('REDIS_URL must use the redis:// or rediss:// protocol.');
    expect(
      requireQuotaRedisUrl({
        REDIS_URL: '  rediss://redis.example.com:6380/0  ',
      }),
    ).toBe('rediss://redis.example.com:6380/0');
  });
});
