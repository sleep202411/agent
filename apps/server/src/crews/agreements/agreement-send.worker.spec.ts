import {
  CrewAgreementSendJobStatus,
  CrewAgreementStatus,
} from '@prisma/client';
import { CrewAgreementSendWorker } from './agreement-send.worker';

const AGREEMENT_ID = '01910d50-4c88-7c78-92d4-16892c06a001';
const JOB_ID = '01910d50-4c88-7c78-92d4-16892c06a002';
const LOCKED_AT = new Date('2026-07-30T10:00:00.000Z');

function agreement(overrides: Record<string, unknown> = {}) {
  return {
    id: AGREEMENT_ID,
    crewId: 'crew-1',
    invitationId: null,
    memberUserId: 'member-1',
    signerName: 'Mina Chen',
    signerEmail: 'mina@example.com',
    title: 'Storyboard agreement',
    provider: 'boldsign',
    providerDocumentId: null,
    providerStatus: null,
    status: CrewAgreementStatus.draft,
    assetNodeId: null,
    auditAssetNodeId: null,
    createdByUserId: 'owner-1',
    sentAt: null,
    signedAt: null,
    lastSyncedAt: null,
    lastProviderEventId: null,
    lastProviderEventAt: null,
    voidedAt: null,
    createdAt: new Date('2026-07-30T09:00:00.000Z'),
    updatedAt: new Date('2026-07-30T09:00:00.000Z'),
    ...overrides,
  };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    agreementId: AGREEMENT_ID,
    status: CrewAgreementSendJobStatus.processing,
    attempt: 0,
    nextAttemptAt: null,
    lockedAt: LOCKED_AT,
    lockedBy: 'test-worker',
    lastError: null,
    completedAt: null,
    createdAt: new Date('2026-07-30T09:00:00.000Z'),
    updatedAt: new Date('2026-07-30T09:00:00.000Z'),
    agreement: agreement(),
    ...overrides,
  };
}

function build(overrides: Record<string, unknown> = {}) {
  const claimed = job(overrides);
  const prisma = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue([])
      .mockResolvedValueOnce([{ id: JOB_ID }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    crewAgreementSendJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([claimed]),
    },
    crewAgreement: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(claimed.agreement),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(agreement(data)),
        ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    crewAgreementArchiveJob: {
      upsert: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );
  const provider = {
    findDocumentForAgreement: jest.fn().mockResolvedValue(null),
    sendFromTemplate: jest.fn().mockResolvedValue('document-1'),
  };
  const notifications = { send: jest.fn().mockResolvedValue({}) };
  return {
    prisma,
    provider,
    notifications,
    worker: new CrewAgreementSendWorker(
      prisma as never,
      provider as never,
      notifications as never,
    ),
  };
}

describe('CrewAgreementSendWorker', () => {
  it('claims only ready-to-send work and retains the sweep limit', async () => {
    const { worker } = build();
    const internals = worker as unknown as {
      batchSize: number;
      claim(limit: number): Promise<unknown[]>;
      dispatchOne(value: unknown): Promise<void>;
    };
    internals.batchSize = 2;
    const queue = [job(), job(), job()];
    const claim = jest
      .spyOn(internals, 'claim')
      .mockImplementation((limit) => Promise.resolve(queue.splice(0, limit)));
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = jest
      .spyOn(internals, 'dispatchOne')
      .mockResolvedValue()
      .mockReturnValueOnce(pending);
    const first = worker.drainOnce();
    const overlap = worker.drainOnce();
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(claim).toHaveBeenCalledTimes(1);
      expect(claim).toHaveBeenCalledWith(1);
      expect(queue).toHaveLength(2);
    } finally {
      release();
      await Promise.all([first, overlap]);
    }
    expect(send).toHaveBeenCalledTimes(2);
    expect(queue).toHaveLength(1);
    await worker.drainOnce();
    expect(send).toHaveBeenCalledTimes(3);
    expect(queue).toHaveLength(0);
  });

  it('dispatches outside the request transaction and waits for the Sent webhook', async () => {
    const t = build();

    await t.worker.drainOnce();

    expect(t.provider.findDocumentForAgreement).toHaveBeenCalledWith(
      AGREEMENT_ID,
    );
    expect(t.provider.sendFromTemplate).toHaveBeenCalledWith({
      agreementId: AGREEMENT_ID,
      title: 'Storyboard agreement',
      signerName: 'Mina Chen',
      signerEmail: 'mina@example.com',
    });
    expect(t.prisma.crewAgreement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: AGREEMENT_ID },
        data: expect.objectContaining({
          providerDocumentId: 'document-1',
          providerStatus: 'Processing',
          status: CrewAgreementStatus.sending,
        }) as unknown,
      }),
    );
    expect(t.notifications.send).not.toHaveBeenCalled();
  });

  it('reconciles a provider-accepted request instead of creating a duplicate', async () => {
    const t = build();
    t.provider.findDocumentForAgreement.mockResolvedValue({
      documentId: 'document-1',
      status: 'WaitingForOthers',
    });

    await t.worker.drainOnce();

    expect(t.provider.sendFromTemplate).not.toHaveBeenCalled();
    expect(t.prisma.crewAgreement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerDocumentId: 'document-1',
          status: CrewAgreementStatus.sent,
        }) as unknown,
      }),
    );
    expect(t.notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'member-1',
        type: 'crew.agreement.sent',
        idempotencyKey: `crew.agreement.sent:${AGREEMENT_ID}`,
      }),
      t.prisma,
    );
  });

  it('never regresses a verified webhook that wins the send-response race', async () => {
    const t = build();
    t.prisma.crewAgreement.findUniqueOrThrow.mockResolvedValue(
      agreement({
        providerDocumentId: 'document-1',
        providerStatus: 'Completed',
        status: CrewAgreementStatus.signed,
        signedAt: new Date('2026-07-30T10:01:00.000Z'),
      }),
    );

    await t.worker.drainOnce();

    expect(t.prisma.crewAgreement.update).not.toHaveBeenCalled();
    expect(t.prisma.crewAgreementSendJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CrewAgreementSendJobStatus.completed,
        }) as unknown,
      }),
    );
  });

  it('surfaces a terminal dispatch failure for an explicit owner retry', async () => {
    const t = build({ attempt: 9 });
    t.provider.findDocumentForAgreement.mockRejectedValue(
      new Error('BoldSign unavailable'),
    );

    await t.worker.drainOnce();

    expect(t.prisma.crewAgreementSendJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CrewAgreementSendJobStatus.failed,
          attempt: 10,
          lastError: 'BoldSign unavailable',
        }) as unknown,
      }),
    );
    expect(t.prisma.crewAgreement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: AGREEMENT_ID,
          providerDocumentId: null,
        }) as unknown,
        data: expect.objectContaining({
          status: CrewAgreementStatus.failed,
          providerStatus: 'DispatchFailed',
        }) as unknown,
      }),
    );
  });
});
