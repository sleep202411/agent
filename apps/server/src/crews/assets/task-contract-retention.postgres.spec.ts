import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { CrewAssetsService } from './assets.service';
import { requireAvailableTaskContractAsset } from './task-contract-retention';

const url = process.env.CONTRACT_RETENTION_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Task contract attachment/deletion race (owned PostgreSQL)',
  () => {
    let db: PrismaClient, contender: PrismaClient;
    const app = `contract-race-${randomUUID()}`;
    const crews: string[] = [];
    const mediaIds: string[] = [];
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55441' ||
        target.pathname !== '/audit_migrations_20261005'
      )
        throw new Error('Dedicated loopback contract fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
        transactionOptions: { timeout: 15000 },
      });
      contender = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url, application_name: app }),
        transactionOptions: { timeout: 15000 },
      });
      await Promise.all([db.$connect(), contender.$connect()]);
    });
    afterAll(async () => {
      if (db) {
        await db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            'SET LOCAL session_replication_role = replica',
          );
          await tx.crewTaskContractFile.deleteMany({
            where: { task: { crewId: { in: crews } } },
          });
        });
        await db.crew.deleteMany({ where: { id: { in: crews } } });
        await db.mediaAsset.deleteMany({ where: { id: { in: mediaIds } } });
        await db.$disconnect();
      }
      await contender?.$disconnect();
    });
    function assets(client: PrismaClient) {
      return new CrewAssetsService(
        client as never,
        undefined as never,
        undefined as never,
        {
          requireNodePermission: jest.fn().mockResolvedValue('manage'),
        } as never,
        undefined as never,
        { deleteObject: jest.fn() } as never,
        { broadcastCrewAssetChange: jest.fn() } as never,
      );
    }
    it.each(['attach', 'trash'] as const)(
      'serializes when %s commits first',
      async (first) => {
        const crew = await db.crew.create({
          data: {
            id: randomUUID(),
            name: 'Contract race fixture',
            description: 'Fixture',
            logo: 'fixture',
            createdByUserId: 'fixture',
          },
        });
        crews.push(crew.id);
        const state = await db.crewTaskWorkflowState.create({
          data: {
            crewId: crew.id,
            name: 'Todo',
            color: '#ffffff',
            semantic: 'open',
            createdByUserId: 'fixture',
          },
        });
        const media = await db.mediaAsset.create({
          data: {
            kind: 'document',
            status: 'ready',
            storageProvider: 's3_compatible',
            bucket: 'fixture',
            objectKey: randomUUID(),
            metadata: { uploadKind: 'crew_asset_file', crewId: crew.id },
          },
        });
        mediaIds.push(media.id);
        const node = await db.crewAssetNode.create({
          data: {
            crewId: crew.id,
            kind: 'file',
            status: 'active',
            name: 'Contract.pdf',
            mediaAssetId: media.id,
            createdByUserId: 'fixture',
            updatedByUserId: 'fixture',
          },
        });
        const task = await db.crewTask.create({
          data: {
            crewId: crew.id,
            number: 1,
            title: 'Contract fixture',
            workflowStateId: state.id,
            createdByUserId: 'fixture',
          },
        });
        const attach = (client: PrismaClient) =>
          client.$transaction(async (tx) => {
            await requireAvailableTaskContractAsset(tx, crew.id, node.id);
            await tx.crewTask.update({
              where: { id: task.id },
              data: { metadata: { contractAssetNodeId: node.id } },
            });
          });
        let release!: () => void, ready!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const started = new Promise<void>((resolve) => {
          ready = resolve;
        });
        const transaction: <T>(
          callback: (tx: Prisma.TransactionClient) => Promise<T>,
        ) => Promise<T> = db.$transaction.bind(db) as typeof transaction;
        const spy = jest.spyOn(db, '$transaction').mockImplementationOnce(((
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) =>
          transaction(async (tx) => {
            const result = await callback(tx);
            ready();
            await gate;
            return result;
          })) as typeof db.$transaction);
        const held =
          first === 'attach'
            ? attach(db)
            : assets(db).trash(crew.id, 'fixture', node.id);
        let waiting: Promise<unknown> | undefined;
        try {
          await Promise.race([
            started,
            held.then(() => {
              throw new Error('Transaction did not reach gate');
            }),
          ]);
          waiting = (
            first === 'attach'
              ? assets(contender).trash(crew.id, 'fixture', node.id)
              : attach(contender)
          ).then(
            () => ({ ok: true }),
            (error: unknown) => ({ error }),
          );
          let blocked = false;
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            const rows = await db.$queryRaw<
              { blocked: boolean }[]
            >`SELECT EXISTS (
          SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE a.application_name = ${app} AND l.locktype = 'advisory' AND NOT l.granted
        ) AS blocked`;
            if (rows[0]?.blocked) {
              blocked = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          expect(blocked).toBe(true);
          release();
          await held;
          const result = await waiting;
          if (first === 'attach') {
            expect(result).toMatchObject({
              error: { response: { code: 'CREW_TASK_CONTRACT_LOCKED' } },
            });
            expect(
              await db.crewAssetNode.findUnique({ where: { id: node.id } }),
            ).toMatchObject({ status: 'active' });
            expect(
              await db.crewTask.findUnique({ where: { id: task.id } }),
            ).toMatchObject({ metadata: { contractAssetNodeId: node.id } });
            for (const input of [{ name: 'Changed.pdf' }, { parentId: null }]) {
              await expect(
                assets(db).update(crew.id, 'fixture', node.id, {
                  ...input,
                  expectedUpdatedAt: node.updatedAt.toISOString(),
                }),
              ).rejects.toMatchObject({
                response: { code: 'CREW_TASK_CONTRACT_LOCKED' },
              });
            }
            await db.crewTask.update({
              where: { id: task.id },
              data: { deletedAt: new Date() },
            });
            await expect(
              assets(db).update(crew.id, 'fixture', node.id, {
                name: 'Changed-after-archive.pdf',
                expectedUpdatedAt: node.updatedAt.toISOString(),
              }),
            ).rejects.toMatchObject({
              response: { code: 'CREW_TASK_CONTRACT_LOCKED' },
            });
            expect(
              await db.crewAssetNode.findUnique({ where: { id: node.id } }),
            ).toMatchObject({ name: 'Contract.pdf', parentId: null });
          } else {
            expect(result).toMatchObject({
              error: {
                response: {
                  message: 'The contract file is unavailable in this crew.',
                },
              },
            });
            expect(
              await db.crewAssetNode.findUnique({ where: { id: node.id } }),
            ).toMatchObject({ status: 'trashed' });
            expect(
              (await db.crewTask.findUnique({ where: { id: task.id } }))
                ?.metadata,
            ).toBeNull();
          }
        } finally {
          release();
          await Promise.allSettled([held, ...(waiting ? [waiting] : [])]);
          spy.mockRestore();
        }
      },
      20000,
    );
  },
);
