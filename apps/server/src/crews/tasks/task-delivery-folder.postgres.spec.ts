import {
  seedCrewProductionFolders,
  seedCrewProductionTasks,
} from '../production/production-bootstrap';
import { ProjectTaskTemplateService } from '../templates/project-task-template.service';
import { CrewTasksService } from './tasks.service';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { CrewAssetAccessService } from '../assets/asset-access.service';
import { taskDeliveryFolderTx } from './task-delivery-folder';
import type { PrismaService } from '../../infra/db/db.module';

const url = process.env.TASK_DELIVERY_FOLDER_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Automatic task folders on isolated PostgreSQL',
  () => {
    let db: PrismaClient,
      access: CrewAssetAccessService,
      stateId: string,
      categoryId: string;
    const crewId = randomUUID(),
      owner = randomUUID(),
      member = randomUUID();
    let sequence = 0;
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55441' ||
        target.pathname !== '/audit_migrations_20261005'
      )
        throw new Error('Owned loopback audit fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });
      const prisma = db as PrismaService;
      access = new CrewAssetAccessService(
        prisma,
        new CrewAuthorizationService(prisma),
      );
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Folder fixture',
          description: '',
          logo: 'fixture',
          createdByUserId: owner,
        },
      });
      const leader = await db.crewMember.create({
        data: {
          id: randomUUID(),
          crewId,
          userId: owner,
          joinedVia: 'invitation',
        },
      });
      await db.crewOwnership.create({ data: { crewId, memberId: leader.id } });
      await db.crewMember.create({
        data: {
          id: randomUUID(),
          crewId,
          userId: member,
          joinedVia: 'invitation',
        },
      });
      stateId = (
        await db.crewTaskWorkflowState.create({
          data: {
            crewId,
            name: 'Open',
            color: '#888888',
            semantic: 'open',
            createdByUserId: owner,
          },
        })
      ).id;
      categoryId = (
        await db.crewAssetNode.create({
          data: {
            crewId,
            kind: 'folder',
            folderKey: 'script',
            name: 'Renamed script category',
            createdByUserId: owner,
            updatedByUserId: owner,
          },
        })
      ).id;
    });
    afterAll(async () => {
      try {
        await db?.crewTaskDeliveryFolder.deleteMany({ where: { crewId } });
        await db?.crew.deleteMany({ where: { id: crewId } });
      } finally {
        await db?.$disconnect();
      }
    });
    const createTask = () =>
      db.crewTask.create({
        data: {
          crewId,
          title: 'Opening scene',
          number: ++sequence,
          workflowStateId: stateId,
          taskKind: 'script',
          createdByUserId: owner,
        },
      });
    const prepare = (
      task: Awaited<ReturnType<typeof createTask>>,
      userId = owner,
    ) =>
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
        return taskDeliveryFolderTx(tx, access, task, userId);
      });
    it('serializes retries and allocates distinct child names for separate tasks', async () => {
      const first = await createTask(),
        second = await createTask();
      const [a, b, retry] = await Promise.all([
        prepare(first),
        prepare(second),
        prepare(first),
      ]);
      expect(a).toBe(retry);
      expect(a).not.toBe(b);
      const nodes = await db.crewAssetNode.findMany({
        where: { id: { in: [a, b] } },
      });
      expect(nodes.every((n) => n.parentId === categoryId)).toBe(true);
      expect(nodes.map((n) => n.name).sort()).toEqual([
        'Opening scene',
        'Opening scene (2)',
      ]);
      await db.crewTask.update({
        where: { id: first.id },
        data: { taskKind: 'art' },
      });
      expect(await prepare({ ...first, taskKind: 'art' })).toBe(a);
    });
    it('enforces a restricted category and inherits its ACL after an explicit upload grant', async () => {
      const task = await createTask();
      await db.crewAssetNode.update({
        where: { id: categoryId },
        data: { accessMode: 'restricted' },
      });
      await expect(prepare(task, member)).rejects.toThrow('permission');
      expect(
        await db.crewTaskDeliveryFolder.count({ where: { taskId: task.id } }),
      ).toBe(0);
      await db.crewAssetGrant.create({
        data: {
          nodeId: categoryId,
          userId: member,
          permission: 'upload',
          grantedByUserId: owner,
        },
      });
      const child = await prepare(task, member);
      expect(await access.resolveNodePermission(crewId, child, member)).toBe(
        'upload',
      );
      await db.crewAssetGrant.deleteMany({
        where: { nodeId: categoryId, userId: member },
      });
      await expect(prepare(task, member)).rejects.toThrow('permission');
    });
    it('does not silently recreate a trashed category at root', async () => {
      const task = await createTask();
      await db.crewAssetNode.update({
        where: { id: categoryId },
        data: {
          status: 'trashed',
          trashedAt: new Date(),
          trashedByUserId: owner,
        },
      });
      await expect(prepare(task)).rejects.toThrow(
        'category folder is unavailable',
      );
      expect(
        await db.crewTaskDeliveryFolder.count({ where: { taskId: task.id } }),
      ).toBe(0);
    });
    it('creates a categorized delivery folder atomically with a new task', async () => {
      await db.crewAssetNode.update({
        where: { id: categoryId },
        data: { status: 'active', trashedAt: null, trashedByUserId: null },
      });
      const service = new CrewTasksService(
        db as PrismaService,
        new CrewAuthorizationService(db as PrismaService),
        access,
        { send: jest.fn() } as never,
        { broadcastCrewTaskChange: jest.fn() } as never,
        {} as never,
      );
      const input = {
        title: 'New script task',
        description: '',
        taskKind: 'script' as const,
        priority: 'normal' as const,
        assignees: [],
        labelIds: [],
        blockedByTaskIds: [],
        customFieldValues: [],
      };
      const created = await service.create(crewId, owner, input);
      expect(created.deliveryFolder).toMatchObject({ name: 'New script task' });
      const folder = await db.crewAssetNode.findUniqueOrThrow({
        where: { id: created.deliveryFolder!.id },
      });
      expect(folder.parentId).toBe(categoryId);
      await db.crewAssetNode.update({
        where: { id: categoryId },
        data: {
          status: 'trashed',
          trashedAt: new Date(),
          trashedByUserId: owner,
        },
      });
      await expect(
        service.create(crewId, owner, { ...input, title: 'Should roll back' }),
      ).rejects.toThrow('category folder is unavailable');
      expect(
        await db.crewTask.count({
          where: { crewId, title: 'Should roll back' },
        }),
      ).toBe(0);
    });
    it('provisions every bootstrap and template task with real persisted folders', async () => {
      const freshCrew = randomUUID();
      try {
        await db.crew.create({
          data: {
            id: freshCrew,
            name: 'Seed fixture',
            description: '',
            logo: '',
            createdByUserId: owner,
          },
        });
        const state = await db.crewTaskWorkflowState.create({
          data: {
            crewId: freshCrew,
            name: 'Open',
            color: '#888888',
            semantic: 'open',
            createdByUserId: owner,
          },
        });
        const episode = await db.crewEpisode.create({
          data: {
            crewId: freshCrew,
            number: 1,
            title: 'Episode one',
            createdByUserId: owner,
          },
        });
        await db.$transaction(async (tx) => {
          await seedCrewProductionFolders(tx, {
            crewId: freshCrew,
            userId: owner,
            kind: 'series',
            locale: 'en-US',
          });
          await seedCrewProductionTasks(tx, {
            crewId: freshCrew,
            userId: owner,
            kind: 'series',
            locale: 'en-US',
            episodeId: episode.id,
            openWorkflowStateId: state.id,
          });
        });
        const seeded = await db.crewTask.findMany({
          where: { crewId: freshCrew },
          include: { deliveryFolder: { include: { folder: true } } },
        });
        expect(seeded.length).toBeGreaterThan(0);
        expect(
          seeded.every(
            (task) =>
              task.deliveryFolder?.folder.name === task.title ||
              task.deliveryFolder?.folder.name.startsWith(`${task.title} (`),
          ),
        ).toBe(true);
        const templates = new ProjectTaskTemplateService(db as PrismaService);
        const template = await templates.resolveActiveTemplate('series');
        const created = await db.$transaction((tx) =>
          templates.instantiateTasks(tx, freshCrew, template!, {
            userId: owner,
            workflowStateId: state.id,
            episodeId: episode.id,
          }),
        );
        expect(created.length).toBeGreaterThan(0);
        expect(
          await db.crewTaskDeliveryFolder.count({
            where: { taskId: { in: created.map((task) => task.id) } },
          }),
        ).toBe(created.length);
      } finally {
        await db.crewTaskDeliveryFolder.deleteMany({
          where: { crewId: freshCrew },
        });
        await db.crew.deleteMany({ where: { id: freshCrew } });
      }
    });
  },
);
