import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LegacyCreatorsService } from '../legacy-creators/legacy-creators.service';
import {
  AcademyLearningService,
  academyMonthBounds,
  commerceFromJava,
  javaCommerceLive,
  javaOfferingVersion,
  teacherShare,
  teacherShareBpsFor,
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
    instructorShares: [] as Array<{ teacherId: string; credits: string }>,
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
    count: jest.fn().mockResolvedValue(2),
    groupBy: jest.fn().mockImplementation(
      ({
        by,
        where,
      }: {
        by?: string[];
        where?: {
          createdAt?: { gte?: Date; lt?: Date };
          AND?: Array<{ createdAt?: { gte?: Date; lt?: Date } }>;
        };
      }) => {
        if (by?.[0] === 'courseId') return [{ courseId: '14' }];
        const createdAt =
          where?.createdAt ??
          where?.AND?.find((part) => part.createdAt)?.createdAt;
        if (createdAt?.lt) return [];
        if (createdAt?.gte) return [{ studentId: '100' }];
        return [{ studentId: '100' }, { studentId: '101' }];
      },
    ),
    aggregate: jest.fn().mockResolvedValue({ _sum: { teacherCredits: 50n } }),
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
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([]),
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
it('anchors Academy workbench months on UTC+8', () => {
  const bounds = academyMonthBounds(new Date('2026-10-01T00:30:00.000Z'));
  expect(bounds.start.toISOString()).toBe('2026-09-30T16:00:00.000Z');
  expect(bounds.previous.toISOString()).toBe('2026-08-31T16:00:00.000Z');
});
it('ignores omitted Java commerce so Nest offerings still gate existing paid courses', () => {
  expect(
    commerceFromJava({
      id: 14,
      published: true,
      certificateId: null,
      instructors: [{ userId: 200 }],
    }),
  ).toBeNull();
});
it('reads Java sale terms when the course payload includes them', () => {
  const commerce = commerceFromJava({
    id: 14,
    published: true,
    certificateId: 13,
    enrollmentEnabled: true,
    priceCredits: 100,
    instructors: [{ userId: 200, shareBps: 5000 }],
  });
  expect(commerce).toMatchObject({
    enabled: true,
    teacherId: '200',
    teacherShareBps: 5000,
  });
  expect(commerce?.priceCredits).toBe(100n);
  expect(javaCommerceLive(commerce!)).toBe(true);
});
it('treats Java 0/false as an explicit free course once those columns exist', () => {
  const commerce = commerceFromJava({
    id: 14,
    published: true,
    certificateId: null,
    enrollmentEnabled: false,
    priceCredits: 0,
    instructorShares: [],
  });
  expect(commerce).not.toBeNull();
  expect(javaCommerceLive(commerce!)).toBe(false);
});
it('prefers Java sale terms over a leftover Nest offering', async () => {
  const f = fixture();
  f.enrollment.findUnique.mockResolvedValue(null);
  f.authority.course.mockResolvedValue({
    id: 14,
    published: true,
    enrollmentEnabled: true,
    priceCredits: 40,
    instructors: [{ userId: 200, shareBps: 5000 }],
  });
  const quote = await f.service.offering('14');
  await f.service.enroll('14', '100', quote.offering!.version);
  expect(f.wallet.postEntryTx).toHaveBeenCalledWith(
    f.db,
    expect.objectContaining({
      amount: 40n,
      availableDelta: -40n,
      sourceType: 'academy_enrollment',
    }),
  );
});
it('scopes admin homework to the bound Web lecturer id', async () => {
  const f = fixture();
  f.db.academyEnrollment.findMany.mockResolvedValue([
    {
      ...f.row,
      id: '11111111-1111-1111-1111-111111111111',
      teacherId: '200',
      studentId: '100',
      status: 'submitted',
    },
  ]);
  f.authority.course.mockResolvedValue({
    id: 14,
    published: true,
    certificateId: 13,
    instructors: [{ userId: 200 }],
    localized: { 'en-US': { title: 'Course' } },
  });
  const page = await f.service.adminHomework(
    {
      id: 'admin',
      email: 't@example.com',
      displayName: 'Teacher',
      status: 'active',
      siteScope: 'global',
      platformUserId: '200',
      sessionId: 's',
      roleKeys: [],
      requireMfa: false,
      permissions: ['courses.read'],
    },
    undefined,
    'submitted',
  );
  expect(f.db.academyEnrollment.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { teacherId: '200' },
          { instructorShares: { array_contains: [{ teacherId: '200' }] } },
        ],
        status: 'submitted',
      }) as Prisma.AcademyEnrollmentWhereInput,
    }),
  );
  expect(page.scope).toBe('lecturer');
  expect(page.platformUserId).toBe('200');
  expect(page.items).toHaveLength(1);
  expect(page.items[0]).toMatchObject({
    studentName: '100',
    studentAvatar: null,
    submittedAt: f.row.updatedAt.toISOString(),
  });
});
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
it('rejects misconfigured instructor shares before debiting', async () => {
  const f = fixture();
  f.enrollment.findUnique.mockResolvedValue(null);
  f.db.academyOffering.findUnique.mockResolvedValue({
    teacherId: '200',
    priceCredits: 100n,
    teacherShareBps: 6000,
    instructorShares: [
      { teacherId: '200', shareBps: 6000 },
      { teacherId: '201', shareBps: 6000 },
    ],
    enabled: true,
    version: 1,
  });
  f.authority.course.mockResolvedValue({
    id: 14,
    published: true,
    instructors: [{ userId: 200 }, { userId: 201 }],
  });
  await expect(f.service.enroll('14', '100', 1)).rejects.toThrow(
    'instructor shares are misconfigured',
  );
  expect(f.wallet.postEntryTx).not.toHaveBeenCalled();
});
it('rejects incomplete teacher assignment before debiting', async () => {
  const f = fixture();
  f.enrollment.findUnique.mockResolvedValue(null);
  f.authority.course.mockResolvedValue({
    id: 14,
    published: true,
    enrollmentEnabled: true,
    priceCredits: 500,
    instructors: [],
  });
  const quote = await f.service.offering('14');
  await expect(
    f.service.enroll('14', '100', quote.offering!.version),
  ).rejects.toThrow('teacher assignment is incomplete');
  expect(f.wallet.postEntryTx).not.toHaveBeenCalled();
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
it('lets every current course instructor review submitted homework', async () => {
  const f = fixture();
  f.row.instructorShares = [
    { teacherId: '200', credits: '40' },
    { teacherId: '201', credits: '10' },
  ];
  f.authority.course.mockResolvedValue({
    id: 14,
    published: true,
    instructors: [{ userId: 200 }, { userId: 201 }],
  });
  await f.service.review('enrollment', '201', review);
  expect(f.enrollment.update).toHaveBeenCalled();
});
it('pays every instructor share from the enrollment snapshot', async () => {
  const f = fixture();
  f.row.instructorShares = [
    { teacherId: '200', credits: '40' },
    { teacherId: '201', credits: '10' },
  ];
  f.authority.course.mockResolvedValue({
    id: 14,
    published: true,
    instructors: [{ userId: 200 }, { userId: 201 }],
  });
  await f.service.review('enrollment', '200', review);
  expect(f.wallet.postEntryTx).toHaveBeenCalledTimes(2);
  expect(f.wallet.postEntryTx).toHaveBeenNthCalledWith(
    1,
    f.db,
    expect.objectContaining({
      amount: 40n,
      idempotencyKey: 'academy:teacher-income:enrollment:200',
    }),
  );
  expect(f.wallet.postEntryTx).toHaveBeenNthCalledWith(
    2,
    f.db,
    expect.objectContaining({
      amount: 10n,
      idempotencyKey: 'academy:teacher-income:enrollment:201',
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
it('lets a current instructor watch without buying the course', async () => {
  const f = fixture();
  f.db.academyOffering.findUnique.mockResolvedValue({ enabled: true });
  f.enrollment.findUnique.mockResolvedValue(null);
  await expect(f.service.playbackAccess('14', '200')).resolves.toEqual({
    allowed: true,
  });
  expect(f.enrollment.findUnique).not.toHaveBeenCalled();
});
it('lets an offering teacher watch even when Java instructors omitted them', async () => {
  const f = fixture();
  f.authority.course.mockResolvedValue({
    id: 14,
    published: true,
    instructors: [],
  });
  f.db.academyOffering.findUnique.mockResolvedValue({
    enabled: true,
    teacherId: '201',
    teacherShareBps: 5000,
    priceCredits: 200n,
    instructorShares: [{ teacherId: '201', shareBps: 5000 }],
  });
  f.enrollment.findUnique.mockResolvedValue(null);
  await expect(f.service.playbackAccess('14', '201')).resolves.toEqual({
    allowed: true,
  });
  await expect(f.service.offering('14', '201')).resolves.toMatchObject({
    instructor: true,
  });
});
it('marks the signed-in Java instructor on the course offering', async () => {
  const f = fixture();
  f.db.academyOffering.findUnique.mockResolvedValue({
    enabled: true,
    teacherId: '200',
    teacherShareBps: 5000,
    priceCredits: 200n,
    instructorShares: [],
  });
  f.enrollment.findUnique.mockResolvedValue(null);
  await expect(f.service.offering('14', '200')).resolves.toMatchObject({
    instructor: true,
    enrollment: null,
  });
  await expect(f.service.offering('14', '100')).resolves.toMatchObject({
    instructor: false,
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

it('reports the recipient share rather than the combined teacher pool', async () => {
  const f = fixture();
  f.db.$queryRaw.mockResolvedValue([{ earned: 10n }]);
  expect(await f.service.teachingSummary('201')).toEqual({
    courses: 1,
    students: 2,
    pending: 2,
    monthlyNewStudents: 1,
    previousMonthNewStudents: 0,
    earnedCredits: '10',
  });
  expect(f.db.academyOffering.findMany).toHaveBeenCalledWith({
    where: {
      OR: [
        { teacherId: '201' },
        { instructorShares: { array_contains: [{ teacherId: '201' }] } },
      ],
    },
    select: { courseId: true },
  });
  expect(f.enrollment.groupBy).toHaveBeenCalledWith(
    expect.objectContaining({ by: ['courseId'] }),
  );
  expect(f.enrollment.count).toHaveBeenCalledWith({
    where: {
      AND: [
        {
          OR: [
            { teacherId: '201' },
            { instructorShares: { array_contains: [{ teacherId: '201' }] } },
          ],
        },
        { status: 'submitted' },
      ],
    },
  });
});

it('counts taught courses from enrollments when Nest offerings are empty', async () => {
  const f = fixture();
  f.db.$queryRaw.mockResolvedValue([{ earned: 0n }]);
  f.db.academyOffering.findMany.mockResolvedValue([]);
  expect((await f.service.teachingSummary('200')).courses).toBe(1);
});

it('keeps the operator total across all instructors', async () => {
  const f = fixture();
  expect(
    await f.service.adminIncomeSummary({ platformUserId: null } as never),
  ).toMatchObject({ earnedCredits: '50', scope: 'operator' });
});

it('prefers the lecturer share on a taught course list', () => {
  expect(
    teacherShareBpsFor('201', {
      javaShares: [
        { teacherId: '200', shareBps: 6000 },
        { teacherId: '201', shareBps: 4000 },
      ],
    }),
  ).toBe(4000);
});

it('lists taught courses with share, students and earned credits', async () => {
  const f = fixture();
  f.db.$queryRaw.mockResolvedValue([{ courseId: '14', earned: 100n }]);
  f.db.academyOffering.findMany.mockResolvedValue([
    {
      courseId: '14',
      teacherId: '200',
      teacherShareBps: 5000,
      instructorShares: [],
    },
  ]);
  f.authority.course.mockResolvedValue({
    id: 14,
    published: true,
    instructors: [{ userId: 200, shareBps: 5000 }],
    localized: { 'zh-CN': { title: '测试课' } },
  });
  expect(
    await f.service.adminTeachingCourses({ platformUserId: '200' } as never),
  ).toEqual({
    items: [
      {
        courseId: '14',
        courseTitle: '测试课',
        shareBps: 5000,
        students: 1,
        earnedCredits: '100',
      },
    ],
    scope: 'lecturer',
    platformUserId: '200',
  });
});

it('maps a concurrent enrollment uniqueness failure to an actionable conflict', async () => {
  const f = fixture();
  f.enrollment.findUnique.mockResolvedValue(null);
  f.enrollment.create.mockImplementation(() => {
    throw new Prisma.PrismaClientKnownRequestError('Duplicate enrollment', {
      code: 'P2002',
      clientVersion: Prisma.prismaVersion.client,
    });
  });
  await expect(f.service.enroll('14', '100', 1)).rejects.toThrow(
    'You are already enrolled in this course.',
  );
});
it('preserves an unexpected enrollment database error', async () => {
  const f = fixture();
  f.enrollment.findUnique.mockResolvedValue(null);
  const failure = new Error('Database connection interrupted');
  f.enrollment.create.mockImplementation(() => {
    throw failure;
  });
  await expect(f.service.enroll('14', '100', 1)).rejects.toBe(failure);
});

it.each([
  '10.5',
  '-10',
  '1e3',
  '10 points',
  '',
  '1000000000000',
  NaN,
  Infinity,
])('rejects malformed Java price %s before charging', (priceCredits) => {
  expect(() =>
    commerceFromJava({
      id: 14,
      published: true,
      certificateId: 13,
      enrollmentEnabled: true,
      priceCredits,
    }),
  ).toThrow('whole number');
});
it('fails closed when the Java authority is unavailable, even without a local offering', async () => {
  const f = fixture();
  const error = new Error('Java unavailable');
  f.authority.course.mockRejectedValue(error);
  f.db.academyOffering.findUnique.mockResolvedValue(null);
  await expect(f.service.playbackAccess('14', null)).rejects.toBe(error);
  expect(f.enrollment.findUnique).not.toHaveBeenCalled();
});
it('denies unpublished course playback and enrollment', async () => {
  const f = fixture();
  f.authority.course.mockResolvedValue({ id: 14, published: false });
  await expect(f.service.playbackAccess('14', '100')).resolves.toEqual({
    allowed: false,
  });
  await expect(f.service.enroll('14', '100', 1)).rejects.toThrow(
    'Course not found',
  );
  expect(f.wallet.postEntryTx).not.toHaveBeenCalled();
});
it('rejects changed Java sale terms before debit and accepts a refreshed quote', async () => {
  const f = fixture();
  f.enrollment.findUnique.mockResolvedValue(null);
  const course = {
    id: 14,
    published: true,
    enrollmentEnabled: true,
    priceCredits: 40,
    instructors: [{ userId: 200, shareBps: 5000 }],
  };
  f.authority.course.mockResolvedValue(course);
  const before = await f.service.offering('14');
  f.authority.course.mockResolvedValue({ ...course, priceCredits: 900 });
  await expect(
    f.service.enroll('14', '100', before.offering!.version),
  ).rejects.toThrow('terms changed');
  expect(f.enrollment.create).not.toHaveBeenCalled();
  expect(f.wallet.postEntryTx).not.toHaveBeenCalled();
  const refreshed = await f.service.offering('14');
  expect(Number.isSafeInteger(refreshed.offering!.version)).toBe(true);
  await f.service.enroll('14', '100', refreshed.offering!.version);
  expect(f.wallet.postEntryTx).toHaveBeenCalledWith(
    f.db,
    expect.objectContaining({ amount: 900n, availableDelta: -900n }),
  );
});
it('binds Java quotes to course identity, certificate and instructor shares', () => {
  const course = {
    id: 14,
    published: true,
    certificateId: 13,
    enrollmentEnabled: true,
    priceCredits: 40,
    instructors: [{ userId: 200, shareBps: 5000 }],
  };
  const version = javaOfferingVersion(course);
  for (const change of [
    { id: 15 },
    { certificateId: 14 },
    { enrollmentEnabled: false },
    { instructors: [{ userId: 200, shareBps: 6000 }] },
  ]) {
    expect(javaOfferingVersion({ ...course, ...change })).not.toBe(version);
  }
});
it('returns existing enrollment on response-loss retry without another debit', async () => {
  const f = fixture();
  f.authority.course.mockResolvedValue({
    id: 14,
    published: true,
    enrollmentEnabled: true,
    priceCredits: 900,
    instructors: [{ userId: 200, shareBps: 5000 }],
  });
  await expect(f.service.enroll('14', '100', 1)).resolves.toMatchObject({
    id: 'enrollment',
  });
  expect(f.wallet.postEntryTx).not.toHaveBeenCalled();
});

describe('enrollment history when catalogue records disappear', () => {
  function history() {
    const f = fixture();
    f.enrollment.findMany.mockResolvedValue([
      { ...f.row, id: 'missing-enrollment', courseId: 'missing' },
      { ...f.row, id: 'healthy-enrollment' },
    ]);
    f.authority.course.mockImplementation((id: string) => {
      if (id === 'missing')
        return Promise.reject(new NotFoundException('Course not found.'));
      return Promise.resolve({
        id: 14,
        published: true,
        instructors: [{ userId: 200 }],
      });
    });
    return f;
  }

  it('keeps student history and healthy enrollments when a course is missing', async () => {
    const { service } = history();
    const result = await service.list('100', false);
    expect(result.items.map((item) => [item.id, item.courseTitle])).toEqual([
      ['missing-enrollment', 'missing'],
      ['healthy-enrollment', '14'],
    ]);
  });

  it('keeps healthy teacher work without granting access to a missing course', async () => {
    const { service } = history();
    expect(
      (await service.list('200', true)).items.map((item) => item.id),
    ).toEqual(['healthy-enrollment']);
  });

  it('still hides work when the teacher has been removed from the course', async () => {
    const { service } = history();
    expect((await service.list('300', true)).items).toEqual([]);
  });

  it('advances the cursor even when the whole teacher page is hidden', async () => {
    const { service, enrollment, authority, row } = history();
    enrollment.findMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, index) => ({
        ...row,
        id: `enrollment-${index}`,
      })),
    );
    authority.course.mockRejectedValue(
      new NotFoundException('Course not found.'),
    );
    const result = await service.list('200', true);
    expect(result).toEqual({ items: [], nextCursor: 'enrollment-19' });
  });

  it.each([false, true])(
    'surfaces provider outages for teacher=%s',
    async (teacher) => {
      const { service, authority } = history();
      authority.course.mockRejectedValue(
        new BadGatewayException('Authority unavailable.'),
      );
      await expect(
        service.list(teacher ? '200' : '100', teacher),
      ).rejects.toThrow('Authority unavailable.');
    },
  );
});

it('includes co-instructor homework in the Admin queue while requiring current course authority', async () => {
  const f = fixture();
  f.row.instructorShares = [
    { teacherId: '200', credits: '40' },
    { teacherId: '201', credits: '10' },
  ];
  f.authority.course.mockResolvedValue({
    id: 14,
    instructors: [{ userId: 200 }, { userId: 201 }],
  });
  const page = await f.service.adminHomework({
    platformUserId: '201',
  } as never);
  expect(page.items).toHaveLength(1);
  expect(f.db.academyEnrollment.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { teacherId: '201' },
          { instructorShares: { array_contains: [{ teacherId: '201' }] } },
        ],
      }) as unknown,
    }),
  );
  f.authority.course.mockResolvedValue({
    id: 14,
    instructors: [{ userId: 200 }],
  });
  expect(
    (await f.service.adminHomework({ platformUserId: '201' } as never)).items,
  ).toHaveLength(0);
});

it('reports an Admin course-authority outage instead of silently hiding homework', async () => {
  const f = fixture();
  f.authority.course.mockRejectedValue(
    new BadGatewayException('Authority unavailable.'),
  );
  await expect(
    f.service.adminHomework({ platformUserId: '200' } as never),
  ).rejects.toThrow('Authority unavailable.');
});

it('keeps deleted courses inaccessible to bound Admin lecturers', async () => {
  const f = fixture();
  f.authority.course.mockRejectedValue(
    new NotFoundException('Course not found.'),
  );
  await expect(
    f.service.adminHomework({ platformUserId: '200' } as never),
  ).resolves.toMatchObject({ items: [] });
});
