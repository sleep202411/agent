import {
  HttpException,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { lastValueFrom, throwError } from 'rxjs';
import { QuotaInterceptor } from './quota.interceptor';
import type { QuotaService } from './quota.service';

function context(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
  } as unknown as ExecutionContext;
}

describe('QuotaInterceptor refund ownership', () => {
  const requirement = {
    dimension: 'chat' as const,
    cost: 1,
    reason: 'copilot',
  };
  const limits = {
    imageDaily: 30,
    videoDaily: 4,
    chatDaily: 200,
    workflowDaily: 10,
    uploadMB: 1024,
    chatPerMinute: 40,
  };
  const profile = { planKey: 'basic', tier: 'basic' as const, limits };
  let quota: { refundFor: jest.Mock };
  let interceptor: QuotaInterceptor;

  beforeEach(() => {
    quota = { refundFor: jest.fn().mockResolvedValue({ status: 'ok' }) };
    interceptor = new QuotaInterceptor(
      { get: jest.fn().mockReturnValue(requirement) } as unknown as Reflector,
      quota as unknown as QuotaService,
    );
  });

  function next(error: unknown): CallHandler {
    return { handle: () => throwError(() => error) };
  }

  it('refunds a failure only when this request owns a real debit', async () => {
    const req = {
      user: { userId: 'user-a' },
      __quotaConsumeReceipt: {
        userId: 'user-a',
        profile,
        dimension: 'chat',
        cost: 1,
        idempotencyKey: 'turn-1',
        debited: true,
      },
    };
    await expect(
      lastValueFrom(
        interceptor.intercept(context(req), next(new Error('failed'))),
      ),
    ).rejects.toThrow('failed');
    expect(quota.refundFor).toHaveBeenCalledWith({
      userId: 'user-a',
      limits,
      dimension: 'chat',
      cost: 1,
      idempotencyKey: 'turn-1',
      reason: 'copilot_failed',
    });
  });

  it.each([
    ['deduplicated request', false, 'user-a', 'chat'],
    ['different authenticated user', true, 'user-b', 'chat'],
    ['different quota dimension', true, 'user-a', 'image'],
  ])(
    'never refunds the prior debit for a %s',
    async (_label, debited, owner, dimension) => {
      const req = {
        user: { userId: 'user-a' },
        __quotaConsumeReceipt: {
          userId: owner,
          profile,
          dimension,
          cost: 1,
          idempotencyKey: 'turn-1',
          debited,
        },
      };
      await expect(
        lastValueFrom(
          interceptor.intercept(context(req), next(new Error('failed'))),
        ),
      ).rejects.toThrow('failed');
      expect(quota.refundFor).not.toHaveBeenCalled();
    },
  );

  it('refunds a downstream 429 when this request was already debited', async () => {
    const req = {
      user: { userId: 'user-a' },
      __quotaConsumeReceipt: {
        userId: 'user-a',
        profile,
        dimension: 'chat',
        cost: 1,
        idempotencyKey: 'turn-1',
        debited: true,
      },
    };
    await expect(
      lastValueFrom(
        interceptor.intercept(
          context(req),
          next(new HttpException('quota', 429)),
        ),
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(quota.refundFor).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-a',
        idempotencyKey: 'turn-1',
      }),
    );
  });
});
