import type Redis from 'ioredis';
import type { QuotaEventsService } from './quota-events.service';
import { idempotencyKey } from './quota-keys';
import { QuotaService } from './quota.service';
import type { QuotaUsageLogService } from './quota-usage-log.service';
import type { QuotaProfile } from './quota.types';

const FREE_PROFILE: QuotaProfile = {
  planKey: 'free',
  tier: 'free',
  limits: {
    imageDaily: 5,
    videoDaily: 0,
    chatDaily: 30,
    workflowDaily: 3,
    uploadMB: 100,
    chatPerMinute: 20,
  },
  upgrade: {
    planKey: 'basic',
    tier: 'basic',
    limits: {
      imageDaily: 30,
      videoDaily: 4,
      chatDaily: 200,
      workflowDaily: 10,
      uploadMB: 1024,
      chatPerMinute: 40,
    },
  },
};

const VIP1_PROFILE: QuotaProfile = {
  planKey: 'basic',
  tier: 'basic',
  limits: {
    imageDaily: 30,
    videoDaily: 4,
    chatDaily: 200,
    workflowDaily: 10,
    uploadMB: 1024,
    chatPerMinute: 40,
  },
  upgrade: null,
};

describe('QuotaService strict Redis boundary', () => {
  let strictRedis: {
    evalsha: jest.Mock;
    eval: jest.Mock;
    script: jest.Mock;
    expire: jest.Mock;
    mget: jest.Mock;
    get: jest.Mock;
  };
  let audit: { log: jest.Mock };
  let events: { publishUpdate: jest.Mock };
  let service: QuotaService;

  beforeEach(() => {
    strictRedis = {
      evalsha: jest
        .fn()
        .mockResolvedValueOnce(['ok', '1', '30', '0'])
        .mockResolvedValueOnce(['ok', '0', '1']),
      eval: jest.fn(),
      script: jest.fn().mockResolvedValue('loaded-sha'),
      expire: jest.fn().mockResolvedValue(1),
      mget: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue(null),
    };
    audit = { log: jest.fn() };
    events = { publishUpdate: jest.fn().mockResolvedValue(undefined) };
    service = new QuotaService(
      strictRedis as unknown as Redis,
      audit as unknown as QuotaUsageLogService,
      events as unknown as QuotaEventsService,
    );
  });

  it('uses the same user/dimension-namespaced digest for consume and refund', async () => {
    await service.consume({
      userId: 'user-a',
      profile: FREE_PROFILE,
      dimension: 'chat',
      idempotencyKey: 'operation-12345678',
      reason: 'test',
    });
    await service.refundFor({
      userId: 'user-a',
      limits: FREE_PROFILE.limits,
      dimension: 'chat',
      cost: 1,
      idempotencyKey: 'operation-12345678',
    });
    const expected = idempotencyKey('user-a', 'chat', 'operation-12345678');
    const calls = strictRedis.evalsha.mock.calls as unknown[][];
    expect(calls[0]?.[4]).toBe(expected);
    expect(calls[1]?.[4]).toBe(expected);
    expect(expected).not.toContain('operation-12345678');
    expect(audit.log).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ idempotencyKey: expected, cost: 1 }),
    );
    expect(audit.log).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ idempotencyKey: expected, cost: -1 }),
    );
  });

  it.each([
    ['empty', ''],
    ['oversized UTF-8', '界'.repeat(171)],
    ['NUL control', 'operation\0key'],
    ['DEL control', 'operationkey'],
  ])(
    'rejects a %s direct operation key before Redis and audit',
    async (_label, key) => {
      await expect(
        service.consume({
          userId: 'user-a',
          profile: FREE_PROFILE,
          dimension: 'chat',
          idempotencyKey: key,
          reason: 'test',
        }),
      ).rejects.toThrow('Invalid quota idempotency operation key.');
      expect(strictRedis.evalsha).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    },
  );

  it('accepts an operation key at the exact service boundary', async () => {
    const key = 'a'.repeat(512);
    await expect(
      service.consume({
        userId: 'user-a',
        profile: FREE_PROFILE,
        dimension: 'chat',
        idempotencyKey: key,
        reason: 'test',
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(strictRedis.evalsha).toHaveBeenCalledTimes(1);
  });

  it('supports a durable persistent idempotency record and explicit finalization', async () => {
    await service.consume({
      userId: 'user-a',
      profile: FREE_PROFILE,
      dimension: 'chat',
      idempotencyKey: 'durable-operation',
      idempotencyTtlSeconds: 'persistent',
      failureMode: 'closed',
      reason: 'test',
    });
    const [consumeCall] = strictRedis.evalsha.mock.calls as unknown[][];
    expect(consumeCall?.[9]).toBe('-1');
    await expect(
      service.finalizeIdempotencyFor({
        userId: 'user-a',
        dimension: 'chat',
        idempotencyKey: 'durable-operation',
      }),
    ).resolves.toEqual({ ok: true, status: 'ok' });
    expect(strictRedis.expire).toHaveBeenCalledWith(
      idempotencyKey('user-a', 'chat', 'durable-operation'),
      24 * 60 * 60,
    );
  });

  it('fails closed without writing a fictional audit debit when Redis is unavailable', async () => {
    strictRedis.evalsha
      .mockReset()
      .mockRejectedValue(new Error('redis unavailable'));
    await expect(
      service.consume({
        userId: 'user-a',
        profile: FREE_PROFILE,
        dimension: 'chat',
        idempotencyKey: 'durable-operation',
        idempotencyTtlSeconds: 'persistent',
        failureMode: 'closed',
        reason: 'test',
      }),
    ).rejects.toThrow('redis unavailable');
    expect(audit.log).not.toHaveBeenCalled();
    expect(strictRedis.eval).not.toHaveBeenCalled();
  });

  it('writes a terminal tombstone before a delayed paid consume and then bounds its TTL', async () => {
    strictRedis.evalsha
      .mockReset()
      .mockResolvedValueOnce(['no_idem', '0', '0'])
      .mockResolvedValueOnce(['ok', '0', '30', '1']);

    await expect(
      service.refundFor({
        userId: 'user-a',
        limits: FREE_PROFILE.limits,
        dimension: 'chat',
        cost: 1,
        idempotencyKey: 'terminal-attempt',
        window: { dayBucket: '2026-01-31', monthBucket: '2026-01' },
        terminalFence: true,
      }),
    ).resolves.toEqual({ ok: true, status: 'no_idem' });

    await expect(
      service.consume({
        userId: 'user-a',
        profile: FREE_PROFILE,
        dimension: 'chat',
        idempotencyKey: 'terminal-attempt',
        idempotencyTtlSeconds: 'persistent',
        failureMode: 'closed',
        reason: 'delayed-old-pod',
        window: { dayBucket: '2026-01-31', monthBucket: '2026-01' },
      }),
    ).resolves.toMatchObject({ ok: true, deduped: true, used: 0 });
    expect(audit.log).not.toHaveBeenCalled();

    await service.finalizeIdempotencyFor({
      userId: 'user-a',
      dimension: 'chat',
      idempotencyKey: 'terminal-attempt',
    });
    expect(strictRedis.expire).toHaveBeenCalledWith(
      idempotencyKey('user-a', 'chat', 'terminal-attempt'),
      24 * 60 * 60,
    );
  });

  it('refunds the original UTC day/month keys and never publishes an old day as current usage', async () => {
    strictRedis.evalsha.mockReset().mockResolvedValue(['ok', '0', '0']);
    await service.refundFor({
      userId: 'user-a',
      limits: FREE_PROFILE.limits,
      dimension: 'chat',
      cost: 1,
      idempotencyKey: 'cross-window-attempt',
      window: { dayBucket: '2026-01-31', monthBucket: '2026-01' },
      terminalFence: true,
    });

    const call = strictRedis.evalsha.mock.calls[0] as unknown[];
    expect(call[2]).toBe('quota:user-a:chat:day:2026-01-31');
    expect(call[3]).toBe('quota:user-a:chat:month:2026-01');
    expect(events.publishUpdate).not.toHaveBeenCalled();
  });

  it('derives the 429 upgrade suggestion from the profile plan ordering', async () => {
    strictRedis.evalsha
      .mockReset()
      .mockResolvedValue(['exceeded', '30', '30', '0']);

    await expect(
      service.consume({
        userId: 'user-a',
        profile: FREE_PROFILE,
        dimension: 'chat',
        reason: 'test',
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: 'quota_exceeded',
      nextTier: 'basic',
      nextPlanKey: 'basic',
      nextTierLimit: 200,
    });
  });

  it('maps an unlimited upgrade cap to -1 and a missing upgrade to nulls', async () => {
    strictRedis.evalsha
      .mockReset()
      .mockResolvedValue(['exceeded', '200', '200', '0']);

    await expect(
      service.consume({
        userId: 'user-a',
        profile: {
          ...FREE_PROFILE,
          upgrade: {
            planKey: 'studio',
            tier: 'pro',
            limits: {
              ...FREE_PROFILE.limits,
              chatDaily: Number.POSITIVE_INFINITY,
            },
          },
        },
        dimension: 'chat',
        reason: 'test',
      }),
    ).resolves.toMatchObject({
      ok: false,
      nextTier: 'pro',
      nextPlanKey: 'studio',
      nextTierLimit: -1,
    });

    await expect(
      service.consume({
        userId: 'user-a',
        profile: VIP1_PROFILE,
        dimension: 'chat',
        reason: 'test',
      }),
    ).resolves.toMatchObject({
      ok: false,
      nextTier: null,
      nextPlanKey: null,
      nextTierLimit: null,
    });
  });

  it('reports real per-minute chat usage in peek (regression: minute key bucket collision)', async () => {
    // Day counters: image, chat, workflow, upload (mget order).
    strictRedis.mget.mockResolvedValue(['1', '4', null, null]);
    // The minute key shares the 'chat' dimension segment with the day
    // key — peek must GET the exact minute key, not a bucketed mget.
    strictRedis.get.mockResolvedValue('7');

    const peek = await service.peek('user-a', FREE_PROFILE);

    expect(strictRedis.get).toHaveBeenCalledWith(
      expect.stringMatching(/^quota:user-a:chat:1m:/),
    );
    expect(peek.tier).toBe('free');
    expect(peek.dimensions.chat).toMatchObject({ used: 4, limit: 30 });
    expect(peek.chatPerMinute).toMatchObject({
      limit: 20,
      remaining: 13,
    });
  });

  it('admits chat rate atomically through one content-addressed Lua command', async () => {
    strictRedis.evalsha.mockReset().mockResolvedValue(2);

    await expect(
      service.checkChatRate('user-a', FREE_PROFILE),
    ).resolves.toEqual({
      ok: true,
      remaining: 18,
    });
    expect(strictRedis.evalsha).toHaveBeenCalledTimes(1);
    const call = strictRedis.evalsha.mock.calls[0] as unknown[];
    expect(call[0]).toEqual(expect.stringMatching(/^[0-9a-f]{40}$/));
    expect(call[1]).toBe(1);
    expect(call[2]).toEqual(expect.stringMatching(/^quota:user-a:chat:1m:/));
    expect(call[3]).toBe('90');
  });

  it('keeps ordinary chat admission fail-open without using another Redis client', async () => {
    strictRedis.evalsha
      .mockReset()
      .mockRejectedValue(new Error('Command timed out'));

    await expect(
      service.checkChatRate('user-a', FREE_PROFILE),
    ).resolves.toEqual({
      ok: true,
      remaining: 0,
    });
    expect(strictRedis.eval).not.toHaveBeenCalled();
  });

  it('fails paid chat admission closed on the same bounded Redis failure', async () => {
    strictRedis.evalsha
      .mockReset()
      .mockRejectedValue(new Error('Stream is not writeable'));

    await expect(
      service.checkChatRate('user-a', VIP1_PROFILE, {
        failureMode: 'closed',
      }),
    ).rejects.toThrow('Stream is not writeable');
    expect(strictRedis.eval).not.toHaveBeenCalled();
  });

  it('does not block boot when strict Redis script loading is unavailable', async () => {
    strictRedis.script.mockRejectedValue(new Error('Connection is closed'));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(strictRedis.script).toHaveBeenCalledTimes(3);
  });

  it('lazy-loads on NOSCRIPT after recovery and returns to EVALSHA', async () => {
    strictRedis.evalsha
      .mockReset()
      .mockRejectedValueOnce(
        new Error('NOSCRIPT No matching script. Please use EVAL.'),
      )
      .mockResolvedValueOnce(2);
    strictRedis.eval.mockResolvedValueOnce(1);

    await expect(
      service.checkChatRate('user-a', VIP1_PROFILE, {
        failureMode: 'closed',
      }),
    ).resolves.toEqual({ ok: true, remaining: 39 });
    const evalCalls = strictRedis.eval.mock.calls as unknown[][];
    const script = String(evalCalls[0]?.[0]);
    expect(script).toContain('redis.call("INCR", key)');
    expect(script).toContain('redis.call("TTL", key)');
    expect(script).toContain('redis.call("EXPIRE", key, ttl)');

    await expect(
      service.checkChatRate('user-a', VIP1_PROFILE, {
        failureMode: 'closed',
      }),
    ).resolves.toEqual({ ok: true, remaining: 38 });
    expect(strictRedis.evalsha).toHaveBeenCalledTimes(2);
    expect(strictRedis.eval).toHaveBeenCalledTimes(1);
  });
});
