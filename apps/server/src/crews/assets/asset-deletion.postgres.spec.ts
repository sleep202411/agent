import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { CrewAssetsService } from './assets.service';
const url = process.env.TASK01_TEST_DATABASE_URL;
const app = `crew-delete-${randomUUID()}`;
(url ? describe : describe.skip)(
  'Crew asset deletion (owned PostgreSQL)',
  () => {
    let db: PrismaClient,
      service: CrewAssetsService,
      crewId: string,
      nodeId: string,
      mediaId: string;
    const storage = { deleteObject: jest.fn() };
    const conversations = { broadcastCrewAssetChange: jest.fn() };
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55439' ||
        target.pathname !== '/task01'
      )
        throw Error('Owned loopback fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url, application_name: app }),
        transactionOptions: { timeout: 15000 },
      });
      await db.$connect();
      service = new CrewAssetsService(
        db as never,
        undefined as never,
        undefined as never,
        {
          requireNodePermission: jest.fn().mockResolvedValue('manage'),
        } as never,
        undefined as never,
        storage as never,
        conversations as never,
      );
    });
    beforeEach(async () => {
      storage.deleteObject.mockReset().mockResolvedValue(undefined);
      conversations.broadcastCrewAssetChange
        .mockReset()
        .mockResolvedValue(undefined);
      crewId = randomUUID();
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Deletion fixture',
          description: 'Fixture',
          logo: 'fixture.png',
          createdByUserId: 'fixture',
        },
      });
      const media = await db.mediaAsset.create({
        data: {
          kind: 'image',
          status: 'ready',
          storageProvider: 's3_compatible',
          bucket: 'fixture',
          objectKey: randomUUID(),
          metadata: { uploadKind: 'crew_asset_file', crewId },
        },
      });
      mediaId = media.id;
      const node = await db.crewAssetNode.create({
        data: {
          crewId,
          kind: 'file',
          status: 'trashed',
          trashedAt: new Date(),
          trashedByUserId: 'fixture',
          name: 'fixture.png',
          mediaAssetId: mediaId,
          createdByUserId: 'fixture',
          updatedByUserId: 'fixture',
        },
      });
      nodeId = node.id;
    });
    afterEach(async () => {
      await db.crew.delete({ where: { id: crewId } });
      await db.mediaAsset.delete({ where: { id: mediaId } });
    });
    afterAll(async () => db?.$disconnect());
    it('does not delete a file restored by an overlapping transaction', async () => {
      let release!: () => void, ready!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const started = new Promise<void>((r) => {
        ready = r;
      });
      const restoration = db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crew:asset-tree:${crewId}`})::bigint)`;
        await tx.crewAssetNode.update({
          where: { id: nodeId },
          data: { status: 'active', trashedAt: null, trashedByUserId: null },
        });
        ready();
        await gate;
      });
      await started;
      const deletion = service
        .removePermanently(crewId, 'fixture', nodeId)
        .then(
          () => null,
          (e: unknown) => e,
        );
      try {
        const deadline = Date.now() + 5000;
        while (true) {
          const [row] = await db.$queryRaw<
            Array<{ count: bigint }>
          >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${app} AND wait_event_type='Lock'`;
          if (Number(row.count)) break;
          if (Date.now() > deadline) throw Error('Deletion did not wait');
          await new Promise((r) => setTimeout(r, 10));
        }
      } finally {
        release();
        await restoration;
      }
      expect(await deletion).toMatchObject({ status: 404 });
      expect(
        await db.crewAssetNode.findUnique({ where: { id: nodeId } }),
      ).toMatchObject({ status: 'active' });
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
    it('keeps bytes and the trashed node if the database transaction rolls back', async () => {
      const transaction: <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
      ) => Promise<T> = db.$transaction.bind(db) as typeof db.$transaction;
      const injected = jest.spyOn(db, '$transaction').mockImplementationOnce(((
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) =>
        transaction(async (tx) => {
          await callback(tx);
          throw new Error('Injected rollback');
        })) as never);
      try {
        await expect(
          service.removePermanently(crewId, 'fixture', nodeId),
        ).rejects.toThrow('Injected rollback');
      } finally {
        injected.mockRestore();
      }
      expect(
        await db.crewAssetNode.findUnique({ where: { id: nodeId } }),
      ).toMatchObject({ status: 'trashed' });
      expect(
        await db.mediaAsset.findUnique({ where: { id: mediaId } }),
      ).toMatchObject({ status: 'ready', deletedAt: null });
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
    it('persists failed storage cleanup and retries retired placements after restart', async () => {
      await db.mediaObjectPlacement.create({
        data: {
          assetId: mediaId,
          storageProvider: 's3_compatible',
          bucket: 'fixture-copy',
          objectKey: randomUUID(),
          region: 'fixture',
          status: 'active',
        },
      });
      storage.deleteObject.mockRejectedValueOnce(
        new Error('Storage unavailable'),
      );
      await service.removePermanently(crewId, 'fixture', nodeId);
      expect(
        await db.crewAssetNode.findUnique({ where: { id: nodeId } }),
      ).toBeNull();
      expect(
        await db.mediaAsset.findUnique({ where: { id: mediaId } }),
      ).toMatchObject({
        status: 'deleted',
        metadata: { crewPhysicalDeletionPending: true },
      });
      storage.deleteObject.mockClear();
      await service.reclaimDeletedCrewUpload(mediaId);
      expect(storage.deleteObject).toHaveBeenCalledTimes(2);
      const retired = await db.mediaAsset.findUniqueOrThrow({
        where: { id: mediaId },
      });
      expect(retired.metadata).toEqual({
        uploadKind: 'crew_asset_file',
        crewId,
      });
      storage.deleteObject.mockClear();
      await service.reclaimDeletedCrewUpload(mediaId);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
    it('deletes an uncontested trashed file', async () => {
      await service.removePermanently(crewId, 'fixture', nodeId);
      expect(
        await db.crewAssetNode.findUnique({ where: { id: nodeId } }),
      ).toBeNull();
      expect(
        await db.mediaAsset.findUnique({ where: { id: mediaId } }),
      ).toMatchObject({ status: 'deleted' });
      expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    });
  },
);
