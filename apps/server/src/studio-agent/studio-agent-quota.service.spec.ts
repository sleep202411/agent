import {
  Prisma,
  StudioAgentQuotaChargeStatus,
  type StudioAgentQuotaChargeAttempt,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import type { EntitlementService } from '../entitlements';
import type { PrismaService } from '../infra/db/db.module';
import type { QuotaService } from '../quota/quota.service';
import type { QuotaProfile } from '../quota/quota.types';
import type { StudioAgentConfigService } from './studio-agent.config';
import { StudioAgentQuotaService } from './studio-agent-quota.service';
import { anyDate, objectContaining } from './__tests__/typed-expect';

const ATTEMPT_ID = '019f8f00-0000-7000-8000-000000000001';
const THREAD_ID = '019f8f00-0000-7000-8000-000000000002';
const WORKSPACE_ID = '019f8f00-0000-7000-8000-000000000003';
const ROOT_RUN_ID = '019f8f00-0000-7000-8000-000000000004';
const CLIENT_MESSAGE_ID = 'client-message-1';
const REQUEST_HASH = 'a'.repeat(64);
const USER_ID = 'user-studio-agent';
const OPERATION_KEY = `studio-agent-charge:v1:${ATTEMPT_ID}`;

const PROFILE: QuotaProfile = {
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
  upgrade: {
    planKey: 'standard',
    tier: 'standard',
    limits: {
      imageDaily: 60,
      videoDaily: 10,
      chatDaily: 350,
      workflowDaily: 20,
      uploadMB: 3072,
      chatPerMinute: 50,
    },
  },
};

describe('StudioAgentQuotaService', () => {
  it('fails closed before mutation when per-minute admission is unavailable', async () => {
    const quota = quotaMock();
    quota.checkChatRate.mockRejectedValue(new Error('redis unavailable'));
    const entitlements = {
      quotaProfileForUser: jest.fn().mockResolvedValue(PROFILE),
    };
    const prisma = prismaMock(attemptRow());
    const service = createService(prisma, quota, entitlements);

    await expect(
      service.assertRateLimit({ userId: USER_ID } as AuthUser, WORKSPACE_ID),
    ).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'STUDIO_AGENT_QUOTA_UNAVAILABLE',
        cause: 'redis unavailable',
      },
    });
    expect(entitlements.quotaProfileForUser).toHaveBeenCalledWith(
      { userId: USER_ID },
      { workspaceId: WORKSPACE_ID },
    );
    expect(prisma.studioAgentQuotaChargeAttempt.create).not.toHaveBeenCalled();
  });

  it('serializes admission and rejects a full per-user root capacity without creating a coordinator', async () => {
    const attempt = attemptRow();
    const quota = quotaMock();
    const prisma = prismaMock(attempt);
    prisma.studioAgentQuotaChargeAttempt.findUnique.mockResolvedValue(null);
    prisma.studioAgentQuotaChargeAttempt.findFirst.mockResolvedValue(null);
    prisma.studioAgentThread.findUniqueOrThrow.mockResolvedValue({
      activeRunId: null,
    });
    prisma.$queryRaw
      .mockResolvedValueOnce([{ activeRootRuns: 0n, reservedTokenUnits: 0n }])
      .mockResolvedValueOnce([{ activeRootRuns: 0n, reservedTokenUnits: 0n }])
      .mockResolvedValueOnce([
        { activeRootRuns: 4n, reservedTokenUnits: 4_000_000n },
      ]);
    const service = createService(prisma, quota);

    await expect(
      service.prepareRootAttempt({
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
        threadId: THREAD_ID,
        clientMessageId: CLIENT_MESSAGE_ID,
        requestHash: REQUEST_HASH,
        quotaProfile: PROFILE,
      }),
    ).rejects.toMatchObject({
      status: 429,
      response: {
        code: 'STUDIO_AGENT_CONCURRENCY_LIMIT',
        scope: 'user',
      },
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
    expect(prisma.studioAgentQuotaChargeAttempt.create).not.toHaveBeenCalled();
    expect(quota.consume).not.toHaveBeenCalled();
  });

  it('reopens a refunded run-less coordinator with a fresh attempt id', async () => {
    // A prior submit for this clientMessageId was deterministically rejected
    // and fully refunded (Redis fence finalized) without ever binding a run.
    const released = attemptRow({
      status: StudioAgentQuotaChargeStatus.refunded,
      rootRunId: null,
      terminalAt: new Date('2026-07-24T17:05:00.000Z'),
      redisFinalizedAt: new Date('2026-07-24T17:05:00.000Z'),
    });
    const quota = quotaMock();
    const prisma = prismaMock(released);
    // No live reservation holds the thread once the shell is dropped.
    prisma.studioAgentQuotaChargeAttempt.findFirst.mockResolvedValue(null);
    const service = createService(prisma, quota);
    expect(service.isReopenableRootAttempt(released)).toBe(true);
    expect(
      service.isReopenableRootAttempt(
        attemptRow({ status: StudioAgentQuotaChargeStatus.charged }),
      ),
    ).toBe(false);

    await service.prepareRootAttempt({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      threadId: THREAD_ID,
      clientMessageId: CLIENT_MESSAGE_ID,
      requestHash: REQUEST_HASH,
      quotaProfile: PROFILE,
    });

    // The sealed shell is dropped and a brand-new coordinator is created so the
    // fresh charge cannot collide with the finalized idempotency fence.
    expect(prisma.studioAgentQuotaChargeAttempt.delete).toHaveBeenCalledWith({
      where: { id: released.id },
    });
    expect(prisma.studioAgentQuotaChargeAttempt.create).toHaveBeenCalledTimes(
      1,
    );
    const createArg =
      prisma.studioAgentQuotaChargeAttempt.create.mock.calls[0][0];
    expect(createArg.data.id).not.toBe(released.id);
  });

  it('uses one persistent Redis debit identity and acknowledges it with a PG compare-and-set', async () => {
    const attempt = attemptRow();
    const quota = quotaMock();
    const prisma = prismaMock(attempt);
    const service = createService(prisma, quota);

    await expect(service.consumeAttempt(ATTEMPT_ID)).resolves.toMatchObject({
      id: ATTEMPT_ID,
      status: StudioAgentQuotaChargeStatus.charged,
    });
    expect(quota.consume).toHaveBeenCalledWith(
      objectContaining({
        userId: USER_ID,
        profile: PROFILE,
        dimension: 'chat',
        cost: 1,
        idempotencyKey: OPERATION_KEY,
        idempotencyTtlSeconds: 'persistent',
        failureMode: 'closed',
        window: {
          dayBucket: '2026-07-24',
          monthBucket: '2026-07',
        },
      }),
    );
    expect(
      prisma.studioAgentQuotaChargeAttempt.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        id: ATTEMPT_ID,
        status: StudioAgentQuotaChargeStatus.consume_pending,
      },
      data: { status: StudioAgentQuotaChargeStatus.charged },
    });
  });

  it('snapshots authoritative model usage when the root enters its terminal transaction', async () => {
    const attempt = attemptRow({
      status: StudioAgentQuotaChargeStatus.charged,
      rootRunId: ROOT_RUN_ID,
    });
    const quota = quotaMock();
    const prisma = prismaMock(attempt);
    prisma.studioAgentModelAttempt.aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _sum: {
        inputTokens: 1200,
        outputTokens: 450,
        cachedInputTokens: 300,
        reasoningTokens: 80,
      },
    });
    const service = createService(prisma, quota);
    const terminalAt = new Date('2026-07-24T18:00:00.000Z');

    await service.markRootTerminalInTransaction(
      prisma as never,
      ROOT_RUN_ID,
      'succeeded',
      terminalAt,
    );

    expect(prisma.studioAgentModelAttempt.aggregate).toHaveBeenCalledWith({
      where: {
        run: { rootRunId: ROOT_RUN_ID },
        status: { in: ['succeeded', 'failed', 'cancelled'] },
      },
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cachedInputTokens: true,
        reasoningTokens: true,
      },
    });
    expect(
      prisma.studioAgentQuotaChargeAttempt.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        rootRunId: ROOT_RUN_ID,
        status: StudioAgentQuotaChargeStatus.charged,
      },
      data: {
        status: StudioAgentQuotaChargeStatus.settle_pending,
        refundReason: null,
        terminalAt,
        actualModelAttempts: 3,
        actualInputTokens: 1200n,
        actualOutputTokens: 450n,
        actualCachedInputTokens: 300n,
        actualReasoningTokens: 80n,
      },
    });
  });

  it('reconciles a failed root refund without holding its PG decision lock across Redis', async () => {
    const order: string[] = [];
    const attempt = attemptRow({
      status: StudioAgentQuotaChargeStatus.refund_pending,
      rootRunId: ROOT_RUN_ID,
      refundReason: 'failed',
      terminalAt: new Date('2026-07-24T18:00:00.000Z'),
    });
    const quota = quotaMock();
    quota.refundFor.mockImplementation(() => {
      order.push('redis:refund');
      return Promise.resolve({ ok: true, status: 'ok' });
    });
    const prisma = prismaMock(attempt);
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof prisma) => Promise<unknown>) => {
        order.push('pg:begin');
        const result = await callback(prisma);
        order.push('pg:commit');
        return result;
      },
    );
    prisma.$executeRaw.mockImplementation(() => {
      order.push('pg:lock');
      return Promise.resolve(1);
    });
    const service = createService(prisma, quota);

    await expect(service.reconcileAttempt(ATTEMPT_ID)).resolves.toBe(true);
    expect(order).toEqual(['pg:begin', 'pg:lock', 'pg:commit', 'redis:refund']);
    expect(quota.refundFor).toHaveBeenCalledWith(
      objectContaining({
        idempotencyKey: OPERATION_KEY,
        reason: 'studio_agent_failed',
        terminalFence: true,
      }),
    );
    expect(quota.finalizeIdempotencyFor).toHaveBeenCalledWith({
      userId: USER_ID,
      dimension: 'chat',
      idempotencyKey: OPERATION_KEY,
    });
    expect(attempt).toMatchObject({
      status: StudioAgentQuotaChargeStatus.refunded,
      redisFinalizedAt: anyDate(),
    });
  });

  it('recovers a crash after Redis consume and refunds the same logical attempt', async () => {
    const attempt = attemptRow({
      admissionExpiresAt: new Date('2026-07-24T00:00:00.000Z'),
    });
    const quota = quotaMock();
    const prisma = prismaMock(attempt);
    const service = createService(prisma, quota);

    await expect(service.reconcileAttempt(ATTEMPT_ID)).resolves.toBe(true);
    expect(quota.consume).toHaveBeenCalledWith(
      objectContaining({
        idempotencyKey: OPERATION_KEY,
        idempotencyTtlSeconds: 'persistent',
        reason: 'studio_agent_root_turn_recovery',
      }),
    );
    expect(quota.refundFor).toHaveBeenCalledWith(
      objectContaining({
        idempotencyKey: OPERATION_KEY,
        terminalFence: true,
      }),
    );
    expect(attempt.status).toBe(StudioAgentQuotaChargeStatus.refunded);
  });
});

function createService(
  prisma: ReturnType<typeof prismaMock>,
  quota = quotaMock(),
  entitlements: { quotaProfileForUser: jest.Mock } = {
    quotaProfileForUser: jest.fn().mockResolvedValue(PROFILE),
  },
) {
  return new StudioAgentQuotaService(
    prisma as unknown as PrismaService,
    quota as unknown as QuotaService,
    entitlements as unknown as EntitlementService,
    configMock() as unknown as StudioAgentConfigService,
  );
}

function quotaMock() {
  return {
    checkChatRate: jest.fn().mockResolvedValue({ ok: true, remaining: 39 }),
    consume: jest.fn().mockResolvedValue({
      ok: true,
      dimension: 'chat',
      used: 1,
      limit: 200,
      remaining: 199,
      deduped: false,
    }),
    refundFor: jest.fn().mockResolvedValue({ ok: true, status: 'ok' }),
    finalizeIdempotencyFor: jest
      .fn()
      .mockResolvedValue({ ok: true, status: 'ok' }),
  };
}

function configMock() {
  return {
    value: {
      budget: { maxTotalTokenUnits: 1_000_000 },
      admission: {
        leaseMs: 120_000,
        reconcileIntervalMs: 5_000,
        reconcileBatchSize: 50,
        maxActiveRootRuns: {
          global: 512,
          workspace: 64,
          user: 4,
        },
        maxReservedTokenUnits: {
          global: 512_000_000,
          workspace: 64_000_000,
          user: 4_000_000,
        },
      },
    },
  };
}

function attemptRow(overrides: Partial<StudioAgentQuotaChargeAttempt> = {}) {
  return Object.assign(baseAttemptRow(), overrides);
}

function baseAttemptRow(): StudioAgentQuotaChargeAttempt {
  return {
    id: ATTEMPT_ID,
    threadId: THREAD_ID,
    rootRunId: null as string | null,
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    clientMessageId: CLIENT_MESSAGE_ID,
    requestHash: REQUEST_HASH,
    dayBucket: '2026-07-24',
    monthBucket: '2026-07',
    quotaProfile: {
      planKey: PROFILE.planKey,
      tier: PROFILE.tier,
      limits: { ...PROFILE.limits },
      upgrade: PROFILE.upgrade
        ? {
            planKey: PROFILE.upgrade.planKey,
            tier: PROFILE.upgrade.tier,
            limits: { ...PROFILE.upgrade.limits },
          }
        : null,
    } as Prisma.JsonValue,
    quotaCost: 1,
    reservedTokenUnits: 1_000_000n,
    actualModelAttempts: 0,
    actualInputTokens: 0n,
    actualOutputTokens: 0n,
    actualCachedInputTokens: 0n,
    actualReasoningTokens: 0n,
    status: StudioAgentQuotaChargeStatus.consume_pending,
    refundReason: null as string | null,
    rejection: null,
    admissionExpiresAt: new Date('2099-07-24T18:00:00.000Z'),
    terminalAt: null as Date | null,
    redisFinalizedAt: null as Date | null,
    createdAt: new Date('2026-07-24T17:00:00.000Z'),
    updatedAt: new Date('2026-07-24T17:00:00.000Z'),
  };
}

function prismaMock(attempt: StudioAgentQuotaChargeAttempt) {
  const matches = (where: Record<string, unknown>) => {
    if (where.id && where.id !== attempt.id) return false;
    if (where.rootRunId === null && attempt.rootRunId !== null) return false;
    if (
      typeof where.rootRunId === 'string' &&
      where.rootRunId !== attempt.rootRunId
    ) {
      return false;
    }
    if (
      where.status &&
      typeof where.status === 'string' &&
      where.status !== attempt.status
    ) {
      return false;
    }
    if (where.redisFinalizedAt === null && attempt.redisFinalizedAt !== null) {
      return false;
    }
    return true;
  };
  const repository = {
    findUnique: jest.fn().mockResolvedValue(attempt),
    findUniqueOrThrow: jest
      .fn()
      .mockImplementation(() => Promise.resolve(attempt)),
    findFirst: jest.fn().mockImplementation(() => Promise.resolve(attempt)),
    findMany: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue(attempt),
    create: jest
      .fn<
        Promise<StudioAgentQuotaChargeAttempt>,
        [Prisma.StudioAgentQuotaChargeAttemptCreateArgs]
      >()
      .mockResolvedValue(attempt),
    update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      Object.assign(attempt, data);
      return Promise.resolve(attempt);
    }),
    updateMany: jest.fn(
      ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const accepted = matches(where);
        if (accepted) Object.assign(attempt, data);
        return Promise.resolve({ count: accepted ? 1 : 0 });
      },
    ),
  };
  const prisma = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ activeRootRuns: 0n, reservedTokenUnits: 0n }]),
    studioAgentThread: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ activeRunId: null }),
    },
    studioAgentQuotaChargeAttempt: repository,
    studioAgentModelAttempt: {
      aggregate: jest.fn().mockResolvedValue({
        _count: { _all: 0 },
        _sum: {
          inputTokens: null,
          outputTokens: null,
          cachedInputTokens: null,
          reasoningTokens: null,
        },
      }),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (callback: (client: typeof prisma) => Promise<unknown>) => callback(prisma),
  );
  return prisma;
}
