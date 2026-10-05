import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { CrewTaskFeedbackService } from './task-feedback';

const url = process.env.TASK_FEEDBACK_TEST_DATABASE_URL;
(url ? describe : describe.skip)('Task feedback on isolated PostgreSQL', () => {
  let db: PrismaClient, service: CrewTaskFeedbackService;
  const creator = randomUUID(),
    reviewer = randomUUID(),
    crewId = randomUUID();
  let taskId: string;
  const input = {
    subjectUserId: creator,
    ratings: {
      direction: 'creator' as const,
      productionAbility: 4,
      understanding: 5,
      communication: 3,
    },
    comment: '',
  };
  beforeAll(async () => {
    const target = postgresFixtureUrl(url!);
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '55441' ||
      target.pathname !== '/audit_migrations_20261005'
    )
      throw new Error('Owned loopback audit fixture required');
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    // Service authorization is exercised separately; this suite verifies persistence,
    // transaction serialization, API validation and database constraints together.
    service = new CrewTaskFeedbackService(
      db as never,
      { require: () => Promise.resolve(undefined) } as never,
    );
    await db.crew.create({
      data: {
        id: crewId,
        name: 'Feedback fixture',
        description: '',
        logo: 'fixture',
        createdByUserId: reviewer,
      },
    });
    const state = await db.crewTaskWorkflowState.create({
      data: {
        crewId,
        name: 'Approved',
        color: '#888888',
        semantic: 'approved',
        createdByUserId: reviewer,
      },
    });
    const task = await db.crewTask.create({
      data: {
        crewId,
        title: 'Review fixture',
        number: 1,
        workflowStateId: state.id,
        createdByUserId: reviewer,
      },
    });
    taskId = task.id;
    await db.crewTaskSubmission.create({
      data: {
        taskId,
        versionNumber: 1,
        submittedByUserId: creator,
        reviewedByUserId: reviewer,
        reviewedAt: new Date(),
      },
    });
  });
  afterAll(async () => {
    try {
      if (db)
        await db.crewTaskFeedback.deleteMany({ where: { task: { crewId } } });
      if (db) await db.crew.deleteMany({ where: { id: crewId } });
    } finally {
      await db?.$disconnect();
    }
  });
  it('persists a ratings-only review exactly once across concurrent retries', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => service.submit(taskId, reviewer, input)),
    );
    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    expect(await db.crewTaskFeedback.count({ where: { taskId } })).toBe(1);
    expect(results[0].comment).toBe('');
    await expect(
      service.submit(taskId, reviewer, { ...input, comment: 'Changed later' }),
    ).rejects.toThrow('already submitted');
  });
  it('retains the database comment cap and independent response minimum', async () => {
    const row = await db.crewTaskFeedback.findFirstOrThrow({
      where: { taskId },
    });
    await expect(
      db.crewTaskFeedback.update({
        where: { id: row.id },
        data: { comment: 'x'.repeat(2001) },
      }),
    ).rejects.toThrow();
    await expect(
      db.crewTaskFeedback.update({
        where: { id: row.id },
        data: { response: '' },
      }),
    ).rejects.toThrow();
    await expect(
      service.respond(row.id, creator, { response: 'Thank you' }),
    ).resolves.toMatchObject({ response: 'Thank you' });
  });
  it('excludes historical private reviews and prevents changing their visibility on retry', async () => {
    expect(
      (await service.publicProfile(creator, { limit: 20 })).summary.total,
    ).toBe(0);
    await expect(
      service.submit(taskId, reviewer, { ...input, publicOnProfile: true }),
    ).rejects.toThrow('already submitted');
  });
  it('publishes only declared profile fields with full-history averages and scoped pagination', async () => {
    const original = await db.crewTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const publicTask = await db.crewTask.create({
        data: {
          crewId,
          title: 'Private task title',
          number: i + 2,
          workflowStateId: original.workflowStateId,
          createdByUserId: reviewer,
        },
      });
      await db.crewTaskSubmission.create({
        data: {
          taskId: publicTask.id,
          versionNumber: 1,
          submittedByUserId: creator,
          reviewedByUserId: reviewer,
          reviewedAt: new Date(),
          createdAt: new Date('2026-10-01T12:00:00Z'),
          timelinessEvidence: { version: 1, deadline: '2026-10-01T13:00:00Z' },
        },
      });
      const row = await service.submit(publicTask.id, reviewer, {
        ...input,
        comment: 'Published review ' + i,
        publicOnProfile: true,
      });
      ids.push(row.id);
      await db.crewTaskFeedback.update({
        where: { id: row.id },
        data: { createdAt: new Date('2026-10-02T00:00:00Z') },
      });
    }
    const first = await service.publicProfile(creator, { limit: 1 });
    expect(first.summary).toMatchObject({
      total: 3,
      average: 4.25,
      creator: { count: 3, average: 4.25 },
      manager: { count: 0, average: null },
      histogram: [0, 0, 0, 3, 0],
    });
    expect(first.items[0]).toMatchObject({
      timelinessScore: 5,
      scoreMilli: 4250,
    });
    expect(first.items[0]).not.toHaveProperty('taskId');
    expect(first.items[0]).not.toHaveProperty('submissionId');
    expect(first.items[0]).not.toHaveProperty('response');
    const found = first.items.map((row) => row.id);
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await service.publicProfile(creator, { limit: 1, cursor });
      found.push(...page.items.map((row) => row.id));
      expect(page.summary.total).toBe(3);
      cursor = page.nextCursor;
    }
    expect(found.sort()).toEqual(ids.sort());
    await expect(
      service.publicProfile(reviewer, { limit: 1, cursor: ids[0] }),
    ).rejects.toThrow('cursor not found');
    const privateReview = await db.crewTaskFeedback.findFirstOrThrow({
      where: { taskId },
    });
    await expect(
      service.publicProfile(creator, { limit: 1, cursor: privateReview.id }),
    ).rejects.toThrow('cursor not found');
    await db.crewTaskFeedback.deleteMany({ where: { id: { in: ids } } });
  });
});
