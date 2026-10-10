import { AcademyLearningService } from './academy-learning.service';

it('allows the same current co-instructor to review through Web and Admin', async () => {
  const row = {
    id: 'e',
    courseId: '14',
    teacherId: '200',
    studentId: '100',
    instructorShares: [
      { teacherId: '200', credits: '40' },
      { teacherId: '201', credits: '10' },
    ],
  };
  const db = {
    academyEnrollment: { findUnique: jest.fn().mockResolvedValue(row) },
  };
  const authority = {
    course: jest
      .fn()
      .mockResolvedValue({ instructors: [{ userId: 200 }, { userId: 201 }] }),
  };
  const service = new AcademyLearningService(
    db as never,
    authority as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const apply = jest
    .spyOn(service as any, 'applyReview')
    .mockResolvedValue({ reviewed: true });
  const input = {
    decision: 'approved',
    expectedVersion: 2,
    score: 80,
    feedback: 'Reviewed',
  } as const;
  await expect(service.review('e', '201', input)).resolves.toEqual({
    reviewed: true,
  });
  apply.mockClear();
  await expect(
    service.adminReview(
      {
        id: 'a',
        platformUserId: '201',
        status: 'active',
        siteScope: 'all',
        permissions: ['courses.write'],
      } as never,
      'e',
      input,
    ),
  ).resolves.toEqual({ reviewed: true });
  expect(apply).toHaveBeenCalled();
});

it.each(['100', '999'])(
  'denies self-review and unrelated lecturer %s',
  async (userId) => {
    const row = {
      id: 'e',
      studentId: '100',
      courseId: '14',
      teacherId: '200',
      assetIds: ['asset'],
    };
    const db = {
      academyEnrollment: { findUnique: jest.fn().mockResolvedValue(row) },
      mediaAsset: { findFirst: jest.fn() },
    };
    const authority = {
      course: jest.fn().mockResolvedValue({
        instructors: [{ userId: 100 }, { userId: 200 }, { userId: 201 }],
      }),
    };
    const service = new AcademyLearningService(
      db as never,
      authority as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const admin = {
      platformUserId: userId,
      status: 'active',
      siteScope: 'all',
      permissions: ['courses.write'],
    } as never;
    await expect(
      service.adminReview(admin, 'e', {
        decision: 'approved',
        expectedVersion: 2,
        score: 80,
        feedback: 'Reviewed',
      }),
    ).rejects.toThrow('Only the assigned course teacher');
    await expect(service.adminAttachment(admin, 'e', 'asset')).rejects.toThrow(
      'Only the assigned course teacher',
    );
    expect(db.mediaAsset.findFirst).not.toHaveBeenCalled();
  },
);

it('allows a current co-instructor to open a homework attachment', async () => {
  const row = {
    id: 'e',
    studentId: '100',
    teacherId: '200',
    courseId: '14',
    assetIds: ['asset'],
  };
  const asset = { id: 'asset' };
  const db = {
    academyEnrollment: { findUnique: jest.fn().mockResolvedValue(row) },
    mediaAsset: { findFirst: jest.fn().mockResolvedValue(asset) },
  };
  const authority = {
    course: jest
      .fn()
      .mockResolvedValue({ instructors: [{ userId: 200 }, { userId: 201 }] }),
  };
  const storage = { createReadUrl: jest.fn().mockResolvedValue('signed-url') };
  const service = new AcademyLearningService(
    db as never,
    authority as never,
    {} as never,
    {} as never,
    storage as never,
    {} as never,
  );
  await expect(
    service.adminAttachment({ platformUserId: '201' } as never, 'e', 'asset'),
  ).resolves.toBe('signed-url');
});
