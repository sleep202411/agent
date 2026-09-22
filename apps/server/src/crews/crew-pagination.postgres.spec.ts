import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { CrewsService } from './crews.service';
import { PositionsService } from './positions.service';
import { CrewAssetsService } from './assets/assets.service';
import { CrewTasksService } from './tasks/tasks.service';

const databaseUrl = process.env.TASK01_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
integration(
  'Crew pagination across equal timestamps (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    let service: CrewsService;
    const ids: string[] = [];
    const name = `pagination-${randomUUID()}`;
    beforeAll(async () => {
      const url = postgresFixtureUrl(databaseUrl!);
      if (
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        url.port !== '5433' ||
        url.pathname !== '/fizzdragon_outbox_test'
      )
        throw new Error('Owned loopback fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
      // Narrow the fixture dataset without changing real ordering or cursor behavior.
      const fixtureDb = db.$extends({
        query: {
          crew: {
            findMany({ args, query }) {
              args.where = { AND: [args.where ?? {}, { id: { in: ids } }] };
              return query(args);
            },
          },
        },
      });
      service = new CrewsService(
        fixtureDb as never,
        {} as never,
        {} as never,
        {} as never,
      );
      for (let i = 0; i < 8; i++) {
        const id = randomUUID();
        ids.push(id);
        await db.crew.create({
          data: {
            id,
            name,
            description: '',
            logo: 'fixture.png',
            createdByUserId: name,
            createdAt: new Date('2099-01-01'),
            listedAt: new Date('2099-01-01'),
            listingStatus: 'listed',
            ownership: {
              create: {
                member: {
                  create: {
                    id: randomUUID(),
                    crewId: id,
                    userId: name,
                    joinedVia: 'creation',
                  },
                },
              },
            },
          },
        });
      }
    });
    afterAll(async () => {
      try {
        await db?.crew.deleteMany({ where: { id: { in: ids } } });
      } finally {
        await db?.$disconnect();
      }
    });
    it.each(['view', 'options'] as const)(
      'rejects a task %s cursor whose title no longer matches the search',
      async (kind) => {
        const crewId = kind === 'view' ? ids[2] : ids[3];
        const title = `target-${randomUUID()}`;
        const workflow = await db.crewTaskWorkflowState.create({
          data: {
            crewId,
            name: 'Open',
            color: '#888888',
            semantic: 'open',
            position: 0,
            createdByUserId: 'fixture',
          },
        });
        const task = await db.crewTask.create({
          data: {
            crewId,
            number: 1,
            title,
            workflowStateId: workflow.id,
            createdByUserId: 'fixture',
          },
        });
        const view = await db.crewTaskView.create({
          data: { crewId, name: 'Fixture', createdByUserId: 'fixture' },
        });
        const tasks = new CrewTasksService(
          db as never,
          { require: () => Promise.resolve({}) } as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
        );
        const read = () =>
          kind === 'view'
            ? tasks.list(crewId, 'fixture', {
                viewId: view.id,
                query: title,
                cursor: task.id,
                limit: 10,
              })
            : tasks.listOptions(crewId, 'fixture', {
                query: title,
                cursor: task.id,
                limit: 10,
                activeOnly: false,
              });
        await expect(read()).resolves.toMatchObject({
          items: [],
          nextCursor: null,
        });
        await db.crewTask.update({
          where: { id: task.id },
          data: { title: 'No longer matches' },
        });
        await expect(read()).rejects.toMatchObject({
          status: 400,
          response: { code: 'CREW_TASK_CURSOR_INVALID' },
        });
      },
    );
    it.each(['trash', 'rename'] as const)(
      'rejects an asset cursor removed from its active view by %s',
      async (change) => {
        const node = await db.crewAssetNode.create({
          data: {
            crewId: ids[0],
            kind: 'folder',
            name: `target-${randomUUID()}`,
            createdByUserId: 'fixture',
            updatedByUserId: 'fixture',
          },
        });
        const assets = new CrewAssetsService(
          db as never,
          {} as never,
          { require: () => Promise.resolve({}) } as never,
          {
            resolveNodesPermissions: () => Promise.resolve(new Map()),
          } as never,
          {} as never,
          {} as never,
          {} as never,
        );
        const query = {
          source: 'all' as const,
          sort: 'name' as const,
          query: 'target-',
          cursor: node.id,
        };
        // A hidden ACL boundary remains a valid cursor; access is filtered after paging.
        await expect(
          assets.list(ids[0], 'fixture', query),
        ).resolves.toMatchObject({ items: [], nextCursor: null });
        await db.crewAssetNode.update({
          where: { id: node.id },
          data:
            change === 'trash'
              ? {
                  status: 'trashed',
                  trashedAt: new Date(),
                  trashedByUserId: 'fixture',
                }
              : { name: 'outside-search' },
        });
        await expect(
          assets.list(ids[0], 'fixture', query),
        ).rejects.toMatchObject({
          status: 400,
          response: { code: 'CREW_ASSET_CURSOR_INVALID' },
        });
      },
    );
    it.each(['search', 'moderation'] as const)(
      'rejects a recruitment cursor outside its %s filter and retains valid cursors',
      async (kind) => {
        const id = randomUUID();
        await db.crewPosition.create({
          data: {
            id,
            crewId: ids[0],
            positionType: 'storyboard',
            description: 'fixture',
            targetCount: 1,
          },
        });
        const positions = new PositionsService(db as never, {} as never);
        const filter =
          kind === 'search'
            ? { q: randomUUID() }
            : { moderationStatus: 'taken_down' as const };
        await expect(
          positions.adminList({ ...filter, cursor: id }),
        ).rejects.toMatchObject({ status: 400 });
        await expect(
          positions.adminList({ q: id, cursor: id }),
        ).resolves.toMatchObject({ items: [], nextCursor: null });
      },
    );
    it.each(['public', 'admin'] as const)(
      'rejects a %s cursor outside the current filters',
      async (kind) => {
        const id = ids[0];
        await db.crew.update({
          where: { id },
          data:
            kind === 'public'
              ? { listingStatus: 'unlisted' }
              : { name: 'outside-filter' },
        });
        try {
          const result =
            kind === 'public'
              ? service.list({ cursor: id })
              : service.adminList({ q: name, cursor: id });
          await expect(result).rejects.toMatchObject({ status: 400 });
        } finally {
          await db.crew.update({
            where: { id },
            data: { name, listingStatus: 'listed' },
          });
        }
      },
    );
    it.each(['public', 'admin'] as const)(
      'does not lose or repeat tied %s rows after a non-ordering edit',
      async (kind) => {
        const list = (
          cursor?: string,
        ): Promise<{ items: { id: string }[]; nextCursor: string | null }> =>
          kind === 'public'
            ? service.list({ limit: 2, cursor })
            : service.adminList({ q: name, limit: 2, cursor });
        const first = await list();
        const seen = first.items.map((row) => row.id);
        expect(seen.every((id) => ids.includes(id))).toBe(true);
        await db.crew.update({
          where: { id: seen[0] },
          data: { description: 'Edited without changing listing dates' },
        });
        let cursor = first.nextCursor;
        for (let page = 0; cursor && page < 8; page++) {
          const next = await list(cursor);
          seen.push(
            ...next.items.map((row) => row.id).filter((id) => ids.includes(id)),
          );
          cursor = next.nextCursor;
          if (seen.length >= ids.length) break;
        }
        expect(seen.sort()).toEqual([...ids].sort());
      },
    );
  },
);
