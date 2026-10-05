import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { CrewTaskDisputesService } from './task-disputes';
const url = process.env.DISPUTE_LIST_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Dispute lifecycle pagination (owned PostgreSQL)',
  () => {
    let db: PrismaClient,
      service: CrewTaskDisputesService,
      crewId: string,
      taskId: string;
    const alice = randomUUID(),
      bob = randomUUID();
    const ids: Record<string, string> = {};
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55441' ||
        target.pathname !== '/audit_migrations_20261005'
      )
        throw new Error('Owned audit fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });
      service = new CrewTaskDisputesService(db as never, undefined as never);
      crewId = randomUUID();
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Dispute fixture',
          description: 'Fixture',
          logo: 'fixture',
          createdByUserId: alice,
        },
      });
      const state = await db.crewTaskWorkflowState.create({
        data: {
          crewId,
          name: 'Open',
          color: '#888888',
          semantic: 'open',
          createdByUserId: alice,
        },
      });
      const task = await db.crewTask.create({
        data: {
          crewId,
          number: 1,
          title: 'Fixture',
          workflowStateId: state.id,
          createdByUserId: alice,
        },
      });
      taskId = task.id;
      for (const [index, status] of [
        'open',
        'in_review',
        'appealed',
        'resolved',
      ].entries()) {
        ids[status] = randomUUID();
        await db.crewTaskDispute.create({
          data: {
            id: ids[status],
            taskId,
            title: status,
            status,
            ownerAdminId: ['resolved', 'in_review'].includes(status)
              ? randomUUID()
              : null,
            openedByUserId: index % 2 ? bob + index : alice,
            respondentUserId: index % 2 ? alice : bob + index,
            createdAt: new Date('2026-10-05T12:00:00Z'),
          },
        });
      }
      ids.foreign = randomUUID();
      await db.crewTaskDispute.create({
        data: {
          id: ids.foreign,
          taskId,
          title: 'Foreign',
          status: 'resolved',
          ownerAdminId: randomUUID(),
          openedByUserId: randomUUID(),
          respondentUserId: randomUUID(),
        },
      });
    });
    afterAll(async () => {
      if (db && taskId)
        await db.crewTaskDispute.deleteMany({ where: { taskId } });
      if (db && crewId) await db.crew.deleteMany({ where: { id: crewId } });
      await db?.$disconnect();
    });
    it('paginates all active statuses without leaking unrelated or resolved cases', async () => {
      const found: string[] = [];
      let beforeId: string | undefined;
      do {
        const result = await service.list(
          { kind: 'user', id: alice },
          { limit: 1, lifecycle: 'active', beforeId },
        );
        found.push(...result.items.map((row) => row.id));
        beforeId = result.nextBeforeId ?? undefined;
      } while (beforeId);
      expect(found.sort()).toEqual(
        [ids.open, ids.in_review, ids.appealed].sort(),
      );
      expect(new Set(found).size).toBe(3);
    });
    it('combines archived status with participation and validates cursor scope', async () => {
      const actor = { kind: 'user' as const, id: alice };
      expect(
        (
          await service.list(actor, {
            limit: 20,
            lifecycle: 'archived',
            view: 'responses',
          })
        ).items.map((row) => row.id),
      ).toEqual([ids.resolved]);
      expect(
        (
          await service.list(actor, {
            limit: 20,
            lifecycle: 'archived',
            view: 'initiated',
          })
        ).items,
      ).toEqual([]);
      for (const beforeId of [ids.open, ids.foreign])
        await expect(
          service.list(actor, { limit: 20, lifecycle: 'archived', beforeId }),
        ).rejects.toThrow('cursor not found');
      expect(
        (await service.list(actor, { limit: 20, lifecycle: 'all' })).items,
      ).toHaveLength(4);
    });
  },
);
