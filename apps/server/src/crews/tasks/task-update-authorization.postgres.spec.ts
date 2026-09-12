import { NotificationService } from '../../notification/notification.service';
import { randomUUID } from 'node:crypto';
import { buildPrisma, type PrismaService } from '../../infra/db/db.module';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { CrewTasksService } from './tasks.service';

const suite =
  process.env.DATABASE_POSTGRES_INTEGRATION === '1' ? describe : describe.skip;
suite('Task update authorization during PostgreSQL waits', () => {
  let db: ReturnType<typeof buildPrisma>;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.port !== '5433' ||
      url.pathname !== '/fizzdragon_outbox_test'
    )
      throw new Error(
        'Use the isolated localhost:5433/fizzdragon_outbox_test database.',
      );
    db = buildPrisma();
    await db.$connect();
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it.each(['crew-wait', 'task-wait', 'authorized'] as const)(
    '%s preserves task authorization',
    async (mode) => {
      const crewId = randomUUID(),
        ownerId = randomUUID(),
        actorId = randomUUID(),
        memberId = randomUUID();
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Authorization fixture',
          description: '',
          logo: 'https://fixtures.invalid/logo',
          createdByUserId: ownerId,
        },
      });
      const owner = await db.crewMember.create({
        data: {
          id: randomUUID(),
          crewId,
          userId: ownerId,
          joinedVia: 'creation',
        },
      });
      await db.crewOwnership.create({ data: { crewId, memberId: owner.id } });
      await db.crewMember.create({
        data: {
          id: memberId,
          crewId,
          userId: actorId,
          joinedVia: 'invitation',
          permissionOverrides: {
            create: {
              permissionKey: 'tasks.manage',
              effect: 'allow',
              changedByUserId: ownerId,
            },
          },
        },
      });
      const state = await db.crewTaskWorkflowState.create({
        data: {
          crewId,
          name: 'Open',
          color: '#888888',
          semantic: 'open',
          position: 0,
          createdByUserId: ownerId,
        },
      });
      const task = await db.crewTask.create({
        data: {
          crewId,
          title: 'Original',
          number: 1,
          workflowStateId: state.id,
          createdByUserId: ownerId,
        },
      });
      const broadcast = jest.fn().mockResolvedValue(undefined);
      const service = new CrewTasksService(
        db as PrismaService,
        new CrewAuthorizationService(db as PrismaService),
        {} as never,
        new NotificationService(db as PrismaService),
        { broadcastCrewTaskChange: broadcast } as never,
        {} as never,
      );
      let unlock!: () => void, ready!: (pid: number) => void;
      const release = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      const entered = new Promise<number>((resolve) => {
        ready = resolve;
      });
      let holder: Promise<unknown> | undefined;
      let result: Promise<unknown> | undefined;
      try {
        if (mode === 'authorized') {
          await service.update(task.id, actorId, {
            expectedVersion: task.version,
            title: 'Changed',
          });
          expect(
            (await db.crewTask.findUniqueOrThrow({ where: { id: task.id } }))
              .title,
          ).toBe('Changed');
          expect(broadcast).toHaveBeenCalledTimes(1);
          return;
        }
        holder = db.$transaction(async (tx) => {
          if (mode === 'crew-wait')
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
          else
            await tx.$queryRaw`SELECT id FROM crew_tasks WHERE id = ${task.id}::uuid FOR UPDATE`;
          const [row] = await tx.$queryRaw<
            Array<{ pid: number }>
          >`SELECT pg_backend_pid() AS pid`;
          ready(row.pid);
          await release;
        });
        const pid = await entered;
        result = service
          .update(task.id, actorId, {
            expectedVersion: task.version,
            title: 'Must not commit',
          })
          .then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
        let waiting = false;
        for (let i = 0; i < 100; i++) {
          const [row] = await db.$queryRaw<
            Array<{ waiting: boolean }>
          >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS waiting`;
          if (row.waiting) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await db.crewMember.update({
          where: { id: memberId },
          data: { status: 'removed', removedAt: new Date() },
        });
        unlock();
        await holder;
        expect(await result).toMatchObject({
          error: { response: { code: 'CREW_MEMBERSHIP_REQUIRED' } },
        });
        expect(
          await db.crewTask.findUniqueOrThrow({ where: { id: task.id } }),
        ).toEqual(task);
        expect(
          await db.crewTaskTimelineItem.count({ where: { taskId: task.id } }),
        ).toBe(0);
        expect(
          await db.notification.count({ where: { userId: ownerId } }),
        ).toBe(0);
        expect(broadcast).not.toHaveBeenCalled();
      } finally {
        unlock();
        await holder;
        await result;
        await db.notificationOutbox.deleteMany({ where: { userId: ownerId } });
        await db.notification.deleteMany({ where: { userId: ownerId } });
        await db.crewOwnership.deleteMany({ where: { crewId } });
        await db.crew.delete({ where: { id: crewId } });
      }
    },
  );
});
