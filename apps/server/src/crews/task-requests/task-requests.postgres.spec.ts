import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { CrewTasksService } from '../tasks/tasks.service';
import { CrewTaskRequestsService } from './task-requests.service';
import { CreateCrewTaskSchema } from '../dto';
import { POINTS_OPERATORS } from '../../admin-auth/admin-points-policy';
import type { AdminActor } from '../../admin-auth';
const url = process.env.TASK_APPROVAL_TEST_DATABASE_URL;
(url ? describe : describe.skip)('Task approval on isolated PostgreSQL', () => {
  let db: PrismaClient,
    tasks: CrewTasksService,
    requests: CrewTaskRequestsService;
  const crewId = randomUUID(),
    member = randomUUID(),
    sessionId = randomUUID();
  const admin = {
    id: POINTS_OPERATORS.global.producer,
    sessionId,
    siteScope: 'global',
    status: 'active',
  } as AdminActor;
  const broadcast = jest.fn().mockResolvedValue(undefined);
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '55441' ||
      target.pathname !== '/task_approval_test'
    )
      throw new Error('Isolated task approval fixture required');
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await db.adminUser.upsert({
      where: { id: admin.id },
      update: {},
      create: {
        id: admin.id,
        email: 'approval@fixture.invalid',
        displayName: 'Fixture producer',
        passwordHash: 'not-authenticatable',
      },
    });
    await db.adminSession.create({
      data: {
        id: sessionId,
        userId: admin.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    await db.crew.create({
      data: {
        id: crewId,
        name: 'Approval fixture',
        description: '',
        logo: 'test',
        createdByUserId: member,
      },
    });
    await db.crewMember.create({
      data: {
        id: randomUUID(),
        crewId,
        userId: member,
        joinedVia: 'invitation',
      },
    });
    const auth = new CrewAuthorizationService(db as never);
    tasks = new CrewTasksService(
      db as never,
      auth,
      {} as never,
      { send: jest.fn() } as never,
      { broadcastCrewTaskChange: broadcast } as never,
      {} as never,
    );
    requests = new CrewTaskRequestsService(db as never, auth, {
      get: () => tasks,
    } as never);
  });
  afterAll(async () => {
    if (!db) return;
    await db.adminAuditLog.deleteMany({ where: { actorSessionId: sessionId } });
    await db.crewTaskCreationRequest.deleteMany({ where: { crewId } });
    await db.crewTask.deleteMany({ where: { crewId } });
    await db.crew.delete({ where: { id: crewId } });
    await db.adminSession.delete({ where: { id: sessionId } });
    await db.$disconnect();
  });
  async function submit(title: string, extra: object = {}) {
    try {
      await tasks.create(
        crewId,
        member,
        CreateCrewTaskSchema.parse({
          title,
          description: 'Draw a scene',
          taskKind: 'art',
          dueAt: '2099-01-01T00:00:00.000Z',
          rewardUsdMinor: 0,
          assignees: [],
          submissionKey: randomUUID(),
          ...extra,
        }),
      );
      throw new Error('Submission bypassed approval');
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() !== 202)
        throw error;
      return (error.getResponse() as { requestId: string }).requestId;
    }
  }
  it('queues a regular member without publishing, then concurrent approvals create exactly once', async () => {
    const id = await submit('Approved once');
    expect(await db.crewTask.count({ where: { crewId } })).toBe(0);
    expect(broadcast).not.toHaveBeenCalled();
    const results = await Promise.all([
      requests.decide(admin, id, 'approved', ''),
      requests.decide(admin, id, 'approved', ''),
    ]);
    expect(results.every((r) => r.status === 'approved')).toBe(true);
    expect(
      await db.crewTask.count({ where: { crewId, title: 'Approved once' } }),
    ).toBe(1);
    expect(await db.adminAuditLog.count({ where: { resourceId: id } })).toBe(1);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });
  it('rolls back creation if audit persistence fails, leaving the request pending', async () => {
    const id = await submit('Must roll back');
    await expect(
      requests.decide(
        { ...admin, sessionId: randomUUID() },
        id,
        'approved',
        '',
      ),
    ).rejects.toThrow();
    expect(
      await db.crewTask.count({ where: { crewId, title: 'Must roll back' } }),
    ).toBe(0);
    expect(
      (await db.crewTaskCreationRequest.findUniqueOrThrow({ where: { id } }))
        .status,
    ).toBe('pending');
    expect(broadcast).toHaveBeenCalledTimes(1);
    await requests.decide(admin, id, 'rejected', 'Revise');
  });
  it('rejects without task creation and refuses approval after membership removal', async () => {
    const rejected = await submit('Rejected');
    await requests.decide(admin, rejected, 'rejected', 'No');
    expect(
      await db.crewTask.count({ where: { crewId, title: 'Rejected' } }),
    ).toBe(0);
    const removed = await submit('Removed member');
    await db.crewMember.updateMany({
      where: { crewId, userId: member },
      data: { status: 'removed' },
    });
    await expect(
      requests.decide(admin, removed, 'approved', ''),
    ).rejects.toThrow('Active crew membership');
    expect(
      (
        await db.crewTaskCreationRequest.findUniqueOrThrow({
          where: { id: removed },
        })
      ).status,
    ).toBe('pending');
  });
});
