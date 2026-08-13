import {
  CopilotConversationStatus,
  CopilotQuotaChargeStatus,
} from '@prisma/client';
import type { EntitlementService } from '../entitlements';
import type { PrismaService } from '../infra/db/db.module';
import type { QuotaService } from '../quota/quota.service';
import type { QuotaProfile } from '../quota/quota.types';
import { CopilotQuotaService } from './copilot-quota.service';

const BASIC_PROFILE: QuotaProfile = {
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

const PROJECT_ID = '019f7243-20c1-7054-a6fa-0a33da6efef3';
const SESSION_ID = '019f7243-20c1-7054-a6fa-0a33da6efef5';
const TURN_ID = '019f7243-20c1-7054-a6fa-0a33da6efef6';
const BILLING_OPERATION_ID = '019f7243-20c1-7054-a6fa-0a33da6efef7';
const CHARGE_ATTEMPT_ID = '019f7243-20c1-7054-a6fa-0a33da6efef8';
const OPERATION_KEY = `copilot-charge-attempt:v1:${CHARGE_ATTEMPT_ID}`;

interface AttemptMock {
  id: string;
  billingOperationId: string;
  generation: number;
  userId: string;
  conversationId: string;
  sessionId: string;
  ownerTurnId: string;
  dayBucket: string;
  monthBucket: string;
  tier: string | null;
  status: CopilotQuotaChargeStatus;
  refundReason: string | null;
  clientToolExpiresAt: Date | null;
  redisFinalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type ConversationMock = Record<string, unknown>;

describe('CopilotQuotaService durable charge attempts', () => {
  let quota: {
    checkChatRate: jest.Mock;
    consume: jest.Mock;
    refundFor: jest.Mock;
    finalizeIdempotencyFor: jest.Mock;
  };
  let attempt: AttemptMock;
  let conversation: ConversationMock | null;
  let tx: ReturnType<typeof transactionMock>;
  let prisma: { $transaction: jest.Mock; copilotQuotaChargeAttempt: object };
  let entitlements: { quotaProfileForUser: jest.Mock };
  let service: CopilotQuotaService;

  const user = { userId: 'user-a' };
  const input = {
    user,
    workspaceId: null,
    conversationId: `canvas:${PROJECT_ID}`,
    sessionId: SESSION_ID,
    billingOperationId: BILLING_OPERATION_ID,
    chargeAttemptId: CHARGE_ATTEMPT_ID,
    turnId: TURN_ID,
    turnKind: 'user' as const,
  };

  beforeEach(() => {
    attempt = {
      id: CHARGE_ATTEMPT_ID,
      billingOperationId: BILLING_OPERATION_ID,
      generation: 1,
      userId: user.userId,
      conversationId: input.conversationId,
      sessionId: SESSION_ID,
      ownerTurnId: TURN_ID,
      dayBucket: '2026-07-19',
      monthBucket: '2026-07',
      tier: null,
      status: CopilotQuotaChargeStatus.consume_pending,
      refundReason: null,
      clientToolExpiresAt: null,
      redisFinalizedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    conversation = {
      id: 'conversation-row',
      status: CopilotConversationStatus.streaming,
      activeTurnId: TURN_ID,
      activeExpiresAt: new Date(Date.now() + 60_000),
      activeAdmissionToken: '019f7243-20c1-7054-a6fa-0a33da6efef9',
      activeAdmissionRevision: 1,
    };
    quota = {
      checkChatRate: jest.fn().mockResolvedValue({ ok: true, remaining: 10 }),
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
    tx = transactionMock(
      () => attempt,
      () => conversation,
    );
    prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
      copilotQuotaChargeAttempt: tx.copilotQuotaChargeAttempt,
    };
    entitlements = {
      quotaProfileForUser: jest.fn().mockResolvedValue(BASIC_PROFILE),
    };
    service = new CopilotQuotaService(
      quota as unknown as QuotaService,
      prisma as unknown as PrismaService,
      entitlements as unknown as EntitlementService,
    );
  });

  it('uses fail-closed rate admission for Copilot', async () => {
    await expect(
      service.assertRateLimit(user, { workspaceId: null }),
    ).resolves.toBeUndefined();
    expect(entitlements.quotaProfileForUser).toHaveBeenCalledWith(user, {
      workspaceId: null,
    });
    expect(quota.checkChatRate).toHaveBeenCalledWith('user-a', BASIC_PROFILE, {
      failureMode: 'closed',
    });
  });

  it('maps a bounded Redis rate failure to an explicit 503', async () => {
    quota.checkChatRate.mockRejectedValue(new Error('Command timed out'));

    await expect(
      service.assertRateLimit(user, { workspaceId: null }),
    ).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'COPILOT_QUOTA_UNAVAILABLE',
        message: 'Copilot quota admission is temporarily unavailable.',
        cause: 'Command timed out',
      },
    });
  });

  it('uses a persistent attempt-specific Redis identity and acknowledges the debit in PG', async () => {
    await expect(service.consumeTurn(input)).resolves.toMatchObject({
      chargeAttemptId: CHARGE_ATTEMPT_ID,
      debited: true,
    });
    const consumeCalls = quota.consume.mock.calls as unknown[][];
    const consumeInput = consumeCalls[0]?.[0];
    expect(consumeInput).toMatchObject({
      profile: BASIC_PROFILE,
      idempotencyKey: OPERATION_KEY,
      idempotencyTtlSeconds: 'persistent',
      failureMode: 'closed',
      metadata: {
        billingOperationId: BILLING_OPERATION_ID,
        chargeAttemptId: CHARGE_ATTEMPT_ID,
      },
      window: {
        dayBucket: '2026-07-19',
        monthBucket: '2026-07',
      },
    });
    expect(attempt).toMatchObject({
      tier: 'basic',
      status: CopilotQuotaChargeStatus.charged,
    });
  });

  it('trusts the durable charged attempt for a late continuation without touching an expired Redis idem key', async () => {
    attempt.status = CopilotQuotaChargeStatus.charged;
    attempt.tier = 'basic';
    await expect(
      service.consumeTurn({ ...input, turnKind: 'tool-continuation' }),
    ).resolves.toMatchObject({ debited: false });
    expect(quota.consume).not.toHaveBeenCalled();
  });

  it('refunds the same physical attempt when a terminal fence wins after Redis consume but before PG ack', async () => {
    quota.consume.mockImplementation(() => {
      attempt.status = CopilotQuotaChargeStatus.refund_pending;
      attempt.refundReason = 'aborted';
      conversation = null;
      return Promise.resolve({
        ok: true,
        dimension: 'chat',
        used: 1,
        limit: 200,
        remaining: 199,
        deduped: false,
      });
    });

    await expect(service.consumeTurn(input)).rejects.toMatchObject({
      status: 409,
    });
    expect(quota.refundFor).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: OPERATION_KEY,
        reason: 'copilot_stream_aborted',
        terminalFence: true,
        window: {
          dayBucket: '2026-07-19',
          monthBucket: '2026-07',
        },
      }),
    );
    expect(attempt.status).toBe(CopilotQuotaChargeStatus.refunded);
  });

  it('recovers a process crash after Redis consume by fencing the expired owner and idempotently refunding', async () => {
    attempt.tier = 'basic';
    conversation = {
      ...(conversation ?? {}),
      status: CopilotConversationStatus.streaming,
      activeTurnId: TURN_ID,
      activeExpiresAt: new Date(0),
    };

    await expect(
      service.reconcileChargeAttempt(CHARGE_ATTEMPT_ID),
    ).resolves.toBe(true);
    expect(quota.refundFor).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: OPERATION_KEY }),
    );
    expect(attempt.status).toBe(CopilotQuotaChargeStatus.refunded);
    const failedUpdateCalls = tx.copilotConversation.update.mock
      .calls as unknown[][];
    const failedConversationUpdate = failedUpdateCalls[0]?.[0];
    expect(failedConversationUpdate).toMatchObject({
      data: { status: CopilotConversationStatus.failed },
    });
  });

  it('recovers a provider crash after the debit was acknowledged as charged', async () => {
    attempt.tier = 'basic';
    attempt.status = CopilotQuotaChargeStatus.charged;
    attempt.clientToolExpiresAt = null;
    conversation = {
      ...(conversation ?? {}),
      status: CopilotConversationStatus.streaming,
      activeTurnId: TURN_ID,
      activeExpiresAt: new Date(0),
    };

    await expect(
      service.reconcileChargeAttempt(CHARGE_ATTEMPT_ID),
    ).resolves.toBe(true);
    expect(quota.refundFor).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: OPERATION_KEY,
        terminalFence: true,
      }),
    );
    expect(attempt.status).toBe(CopilotQuotaChargeStatus.refunded);
  });

  it('expires a ready client-tool wait atomically before refunding its physical attempt', async () => {
    attempt.tier = 'basic';
    attempt.status = CopilotQuotaChargeStatus.charged;
    attempt.clientToolExpiresAt = new Date(0);
    conversation = {
      ...(conversation ?? {}),
      status: CopilotConversationStatus.ready,
      billingChargeAttemptId: CHARGE_ATTEMPT_ID,
      activeTurnId: null,
      activeExpiresAt: null,
    };

    await expect(
      service.reconcileChargeAttempt(CHARGE_ATTEMPT_ID),
    ).resolves.toBe(true);
    const expiredUpdateCalls = tx.copilotConversation.update.mock
      .calls as unknown[][];
    const expiredConversationUpdate = expiredUpdateCalls[0]?.[0];
    expect(expiredConversationUpdate).toMatchObject({
      data: { status: CopilotConversationStatus.failed },
    });
    expect(attempt).toMatchObject({
      status: CopilotQuotaChargeStatus.refunded,
      refundReason: 'failed',
      clientToolExpiresAt: null,
    });
    expect(quota.refundFor).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: OPERATION_KEY }),
    );
  });

  it('finalizes a successful persistent idempotency key before marking the outbox settled', async () => {
    attempt.status = CopilotQuotaChargeStatus.settle_pending;
    attempt.tier = 'basic';
    conversation = null;
    await expect(
      service.reconcileChargeAttempt(CHARGE_ATTEMPT_ID),
    ).resolves.toBe(true);
    expect(quota.finalizeIdempotencyFor).toHaveBeenCalledWith({
      userId: user.userId,
      dimension: 'chat',
      idempotencyKey: OPERATION_KEY,
    });
    expect(attempt.status).toBe(CopilotQuotaChargeStatus.settled);
  });

  it('settles a durable successful charge when its already-bounded Redis key has expired', async () => {
    attempt.status = CopilotQuotaChargeStatus.settle_pending;
    attempt.tier = 'basic';
    conversation = null;
    quota.finalizeIdempotencyFor.mockResolvedValue({
      ok: true,
      status: 'missing',
    });

    await expect(
      service.reconcileChargeAttempt(CHARGE_ATTEMPT_ID),
    ).resolves.toBe(true);
    expect(quota.refundFor).not.toHaveBeenCalled();
    expect(attempt.status).toBe(CopilotQuotaChargeStatus.settled);
  });

  it('rebuilds a terminal refund tombstone when post-ack TTL finalization must retry', async () => {
    attempt.status = CopilotQuotaChargeStatus.refund_pending;
    attempt.tier = 'basic';
    attempt.refundReason = 'failed';
    conversation = null;
    quota.finalizeIdempotencyFor.mockResolvedValueOnce({
      ok: true,
      status: 'failed',
    });

    await expect(
      service.reconcileChargeAttempt(CHARGE_ATTEMPT_ID),
    ).rejects.toThrow('idempotency finalization');
    expect(attempt).toMatchObject({
      status: CopilotQuotaChargeStatus.refunded,
      redisFinalizedAt: null,
    });

    quota.finalizeIdempotencyFor.mockResolvedValue({
      ok: true,
      status: 'ok',
    });
    await expect(
      service.reconcileChargeAttempt(CHARGE_ATTEMPT_ID),
    ).resolves.toBe(true);
    expect(quota.refundFor).toHaveBeenCalledTimes(2);
    expect(attempt.redisFinalizedAt).toBeInstanceOf(Date);
  });

  it('fails closed when Redis cannot decide the paid admission', async () => {
    quota.consume.mockRejectedValue(new Error('redis unavailable'));
    await expect(service.consumeTurn(input)).rejects.toMatchObject({
      status: 503,
    });
    expect(attempt.status).toBe(CopilotQuotaChargeStatus.consume_pending);
  });
});

function transactionMock(
  getAttempt: () => AttemptMock,
  getConversation: () => ConversationMock | null,
) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ now: new Date() }]),
    copilotQuotaChargeAttempt: {
      findUnique: jest
        .fn()
        .mockImplementation(() => Promise.resolve(getAttempt())),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ data }: AttemptMutation) => {
        Object.assign(getAttempt(), data);
        return Promise.resolve(getAttempt());
      }),
      updateMany: jest
        .fn()
        .mockImplementation(({ where, data }: AttemptMutation) => {
          const attempt = getAttempt();
          const matches =
            (!where.status || where.status === attempt.status) &&
            (!where.ownerTurnId || where.ownerTurnId === attempt.ownerTurnId);
          if (matches) Object.assign(attempt, data);
          return Promise.resolve({ count: matches ? 1 : 0 });
        }),
    },
    copilotConversation: {
      findFirst: jest
        .fn()
        .mockImplementation(() => Promise.resolve(getConversation())),
      update: jest.fn().mockResolvedValue({}),
    },
    copilotUserStreamState: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

interface AttemptMutation {
  where: {
    status?: CopilotQuotaChargeStatus;
    ownerTurnId?: string;
  };
  data: Partial<AttemptMock>;
}
