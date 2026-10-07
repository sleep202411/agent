import { LegacyCreatorsService } from '../legacy-creators/legacy-creators.service';
import {
  AcademyLearningService,
  teacherShare,
} from './academy-learning.service';
import { PrismaService } from '../infra/db/db.module';
import { AcademyAuthorityService } from './academy-authority.service';
import { AcademyMappingsService } from './academy-mappings.service';
import { WalletLedgerService } from '../workspaces/wallet-ledger.service';
import { MediaStorageAccessService } from '../infra/storage/media-storage-access.service';
function fixture() {
  const row = {
    id: 'enrollment',
    courseId: '14',
    studentId: '100',
    teacherId: '200',
    certificateId: 13,
    priceCredits: 100n,
    teacherCredits: 50n,
    offeringVersion: 1,
    status: 'submitted',
    version: 2,
    description: 'Work',
    assetIds: ['asset'],
    score: null,
    feedback: null,
    reviewedAt: null,
    badgeIssuedAt: null,
    badgeError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const enrollment = {
    findUnique: jest.fn().mockResolvedValue(row),
    findUniqueOrThrow: jest.fn().mockResolvedValue(row),
    findMany: jest.fn().mockResolvedValue([row]),
    create: jest
      .fn<object, [{ data: object }]>()
      .mockImplementation(({ data }: { data: object }) => ({
        ...row,
        ...data,
        status: 'enrolled',
        version: 1,
      })),
    update: jest
      .fn()
      .mockImplementation(
        ({ data }: { data: { version?: { increment: number } } }) => ({
          ...row,
          ...data,
          version: row.version + (data.version?.increment ?? 0),
        }),
      ),
    updateMany: jest.fn(),
  };
  const db = {
    academyEnrollment: enrollment,
    academyOffering: {
      findUnique: jest.fn().mockResolvedValue({
        teacherId: '200',
        priceCredits: 100n,
        teacherShareBps: 5000,
        enabled: true,
        version: 1,
      }),
    },
    academyEnrollmentEvent: { create: jest.fn() },
    walletAccount: {
      createMany: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'wallet' }),
    },
    walletCreditGrant: { findMany: jest.fn().mockResolvedValue([]) },
    mediaAssetUsage: { createMany: jest.fn() },
    mediaAsset: {
      findMany: jest.fn().mockResolvedValue([{ id: 'asset' }]),
      findFirst: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) =>
    fn(db),
  );
  const authority = {
    course: jest.fn().mockResolvedValue({
      id: 14,
      published: true,
      instructors: [{ userId: 200 }],
    }),
    grantSkill: jest.fn().mockResolvedValue(undefined),
  };
  const mappings = {
    published: jest.fn().mockResolvedValue({ certificate: { id: 13 } }),
  };
  const wallet = { postEntryTx: jest.fn() };
  const storage = { createReadUrl: jest.fn() };
  const service = new AcademyLearningService(
    db as unknown as PrismaService,
    authority as unknown as AcademyAuthorityService,
    mappings as unknown as AcademyMappingsService,
    wallet as unknown as WalletLedgerService,
    storage as unknown as MediaStorageAccessService,
    {
      publicCreatorBatch: jest.fn().mockResolvedValue([]),
    } as unknown as LegacyCreatorsService,
  );
  return { service, db, authority, wallet, row, enrollment, storage };
}
const review = {
  expectedVersion: 2,
  decision: 'approved' as const,
  score: 88,
  feedback: 'Approved',
};
it('uses integer earned-credit shares, never a fiat conversion', () =>
  expect(teacherShare(101n, 5000)).toBe(50n));
it('retries a purchased enrollment without another debit', async () => {
  const f = fixture();
  await f.service.enroll('14', '100', 1);
  expect(f.wallet.postEntryTx).not.toHaveBeenCalled();
});
it('snapshots terms and atomically debits the student wallet', async () => {
  const f = fixture();
  f.enrollment.findUnique.mockResolvedValue(null);
  await f.service.enroll('14', '100', 1);
  expect(f.wallet.postEntryTx).toHaveBeenCalledWith(
    f.db,
    expect.objectContaining({
      amount: 100n,
      availableDelta: -100n,
      sourceType: 'academy_enrollment',
    }),
  );
  expect(f.enrollment.create.mock.calls[0][0].data).toMatchObject({
    certificateId: 13,
    teacherCredits: 50n,
  });
});
it('rejects changed prices before debiting', async () => {
  const f = fixture();
  f.enrollment.findUnique.mockResolvedValue(null);
  await expect(f.service.enroll('14', '100', 2)).rejects.toThrow(
    'terms changed',
  );
  expect(f.wallet.postEntryTx).not.toHaveBeenCalled();
});
it('blocks self-purchase and self-review', async () => {
  const f = fixture();
  f.enrollment.findUnique.mockResolvedValueOnce(null);
  await expect(f.service.enroll('14', '200', 1)).rejects.toThrow('own course');
  await expect(f.service.review('enrollment', '100', review)).rejects.toThrow(
    'not found',
  );
});
it('refuses a removed teacher before issuing income or badges', async () => {
  const f = fixture();
  f.authority.course.mockResolvedValue({
    id: 14,
    published: true,
    instructors: [],
  });
  await expect(f.service.review('enrollment', '200', review)).rejects.toThrow(
    'assigned course teacher',
  );
  expect(f.wallet.postEntryTx).not.toHaveBeenCalled();
});
it('rejects stale homework decisions', async () => {
  const f = fixture();
  await expect(
    f.service.review('enrollment', '200', { ...review, expectedVersion: 1 }),
  ).rejects.toThrow('already reviewed');
  expect(f.wallet.postEntryTx).not.toHaveBeenCalled();
});
it('uses the stable homework-income receipt key', async () => {
  const f = fixture();
  await f.service.review('enrollment', '200', review);
  expect(f.wallet.postEntryTx).toHaveBeenCalledWith(
    f.db,
    expect.objectContaining({
      sourceType: 'HOMEWORK_REVIEW_INCOME',
      idempotencyKey: 'academy:teacher-income:enrollment',
      availableDelta: 50n,
    }),
  );
});
it('does not pay or award badges for revision requests', async () => {
  const f = fixture();
  await f.service.review('enrollment', '200', {
    ...review,
    decision: 'revision',
  });
  expect(f.wallet.postEntryTx).not.toHaveBeenCalled();
  expect(f.authority.grantSkill).not.toHaveBeenCalled();
});
it('keeps badge delivery retryable after Java failure without another payment', async () => {
  const f = fixture();
  f.row.status = 'approved';
  f.authority.grantSkill.mockRejectedValue(new Error('Java down'));
  await f.service.issueBadge('enrollment');
  expect(f.enrollment.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'enrollment', badgeIssuedAt: null },
    }),
  );
  expect(f.wallet.postEntryTx).not.toHaveBeenCalled();
});
it('blocks attachment reads by unrelated accounts', async () => {
  const f = fixture();
  await expect(
    f.service.attachment('enrollment', 'asset', 'outsider'),
  ).rejects.toThrow('not found');
  expect(f.storage.createReadUrl).not.toHaveBeenCalled();
});
it('requires private uploads owned by the student', async () => {
  const f = fixture();
  f.row.status = 'enrolled';
  f.db.mediaAsset.findMany.mockResolvedValue([]);
  await expect(
    f.service.submit('enrollment', '100', {
      expectedVersion: 2,
      description: 'Work',
      assetIds: ['asset'],
    }),
  ).rejects.toThrow('private uploads');
  expect(f.enrollment.update).not.toHaveBeenCalled();
});
it('keeps configured playback gated when new sales are disabled', async () => {
  const f = fixture();
  f.db.academyOffering.findUnique.mockResolvedValue({ enabled: false });
  f.enrollment.findUnique.mockResolvedValue(null);
  await expect(f.service.playbackAccess('14', '100')).resolves.toEqual({
    allowed: false,
  });
});
it('preserves free playback for unconfigured catalogue entries', async () => {
  const f = fixture();
  f.db.academyOffering.findUnique.mockResolvedValue(null);
  await expect(f.service.playbackAccess('14', null)).resolves.toEqual({
    allowed: true,
  });
});

it('retains submitted homework attachments with versioned usage records', async () => {
  const f = fixture();
  f.row.status = 'enrolled';
  await f.service.submit('enrollment', '100', {
    expectedVersion: 2,
    description: 'Work',
    assetIds: ['asset'],
  });
  expect(f.db.mediaAssetUsage.createMany).toHaveBeenCalledWith({
    skipDuplicates: true,
    data: [
      expect.objectContaining({
        assetId: 'asset',
        userId: '100',
        sourceSurface: 'academy_homework',
        idempotencyKey: 'academy-homework:enrollment:3:asset',
        metadata: { enrollmentId: 'enrollment', version: 3 },
      }),
    ],
  });
});
