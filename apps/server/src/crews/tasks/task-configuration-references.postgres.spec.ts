import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { CrewTasksService } from './tasks.service';
import type { PrismaService } from '../../infra/db/db.module';
const databaseUrl = process.env.TASK01_TEST_DATABASE_URL;
const applicationName = `config-${randomUUID()}`;
jest.setTimeout(30000);
const integration = databaseUrl ? describe : describe.skip;
integration('Crew task configuration reference integrity', () => {
  let db: PrismaClient;
  let crewId: string;
  let taskId: string;
  const userId = 'configuration-fixture';
  const service = (client: unknown = db) =>
    new CrewTasksService(
      client as PrismaService,
      { require: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      {
        broadcastCrewTaskProjectChange: jest.fn().mockResolvedValue(undefined),
      } as never,
      {} as never,
    );
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.port !== '55439' ||
      url.pathname !== '/task01'
    )
      throw new Error('Owned local task01 required');
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        application_name: applicationName,
      }),
    });
    await db.$connect();
  });
  beforeEach(async () => {
    crewId = randomUUID();
    await db.crew.create({
      data: {
        id: crewId,
        name: 'Task configuration',
        description: '',
        logo: 'test.png',
        createdByUserId: userId,
      },
    });
    const state = await db.crewTaskWorkflowState.create({
      data: {
        crewId,
        name: 'Open',
        color: '#888888',
        semantic: 'open',
        createdByUserId: userId,
      },
    });
    taskId = (
      await db.crewTask.create({
        data: {
          crewId,
          number: 1,
          title: 'Task',
          workflowStateId: state.id,
          createdByUserId: userId,
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.crewTask.deleteMany({ where: { crewId } });
    await db.crew.delete({ where: { id: crewId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it('removes deleted labels from saved filters without changing other filters', async () => {
    const label = await db.crewTaskLabel.create({
      data: { crewId, name: 'Risk', color: '#888888', createdByUserId: userId },
    });
    const other = await db.crewTaskLabel.create({
      data: { crewId, name: 'Keep', color: '#888888', createdByUserId: userId },
    });
    const view = await db.crewTaskView.create({
      data: {
        crewId,
        name: 'Filtered',
        layout: 'list',
        filters: { labelIds: [label.id, other.id], priorities: ['high'] },
        createdByUserId: userId,
      },
    });
    await service().deleteLabel(label.id, userId);
    expect(
      (await db.crewTaskView.findUniqueOrThrow({ where: { id: view.id } }))
        .filters,
    ).toEqual({ labelIds: [other.id], priorities: ['high'] });
  });
  it.each(['single_select', 'multi_select'] as const)(
    'does not remove an option assigned during %s configuration editing',
    async (type) => {
      const options = [
        { id: 'keep', label: 'Keep' },
        { id: 'remove', label: 'Remove' },
      ];
      const field = await db.crewTaskFieldDefinition.create({
        data: { crewId, name: 'Shot', type, options, createdByUserId: userId },
      });
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const writer = db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
          await tx.crewTaskFieldValue.create({
            data: {
              crewId,
              updatedByUserId: userId,
              taskId,
              fieldId: field.id,
              value: type === 'single_select' ? 'remove' : ['remove'],
            },
          });
          entered();
          await gate;
        },
        { timeout: 15000 },
      );
      await started;
      const update = service()
        .updateField(field.id, userId, {
          expectedUpdatedAt: field.updatedAt.toISOString(),
          options: [options[0]],
        })
        .then(
          () => null,
          (error: unknown) => error,
        );
      try {
        const deadline = Date.now() + 5000;
        let waiting = false;
        while (Date.now() < deadline) {
          const rows = await db.$queryRaw<
            { count: number }[]
          >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
          if (rows[0].count) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
      } finally {
        release();
      }
      await writer;
      expect(await update).toBeInstanceOf(ConflictException);
      expect(
        (
          await db.crewTaskFieldDefinition.findUniqueOrThrow({
            where: { id: field.id },
          })
        ).options,
      ).toEqual(options);
    },
  );
  it('allows removing an unused option', async () => {
    const field = await db.crewTaskFieldDefinition.create({
      data: {
        crewId,
        name: 'Shot',
        type: 'single_select',
        options: [
          { id: 'keep', label: 'Keep' },
          { id: 'remove', label: 'Remove' },
        ],
        createdByUserId: userId,
      },
    });
    await service().updateField(field.id, userId, {
      expectedUpdatedAt: field.updatedAt.toISOString(),
      options: [{ id: 'keep', label: 'Keep' }],
    });
    expect(
      (
        await db.crewTaskFieldDefinition.findUniqueOrThrow({
          where: { id: field.id },
        })
      ).options,
    ).toEqual([{ id: 'keep', label: 'Keep' }]);
  });
});
