import {
  CreateCrewTaskViewSchema,
  CreateCrewTaskFieldSchema,
  CreateCrewTaskCycleSchema,
  CreateCrewTaskWorkflowStateSchema,
} from './project-dto';
import { CrewCollaborationService } from '../collaboration/crew-collaboration.service';
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
  it.each([
    'crew-membership',
    'canvas-membership',
    'canvas-membership-rejected',
    'crew-wait',
    'task-wait',
    'authorized',
    'label',
    'view',
    'field',
    'cycle',
    'workflow',
    'comment-create',
    'comment-update',
    'comment-delete',
  ] as const)('%s preserves task authorization', async (mode) => {
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
    let workspaceId: string | undefined;
    let canvasProjectId: string | undefined;
    let holder: Promise<unknown> | undefined;
    let result: Promise<unknown> | undefined;
    try {
      if (
        [
          'canvas-membership',
          'canvas-membership-rejected',
          'crew-membership',
        ].includes(mode)
      ) {
        const workspace = await db.workspace.create({
          data: {
            type: 'team',
            name: 'Canvas lock fixture',
            ownerUserId: ownerId,
            createdById: ownerId,
          },
        });
        workspaceId = workspace.id;
        const project = await db.platformProject.create({
          data: { workspaceId, name: 'Task canvas', createdById: ownerId },
        });
        canvasProjectId = project.id;
        await db.crew.update({ where: { id: crewId }, data: { workspaceId } });
        await db.crewTask.update({
          where: { id: task.id },
          data: { canvasProjectId },
        });
        await db.projectMember.create({
          data: {
            projectId: canvasProjectId,
            userId: actorId,
            role: 'editor',
            grantedById: ownerId,
          },
        });
        await db.crewTaskAssignee.create({
          data: {
            crewId,
            taskId: task.id,
            crewMemberId: memberId,
            userId: actorId,
            currency: 'USD',
          },
        });
      }
      if (mode.startsWith('comment-')) {
        await db.crewMemberPermissionOverride.create({
          data: {
            memberId,
            permissionKey: 'tasks.comment',
            effect: 'allow',
            changedByUserId: ownerId,
          },
        });
        const comment = await db.crewTaskTimelineItem.create({
          data: {
            taskId: task.id,
            actorUserId: actorId,
            kind: 'comment',
            body: 'Original comment',
            mentions: [],
            payload: {},
          },
        });
        const client = db.$extends({
          query: {
            crewTaskTimelineItem: {
              async $allOperations({ operation, args, query }) {
                const value = await query(args);
                if (['create', 'update', 'updateMany'].includes(operation))
                  await db.crewMember.update({
                    where: { id: memberId },
                    data: { status: 'removed', removedAt: new Date() },
                  });
                return value;
              },
            },
          },
        });
        const comments = new CrewTasksService(
          client as unknown as PrismaService,
          new CrewAuthorizationService(db as PrismaService),
          {} as never,
          new NotificationService(db as PrismaService),
          { broadcastCrewTaskChange: broadcast } as never,
          {} as never,
        );
        const action =
          mode === 'comment-create'
            ? () =>
                comments.createComment(task.id, actorId, {
                  body: 'Rejected comment',
                  mentions: [],
                  attachments: [],
                  clientKey: 'retry-comment',
                })
            : mode === 'comment-update'
              ? () =>
                  comments.updateComment(comment.id, actorId, {
                    body: 'Rejected edit',
                    mentions: [],
                    expectedVersion: comment.version,
                  })
              : () => comments.deleteComment(comment.id, actorId);
        await expect(action()).rejects.toMatchObject({
          response: { code: 'CREW_MEMBERSHIP_REQUIRED' },
        });
        expect(
          await db.crewTaskTimelineItem.count({ where: { taskId: task.id } }),
        ).toBe(1);
        expect(
          await db.crewTaskTimelineItem.findUnique({
            where: { id: comment.id },
          }),
        ).toMatchObject({
          body: 'Original comment',
          deletedAt: null,
          version: comment.version,
        });
        expect(broadcast).not.toHaveBeenCalled();
        return;
      }
      if (['label', 'view', 'field', 'cycle', 'workflow'].includes(mode)) {
        const client = db.$extends({
          query: {
            $allModels: {
              async $allOperations({ operation, args, query }) {
                const value = await query(args);
                if (operation === 'create')
                  await db.crewMember.update({
                    where: { id: memberId },
                    data: { status: 'removed', removedAt: new Date() },
                  });
                return value;
              },
            },
          },
        });
        const planning = new CrewTasksService(
          client as unknown as PrismaService,
          new CrewAuthorizationService(db as PrismaService),
          {} as never,
          new NotificationService(db as PrismaService),
          { broadcastCrewTaskProjectChange: broadcast } as never,
          {} as never,
        );
        const action =
          mode === 'label'
            ? () =>
                planning.createLabel(crewId, actorId, {
                  name: 'Rejected',
                  color: '#888888',
                  description: '',
                })
            : mode === 'view'
              ? () =>
                  planning.createView(
                    crewId,
                    actorId,
                    CreateCrewTaskViewSchema.parse({
                      name: 'Rejected',
                      layout: 'list',
                    }),
                  )
              : mode === 'field'
                ? () =>
                    planning.createField(
                      crewId,
                      actorId,
                      CreateCrewTaskFieldSchema.parse({
                        name: 'Rejected',
                        type: 'text',
                      }),
                    )
                : mode === 'cycle'
                  ? () =>
                      planning.createCycle(
                        crewId,
                        actorId,
                        CreateCrewTaskCycleSchema.parse({
                          name: 'Rejected',
                          startAt: '2026-09-01T00:00:00Z',
                          endAt: '2026-09-30T00:00:00Z',
                        }),
                      )
                  : () =>
                      planning.createWorkflowState(
                        crewId,
                        actorId,
                        CreateCrewTaskWorkflowStateSchema.parse({
                          name: 'Rejected',
                          color: '#888888',
                        }),
                      );
        await expect(action()).rejects.toMatchObject({
          response: { code: 'CREW_MEMBERSHIP_REQUIRED' },
        });
        const counts = await Promise.all([
          db.crewTaskLabel.count({ where: { crewId, name: 'Rejected' } }),
          db.crewTaskView.count({ where: { crewId, name: 'Rejected' } }),
          db.crewTaskFieldDefinition.count({
            where: { crewId, name: 'Rejected' },
          }),
          db.crewTaskCycle.count({ where: { crewId, name: 'Rejected' } }),
          db.crewTaskWorkflowState.count({
            where: { crewId, name: 'Rejected' },
          }),
        ]);
        expect(counts).toEqual([0, 0, 0, 0, 0]);
        expect(broadcast).not.toHaveBeenCalled();
        return;
      }
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
        if (
          [
            'canvas-membership',
            'canvas-membership-rejected',
            'crew-membership',
          ].includes(mode)
        )
          await tx.$queryRaw`SELECT id FROM platform_projects WHERE id = ${canvasProjectId}::uuid FOR UPDATE`;
        else if (mode === 'crew-wait')
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
      const operation =
        mode === 'crew-membership'
          ? db.$transaction(async (tx) =>
              new CrewCollaborationService(
                db as PrismaService,
                {} as never,
                {} as never,
              ).removeCrewMemberAccess(crewId, actorId, tx),
            )
          : service.update(task.id, actorId, {
              expectedVersion: task.version,
              ...([
                'canvas-membership',
                'canvas-membership-rejected',
                'crew-membership',
              ].includes(mode)
                ? { assignees: [] }
                : { title: 'Must not commit' }),
            });
      result = operation.then(
        (value: unknown) => ({ value }),
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
      if (
        [
          'canvas-membership',
          'canvas-membership-rejected',
          'crew-membership',
        ].includes(mode)
      ) {
        expect(
          await db.projectMember.count({
            where: {
              projectId: canvasProjectId,
              userId: actorId,
              removedAt: null,
            },
          }),
        ).toBe(1);
        if (mode === 'canvas-membership-rejected') {
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
            await db.projectMember.count({
              where: {
                projectId: canvasProjectId,
                userId: actorId,
                removedAt: null,
              },
            }),
          ).toBe(1);
          expect(
            await db.crewTaskAssignee.count({ where: { taskId: task.id } }),
          ).toBe(1);
          expect(broadcast).not.toHaveBeenCalled();
          return;
        }
        unlock();
        await holder;
        expect(await result).toHaveProperty('value');
        expect(
          await db.projectMember.count({
            where: {
              projectId: canvasProjectId,
              userId: actorId,
              removedAt: null,
            },
          }),
        ).toBe(0);
        expect(broadcast).toHaveBeenCalledTimes(
          mode === 'crew-membership' ? 0 : 1,
        );
        return;
      }
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
      expect(await db.notification.count({ where: { userId: ownerId } })).toBe(
        0,
      );
      expect(broadcast).not.toHaveBeenCalled();
    } finally {
      unlock();
      await holder;
      await result;
      await db.notificationOutbox.deleteMany({ where: { userId: ownerId } });
      await db.notification.deleteMany({ where: { userId: ownerId } });
      await db.crewTaskAssignee.deleteMany({ where: { crewId } });
      await db.crewOwnership.deleteMany({ where: { crewId } });
      await db.crew.delete({ where: { id: crewId } });
      if (workspaceId)
        await db.workspace.delete({ where: { id: workspaceId } });
    }
  });
});
