import {
  CrewAgreementArchiveJobStatus,
  CrewAgreementStatus,
  MediaStorageProvider,
} from '@prisma/client';
import { CrewAgreementArchiveWorker } from './agreement-archive.worker';

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
    upload: jest
      .fn()
      .mockResolvedValueOnce({
        url: 'private://signed',
        storagePath: 'crew-agreements/crew-1/signed.pdf',
        bytes: 15,
        provider: MediaStorageProvider.s3_compatible,
        bucket: 'crew-assets',
        region: 'auto',
      })
      .mockResolvedValueOnce({
        url: 'private://audit',
        storagePath: 'crew-agreements/crew-1/audit.pdf',
        bytes: 14,
        provider: MediaStorageProvider.s3_compatible,
        bucket: 'crew-assets',
        region: 'auto',
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

    expect(t.provider.downloadSignedDocument).toHaveBeenCalledWith(
      'document-1',
    );
    expect(t.provider.downloadAuditTrail).toHaveBeenCalledWith('document-1');
    expect(t.storage.upload).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        key: `crew-agreements/crew-1/${AGREEMENT_ID}/signed.pdf`,
        contentType: 'application/pdf',
      }),
    );
    expect(t.storage.upload).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        key: `crew-agreements/crew-1/${AGREEMENT_ID}/audit-trail.pdf`,
        contentType: 'application/pdf',
      }),
    );
    expect(persistArchive).toHaveBeenCalledWith(
      job,
      expect.objectContaining({ kind: 'signed_document' }),
      expect.objectContaining({ kind: 'audit_trail' }),
    );
  });

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
      }),
      data: expect.objectContaining({
        status: CrewAgreementArchiveJobStatus.pending,
        attempt: 1,
        lockedAt: null,
        lockedBy: null,
        lastError: 'BoldSign temporarily unavailable',
        nextAttemptAt: expect.any(Date),
      }),
    });
    expect(t.storage.upload).not.toHaveBeenCalled();
  });
});
