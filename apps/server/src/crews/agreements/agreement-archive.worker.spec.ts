import {
  CrewAgreementArchiveJobStatus,
  CrewAgreementStatus,
  MediaStorageProvider,
} from '@prisma/client';
import { CrewAgreementArchiveWorker } from './agreement-archive.worker';
import { hostname } from 'node:os';

jest.mock('../../infra/storage/storage-provider-registry.service', () => ({
  StorageProviderRegistry: class {},
}));

const AGREEMENT_ID = '01910d50-4c88-7c78-92d4-16892c06a001';
const LOCKED_AT = new Date('2026-07-29T12:00:00.000Z');

function archiveJob(overrides: Record<string, unknown> = {}) {
  return {
    id: '01910d50-4c88-7c78-92d4-16892c06a002',
    agreementId: AGREEMENT_ID,
    status: CrewAgreementArchiveJobStatus.processing,
    attempt: 0,
    nextAttemptAt: null,
    lockedAt: LOCKED_AT,
    lockedBy: `${process.env.HOSTNAME ?? 'host'}-${process.pid}`,
    lastError: null,
    completedAt: null,
    createdAt: new Date('2026-07-29T11:00:00.000Z'),
    updatedAt: LOCKED_AT,
    agreement: {
      id: AGREEMENT_ID,
      crewId: 'crew-1',
      memberUserId: 'member-1',
      signerName: 'Mina Chen',
      signerEmail: 'mina@example.com',
      title: 'Storyboard delivery agreement',
      provider: 'boldsign',
      providerDocumentId: 'document-1',
      providerStatus: 'Completed',
      status: CrewAgreementStatus.signed,
      assetNodeId: null,
      auditAssetNodeId: null,
      createdByUserId: 'owner-1',
      sentAt: new Date('2026-07-29T10:00:00.000Z'),
      signedAt: new Date('2026-07-29T11:00:00.000Z'),
      lastSyncedAt: new Date('2026-07-29T11:00:00.000Z'),
      lastProviderEventId: 'event-1',
      lastProviderEventAt: new Date('2026-07-29T11:00:00.000Z'),
      voidedAt: null,
      createdAt: new Date('2026-07-29T09:00:00.000Z'),
      updatedAt: new Date('2026-07-29T11:00:00.000Z'),
    },
    ...overrides,
  };
}

function build() {
  const prisma = {
    crewAgreementArchiveJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const provider = {
    downloadSignedDocument: jest.fn().mockResolvedValue({
      bytes: Buffer.from('%PDF-1.7 signed'),
      contentType: 'application/pdf',
      filename: 'signed.pdf',
    }),
    downloadAuditTrail: jest.fn().mockResolvedValue({
      bytes: Buffer.from('%PDF-1.7 audit'),
      contentType: 'application/pdf',
      filename: 'audit.pdf',
    }),
  };
  const storage = {
    upload: jest.fn(),
    createPrivateUploadUrl: jest
      .fn()
      .mockImplementation(({ storageKey }: { storageKey: string }) =>
        Promise.resolve({
          url: 'https://private.invalid/upload',
          method: 'PUT',
          headers: { 'x-private-write': 'fixture' },
          storageKey,
          provider: MediaStorageProvider.s3_compatible,
          bucket: 'private-contracts',
          region: 'auto',
        }),
      ),
    headStoredObject: jest
      .fn()
      .mockResolvedValueOnce({
        exists: true,
        sizeBytes: 15,
        contentType: 'application/pdf',
      })
      .mockResolvedValueOnce({
        exists: true,
        sizeBytes: 14,
        contentType: 'application/pdf',
      }),
  };
  const storageRegistry = {
    forProvider: jest.fn().mockReturnValue(storage),
  };
  const worker = new CrewAgreementArchiveWorker(
    prisma as never,
    provider as never,
    storageRegistry as never,
  );
  return { prisma, provider, storage, storageRegistry, worker };
}

describe('CrewAgreementArchiveWorker', () => {
  beforeEach(() => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it.each(['claim', 'archive'] as const)(
    'finishes active work but stops new claims during shutdown at %s',
    async (stage) => {
      const { worker } = build();
      const internals = worker as unknown as {
        claim(batch: number): Promise<unknown[]>;
        archiveOne(job: unknown): Promise<void>;
      };
      let release!: () => void;
      let entered!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pause = async () => {
        entered();
        await waiting;
      };
      const claim = jest
        .spyOn(internals, 'claim')
        .mockImplementation(async () => {
          if (stage === 'claim') await pause();
          return [archiveJob()];
        });
      const archive = jest
        .spyOn(internals, 'archiveOne')
        .mockImplementation(async () => {
          if (stage === 'archive') await pause();
        });
      const drain = worker.drainOnce();
      await started;
      let stopped = false;
      const shutdown = Promise.resolve(worker.onModuleDestroy()).then(() => {
        stopped = true;
      });
      await Promise.resolve();
      const endedEarly = stopped;
      release();
      await Promise.all([drain, shutdown]);
      expect(endedEarly).toBe(false);
      expect(claim).toHaveBeenCalledTimes(1);
      expect(archive).toHaveBeenCalledTimes(stage === 'archive' ? 1 : 0);
      await worker.drainOnce();
      worker.onApplicationBootstrap();
      expect(claim).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, true])(
    'commits publication only with the original lease (displaced=%s)',
    async (displaced) => {
      const job = archiveJob({ lockedBy: `${hostname()}-${process.pid}` });
      const acknowledge = jest
        .fn()
        .mockResolvedValue({ count: displaced ? 0 : 1 });
      const tx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        crewAgreementArchiveJob: {
          findUnique: jest.fn().mockResolvedValue(job),
          update: jest.fn().mockResolvedValue({}),
          updateMany: acknowledge,
        },
        crewAgreement: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            ...job.agreement,
            assetNodeId: 'signed',
            auditAssetNodeId: 'audit',
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        crewAssetNode: { findMany: jest.fn().mockResolvedValue([]) },
      };
      let committed = false;
      const worker = new CrewAgreementArchiveWorker(
        {
          $transaction: async (
            callback: (value: typeof tx) => Promise<void>,
          ) => {
            await callback(tx);
            committed = true;
          },
        } as never,
        {} as never,
        {} as never,
      ) as unknown as {
        persistArchive(
          value: unknown,
          signed: unknown,
          audit: unknown,
        ): Promise<void>;
      };
      const result = worker.persistArchive(job, {}, {});
      if (displaced) await expect(result).rejects.toThrow('archive lease lost');
      else await expect(result).resolves.toBeUndefined();
      expect(committed).toBe(!displaced);
      expect(acknowledge).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: job.id,
            status: CrewAgreementArchiveJobStatus.processing,
            lockedAt: LOCKED_AT,
            lockedBy: job.lockedBy,
          },
        }),
      );
    },
  );

  it('claims only ready-to-archive work and retains the sweep limit', async () => {
    const { worker } = build();
    const internals = worker as unknown as {
      batchSize: number;
      claim(limit: number): Promise<unknown[]>;
      archiveOne(value: unknown): Promise<void>;
    };
    internals.batchSize = 2;
    const queue = [archiveJob(), archiveJob(), archiveJob()];
    const claim = jest
      .spyOn(internals, 'claim')
      .mockImplementation((limit) => Promise.resolve(queue.splice(0, limit)));
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = jest
      .spyOn(internals, 'archiveOne')
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

  it('downloads both immutable provider artifacts and stores deterministic objects', async () => {
    const t = build();
    const persistArchive = jest.fn().mockResolvedValue(undefined);
    const internals = t.worker as unknown as {
      archiveOne(job: ReturnType<typeof archiveJob>): Promise<void>;
      persistArchive: typeof persistArchive;
    };
    internals.persistArchive = persistArchive;
    const job = archiveJob();

    await internals.archiveOne(job);

    expect(t.storage.upload).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      'https://private.invalid/upload',
      expect.objectContaining({
        method: 'PUT',
        redirect: 'error',
        headers: {
          'x-private-write': 'fixture',
          'content-type': 'application/pdf',
        },
      }),
    );
    expect(t.provider.downloadSignedDocument).toHaveBeenCalledWith(
      'document-1',
    );
    expect(t.provider.downloadAuditTrail).toHaveBeenCalledWith('document-1');
    expect(t.storage.createPrivateUploadUrl).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        storageKey: `crew-agreements/crew-1/${AGREEMENT_ID}/signed.pdf`,
        contentType: 'application/pdf',
      }),
    );
    expect(t.storage.createPrivateUploadUrl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        storageKey: `crew-agreements/crew-1/${AGREEMENT_ID}/audit-trail.pdf`,
        contentType: 'application/pdf',
      }),
    );
    expect(persistArchive).toHaveBeenCalledWith(
      job,
      expect.objectContaining({
        kind: 'signed_document',
        result: expect.objectContaining({
          bucket: 'private-contracts',
          url: '',
        }) as unknown,
      }),
      expect.objectContaining({ kind: 'audit_trail' }),
    );
  });

  it.each([
    'private-unavailable',
    'wrong-key',
    'upload-failed',
    'missing',
    'size',
    'type',
  ])(
    'does not publish an archive when private storage fails: %s',
    async (failure) => {
      const t = build();
      if (failure === 'private-unavailable')
        t.storage.createPrivateUploadUrl.mockRejectedValueOnce(
          new Error('Private storage unavailable'),
        );
      if (failure === 'wrong-key')
        t.storage.createPrivateUploadUrl.mockResolvedValueOnce({
          storageKey: 'other',
          bucket: 'private-contracts',
        });
      if (failure === 'upload-failed')
        jest
          .mocked(fetch)
          .mockResolvedValueOnce(new Response(null, { status: 503 }));
      if (['missing', 'size', 'type'].includes(failure)) {
        t.storage.headStoredObject.mockReset().mockResolvedValue({
          exists: failure !== 'missing',
          sizeBytes: failure === 'size' ? 1 : 15,
          contentType: failure === 'type' ? 'text/html' : 'application/pdf',
        });
      }
      const internals = t.worker as unknown as {
        archiveOne(job: ReturnType<typeof archiveJob>): Promise<void>;
        persistArchive: jest.Mock;
      };
      internals.persistArchive = jest.fn();
      await internals.archiveOne(archiveJob());
      expect(internals.persistArchive).not.toHaveBeenCalled();
      expect(t.storage.upload).not.toHaveBeenCalled();
      expect(t.prisma.crewAgreementArchiveJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: CrewAgreementArchiveJobStatus.pending,
            attempt: 1,
          }) as unknown,
        }),
      );
    },
  );

  it('releases the lease and schedules bounded retry after provider failure', async () => {
    const t = build();
    t.provider.downloadSignedDocument.mockRejectedValueOnce(
      new Error('BoldSign temporarily unavailable'),
    );
    const internals = t.worker as unknown as {
      archiveOne(job: ReturnType<typeof archiveJob>): Promise<void>;
    };

    await internals.archiveOne(archiveJob());

    expect(t.prisma.crewAgreementArchiveJob.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: CrewAgreementArchiveJobStatus.processing,
        lockedAt: LOCKED_AT,
      }) as unknown,
      data: expect.objectContaining({
        status: CrewAgreementArchiveJobStatus.pending,
        attempt: 1,
        lockedAt: null,
        lockedBy: null,
        lastError: 'BoldSign temporarily unavailable',
        nextAttemptAt: expect.any(Date) as unknown,
      }) as unknown,
    });
    expect(t.storage.upload).not.toHaveBeenCalled();
  });
});
