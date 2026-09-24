import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CrewAccountabilityService } from './accountability.service';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { CrewTasksService } from '../tasks/tasks.service';
import type { PrismaService } from '../../infra/db/db.module';

const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.CREW_ACCOUNTABILITY_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const suite = databaseUrl ? describe : describe.skip;
suite('Crew accountability on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let service: CrewAccountabilityService;
  let authorization: CrewAuthorizationService;
  const leader = randomUUID(),
    alice = randomUUID(),
    bob = randomUUID();
  const crewId = randomUUID();
  const members = new Map<string, string>();
  const states = new Map<string, string>();
  const oldPoints = process.env.CREW_COMPLETION_REWARD_POINTS;
  const oldApprovers = process.env.CREW_COMPLETION_REWARD_APPROVER_IDS;
  let number = 0;
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !(
        (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test') ||
        (url.port === '55439' && url.pathname === '/task01')
      )
    )
      throw new Error('Named loopback test database required');
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        max: 6,
        options: '-c timezone=UTC',
      }),
    });
    const prisma = db as PrismaService;
    authorization = new CrewAuthorizationService(prisma);
    service = new CrewAccountabilityService(prisma, authorization, {
      send: () => Promise.resolve({}),
    } as never);
    process.env.CREW_COMPLETION_REWARD_POINTS = '10';
    process.env.CREW_COMPLETION_REWARD_APPROVER_IDS = leader;
    await db.crew.create({
      data: {
        id: crewId,
        name: 'Accountability integration',
        description: '',
        logo: 'https://example.test/crew.png',
        createdByUserId: leader,
      },
    });
    for (const userId of [leader, alice, bob]) {
      const id = randomUUID();
      members.set(userId, id);
      await db.crewMember.create({
        data: { id, crewId, userId, joinedVia: 'invitation' },
      });
    }
    await db.crewOwnership.create({
      data: { crewId, memberId: members.get(leader)! },
    });
    for (const semantic of ['in_progress', 'approved', 'cancelled'] as const) {
      const state = await db.crewTaskWorkflowState.create({
        data: {
          crewId,
          name: semantic,
          color: '#888888',
          semantic,
          position: states.size,
          createdByUserId: leader,
        },
      });
      states.set(semantic, state.id);
    }
    await db.crewProductionPage.create({
      data: {
        crewId,
        document: {},
        status: 'in_progress',
        createdByUserId: leader,
        updatedByUserId: leader,
      },
    });
  });
  afterAll(async () => {
    if (oldPoints === undefined)
      delete process.env.CREW_COMPLETION_REWARD_POINTS;
    else process.env.CREW_COMPLETION_REWARD_POINTS = oldPoints;
    if (oldApprovers === undefined)
      delete process.env.CREW_COMPLETION_REWARD_APPROVER_IDS;
    else process.env.CREW_COMPLETION_REWARD_APPROVER_IDS = oldApprovers;
    // Keep the dedicated test DB for inspection; no broad cleanup on shared DBs.
    await db?.$disconnect();
  });
  async function task(userId: string) {
    return db.crewTask.create({
      data: {
        crewId,
        number: ++number,
        title: `Scene ${number}`,
        workflowStateId: states.get('in_progress')!,
        dueAt: new Date(Date.now() + 86400000),
        createdByUserId: leader,
        assignees: {
          create: {
            crewMemberId: members.get(userId)!,
            userId,
            currency: 'USD',
          },
        },
      },
      include: { assignees: true },
    });
  }
  async function approve(taskId: string, userId: string) {
    const now = new Date();
    await db.crewTaskSubmission.create({
      data: {
        taskId,
        versionNumber: 1,
        submittedByUserId: userId,
        reviewedByUserId: leader,
        reviewedAt: now,
      },
    });
    await db.crewTask.update({
      where: { id: taskId },
      data: {
        workflowStateId: states.get('approved')!,
        approvedAt: now,
        submittedAt: now,
        approvedByUserId: leader,
      },
    });
  }
  it.each([false, true])(
    'requires the approved submission, not an earlier changes-requested version (approved=%s)',
    async (approved) => {
      const creator = randomUUID();
      await db.crewMember.create({
        data: {
          id: randomUUID(),
          crewId,
          userId: creator,
          joinedVia: 'invitation',
        },
      });
      const t = await task(bob);
      const now = new Date();
      await db.crewTaskSubmission.createMany({
        data: [
          {
            taskId: t.id,
            versionNumber: 1,
            submittedByUserId: creator,
            reviewedByUserId: leader,
            reviewedAt: new Date(now.getTime() - 1000),
            reviewNote: 'Changes needed',
          },
          {
            taskId: t.id,
            versionNumber: 2,
            submittedByUserId: approved ? creator : bob,
            reviewedByUserId: leader,
            reviewedAt: now,
            reviewNote: 'Approved',
          },
        ],
      });
      await db.crewTask.update({
        where: { id: t.id },
        data: {
          workflowStateId: states.get('approved')!,
          approvedAt: now,
          approvedByUserId: leader,
        },
      });
      await db.crewProductionPage.update({
        where: { crewId },
        data: { status: 'completed' },
      });
      const send = service.feedback(crewId, creator, {
        subjectUserId: bob,
        rating: 5,
        comment: 'Project feedback',
      });
      if (approved)
        await expect(send).resolves.toMatchObject({ authorUserId: creator });
      else await expect(send).rejects.toMatchObject({ status: 403 });
      const receive = service.feedback(crewId, bob, {
        subjectUserId: creator,
        rating: 5,
        comment: 'Project feedback',
      });
      if (approved)
        await expect(receive).resolves.toMatchObject({
          subjectUserId: creator,
        });
      else await expect(receive).rejects.toMatchObject({ status: 400 });
      // This fixture must not alter the completed-project test's target selection.
      await db.crewPeerFeedback.deleteMany({
        where: {
          crewId,
          OR: [{ authorUserId: creator }, { subjectUserId: creator }],
        },
      });
      await db.crewProductionPage.update({
        where: { crewId },
        data: { status: 'backlog' },
      });
    },
  );
  it('serializes competing acceptances and retains the original commitment after handover', async () => {
    const t = await task(alice);
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        service.commit(t.id, alice, {
          action: 'accept',
          expectedVersion: 1,
          reason: '',
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.crewTaskCommitment.count({ where: { taskId: t.id } })).toBe(
      1,
    );
    await service.commit(t.id, alice, {
      action: 'withdraw',
      expectedVersion: 2,
      reason: 'Unavailable; source files are ready.',
    });
    const record = await db.crewTaskCommitment.findUniqueOrThrow({
      where: { assignmentId: t.assignees[0].id },
    });
    await expect(
      service.handover(record.id, leader, 'Transferred source files'),
    ).rejects.toThrow('Reassign');
    await db.crewTaskAssignee.delete({ where: { id: t.assignees[0].id } });
    await db.crewTaskAssignee.create({
      data: {
        crewId,
        taskId: t.id,
        userId: bob,
        crewMemberId: members.get(bob)!,
        currency: 'USD',
      },
    });
    await service.commit(t.id, bob, {
      action: 'accept',
      expectedVersion: 3,
      reason: '',
    });
    await Promise.all(
      [1, 2].map(() =>
        service.handover(record.id, leader, 'Transferred source files'),
      ),
    );
    expect(
      await db.crewTaskTimelineItem.count({
        where: { taskId: t.id, kind: 'commitment.handover' },
      }),
    ).toBe(1);
    expect(
      await db.crewTaskCommitment.findUnique({ where: { id: record.id } }),
    ).toMatchObject({
      status: 'withdrawn',
      promisedDueAt: t.dueAt,
      handoverNote: 'Transferred source files',
    });
    await approve(t.id, bob);
    const project = await service.project(crewId, leader, 1);
    expect(project.reliability.find((r) => r.userId === alice)).toMatchObject({
      withdrawn: 1,
      completed: 0,
    });
    expect(project.reliability.find((r) => r.userId === bob)).toMatchObject({
      completed: 1,
      measured: 1,
      onTime: 1,
    });
    await db.crewTask.update({
      where: { id: t.id },
      data: { dueAt: new Date(Date.now() + 172800000) },
    });
    expect(
      (await service.project(crewId, leader, 1)).reliability.find(
        (r) => r.userId === bob,
      ),
    ).toMatchObject({ completed: 1, measured: 0, scheduleChanges: 1 });
    await expect(service.project(crewId, randomUUID(), 1)).rejects.toThrow();
  });
  it('records project withdrawal, blocks submission, and keeps handover access', async () => {
    const previousContribution = await task(alice);
    await approve(previousContribution.id, alice);
    const t = await task(alice);
    await service.commit(t.id, alice, {
      action: 'accept',
      expectedVersion: 1,
      reason: '',
    });
    await service.withdrawProject(
      crewId,
      alice,
      'Other work means I cannot continue.',
    );
    expect(
      await db.crewMember.findUnique({ where: { id: members.get(alice)! } }),
    ).toMatchObject({ status: 'active' });
    const tasks = new CrewTasksService(
      db as PrismaService,
      authorization,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      tasks.submit(t.id, alice, { note: '', assetNodeIds: [] }),
    ).rejects.toThrow('withdrawal');
    await expect(
      service.resolveWithdrawal(crewId, alice, leader, 'All work handed over'),
    ).rejects.toThrow('Reassign');
    await db.crewTask.update({
      where: { id: t.id },
      data: { workflowStateId: states.get('cancelled')! },
    });
    await service.resolveWithdrawal(
      crewId,
      alice,
      leader,
      'This remaining shot was cancelled.',
    );
    expect(
      await db.crewParticipationRecord.findUnique({
        where: { crewId_userId: { crewId, userId: alice } },
      }),
    ).toMatchObject({
      withdrawalReason: 'Other work means I cannot continue.',
      resolvedByUserId: leader,
    });
  });
  it('enforces one peer review and rejects concurrent point awards without wallet writes', async () => {
    await db.crewProductionPage.update({
      where: { crewId },
      data: { status: 'completed' },
    });
    await Promise.all(
      [1, 2].map(() =>
        service.feedback(crewId, alice, {
          subjectUserId: bob,
          rating: 4,
          comment: 'Good handover and delivery.',
        }),
      ),
    );
    expect(
      await db.crewPeerFeedback.count({
        where: { crewId, authorUserId: alice, subjectUserId: bob },
      }),
    ).toBe(1);
    const results = await Promise.allSettled(
      [1, 2].map(() => service.recognize(crewId, bob, leader)),
    );
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(
      await db.walletTransaction.count({
        where: { idempotencyKey: `crew_completion_reward:${crewId}:${bob}` },
      }),
    ).toBe(0);
    expect(
      await db.crewParticipationRecord.findUnique({
        where: { crewId_userId: { crewId, userId: bob } },
      }),
    ).toBeNull();
    const feedback = await db.crewPeerFeedback.findFirstOrThrow({
      where: { crewId },
    });
    await service.respond(feedback.id, bob, 'Thank you; received.');
    await expect(
      service.respond(feedback.id, alice, 'Overwrite'),
    ).rejects.toThrow();
    // Reopening and completing again cannot create another reward.
    await db.crewProductionPage.update({
      where: { crewId },
      data: { status: 'in_progress' },
    });
    await db.crewProductionPage.update({
      where: { crewId },
      data: { status: 'completed' },
    });
    await expect(service.recognize(crewId, bob, leader)).rejects.toThrow(
      'Crew compensation is money and agreed profit sharing',
    );
    expect(
      await db.walletTransaction.count({
        where: { idempotencyKey: `crew_completion_reward:${crewId}:${bob}` },
      }),
    ).toBe(0);
  });
  it('database constraints reject invalid ratings and duplicate project awards', async () => {
    await expect(
      db.crewPeerFeedback.create({
        data: {
          crewId,
          authorUserId: leader,
          subjectUserId: bob,
          rating: 6,
          comment: 'Invalid score',
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.crewParticipationRecord.create({
        data: { crewId, userId: bob, communityPoints: 10 },
      }),
    ).rejects.toThrow();
  });
});
