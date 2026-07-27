import { type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { EntitlementService } from '../entitlements';
import { QuotaGuard } from './quota.guard';
import type { QuotaService } from './quota.service';

function context(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

describe('QuotaGuard debit receipts', () => {
  const requirement = {
    dimension: 'chat' as const,
    cost: 2,
    reason: 'test',
    idempotencyFrom: 'header:x-idempotency-key' as const,
  };
  const profile = {
    planKey: 'basic',
    tier: 'basic' as const,
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
  let reflector: { get: jest.Mock };
  let quota: { consume: jest.Mock; checkChatRate: jest.Mock };
  let entitlements: { quotaProfileForUser: jest.Mock };
  let guard: QuotaGuard;

  beforeEach(() => {
    reflector = { get: jest.fn().mockReturnValue(requirement) };
    quota = {
      consume: jest.fn(),
      checkChatRate: jest.fn(),
    };
    entitlements = {
      quotaProfileForUser: jest.fn().mockResolvedValue(profile),
    };
    guard = new QuotaGuard(
      reflector as unknown as Reflector,
      quota as unknown as QuotaService,
      entitlements as unknown as EntitlementService,
    );
  });

  function request(key = 'operation_12345678') {
    return {
      user: { userId: 'user-a' },
      header: jest.fn().mockReturnValue(key),
      body: {},
    };
  }

  it('marks only a new finite Redis consume as debited', async () => {
    quota.consume.mockResolvedValue({
      ok: true,
      dimension: 'chat',
      used: 2,
      limit: 200,
      remaining: 198,
      deduped: false,
    });
    const req = request();
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req).toMatchObject({
      __quotaConsumeReceipt: {
        userId: 'user-a',
        profile: {
          planKey: 'basic',
          tier: 'basic',
          limits: profile.limits,
        },
        dimension: 'chat',
        cost: 2,
        idempotencyKey: 'operation_12345678',
        debited: true,
      },
    });
  });

  it.each([
    ['a deduplicated consume', 2, true],
    ['the Redis fail-open path', Number.NaN, false],
  ])(
    'does not grant refund ownership for %s',
    async (_label, used, deduped) => {
      quota.consume.mockResolvedValue({
        ok: true,
        dimension: 'chat',
        used,
        limit: 200,
        remaining: 198,
        deduped,
      });
      const req = request();
      await guard.canActivate(context(req));
      expect(req).toMatchObject({
        __quotaConsumeReceipt: { debited: false },
      });
    },
  );

  it('rejects unbounded or unsafe caller keys before consuming', async () => {
    for (const key of [
      'a'.repeat(201),
      '界'.repeat(67),
      'contains whitespace',
      'control\0character',
    ]) {
      const req = request(key);
      // `status` is HttpException's private runtime field (getStatus() is the
      // public accessor), so it cannot be expressed as Partial<HttpException>.
      await expect(guard.canActivate(context(req))).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(quota.consume).not.toHaveBeenCalled();
  });

  it('accepts an operation key at the exact HTTP boundary', async () => {
    quota.consume.mockResolvedValue({
      ok: true,
      dimension: 'chat',
      used: 1,
      limit: 200,
      remaining: 199,
      deduped: false,
    });
    const key = 'a'.repeat(200);
    await expect(guard.canActivate(context(request(key)))).resolves.toBe(true);
    expect(quota.consume).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: key }),
    );
  });
});
