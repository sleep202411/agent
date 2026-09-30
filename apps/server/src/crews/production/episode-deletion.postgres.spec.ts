import { extendPrismaQueries } from '../../common/__tests__/prisma-query-extension';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConflictException } from '@nestjs/common';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import type { PrismaService } from '../../infra/db/db.module';
import { CrewProductionService } from './production.service';
const databaseUrl = process.env.TASK01_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
integration(
  'Crew episode deletion preserves concurrent delivery history',
  () => {
    let db: PrismaClient;
    let crewId: string;
    let episodeId: string;
    let assetNodeId: string;
    let mediaId: string;
    const userId = 'episode-deletion-fixture';
    const broadcast = jest.fn().mockResolvedValue(undefined);
    const authorization = { require: jest.fn().mockResolvedValue(undefined) };
    const service = (client: unknown = db, assetAccess: unknown = {}) =>
      new CrewProductionService(
        client as PrismaService,
        authorization as never,
        assetAccess as never,
        { broadcastCrewTaskProjectChange: broadcast } as never,
        {} as never,

        { revoke: jest.fn().mockResolvedValue(undefined) } as never,
      );
    beforeAll(async () => {
      const url = postgresFixtureUrl(databaseUrl!);
      if (
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        url.port !== '55439' ||
        url.pathname !== '/task01'
      )
        throw new Error('Owned loopback task01 fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
      await db.$connect();
    });
    beforeEach(async () => {
      jest.clearAllMocks();
      crewId = randomUUID();
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Episode deletion fixture',
          description: '',
          logo: 'fixture.png',
          createdByUserId: userId,
        },
      });
      episodeId = (
        await db.crewEpisode.create({
          data: {
            crewId,
            number: 1,
            title: 'Final cut',
            createdByUserId: userId,
          },
        })
      ).id;
      mediaId = (
        await db.mediaAsset.create({
          data: {
            kind: 'video',
            status: 'ready',
            storageProvider: 's3_compatible',
            bucket: 'test',
            objectKey: randomUUID(),
            sizeBytes: 60n,
          },
        })
      ).id;
      assetNodeId = (
        await db.crewAssetNode.create({
          data: {
            crewId,
            kind: 'file',
            mediaAssetId: mediaId,
            name: 'final.mp4',
            createdByUserId: userId,
            updatedByUserId: userId,
          },
        })
      ).id;
    });
    afterEach(async () => {
      await db.crewEpisodeDelivery.deleteMany({ where: { crewId } });
      await db.crewEpisode.deleteMany({ where: { crewId } });
      await db.crewAssetNode.deleteMany({ where: { crewId } });
      await db.mediaAsset.delete({ where: { id: mediaId } });
      await db.crew.delete({ where: { id: crewId } });
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    const addDelivery = () =>
      db.crewEpisodeDelivery.create({
        data: {
          crewId,
          episodeId,
          assetNodeId,
          versionNumber: 1,
          submittedByUserId: userId,
        },
      });
    it('rejects deletion when a final cut commits after the opening read', async () => {
      let openingRead = true;
      // Another editor commits their delivery after deletion has read an empty episode.
      const concurrentClient = extendPrismaQueries(db, {
        query: {
          crewEpisode: {
            async findUnique({ args, query }) {
              const snapshot = await query(args);
              if (openingRead) {
                openingRead = false;
                await addDelivery();
              }
              return snapshot;
            },
          },
        },
      });
      await expect(
        service(concurrentClient).deleteEpisode(episodeId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await db.crewEpisode.count({ where: { id: episodeId } })).toBe(1);
      expect(await db.crewEpisodeDelivery.count({ where: { episodeId } })).toBe(
        1,
      );
      expect(broadcast).not.toHaveBeenCalled();
    });
    it('rejects a delivery when the episode is cancelled after its opening read', async () => {
      const assetAccess = {
        requireNodePermission: jest.fn(async () => {
          await db.crewEpisode.update({
            where: { id: episodeId },
            data: { status: 'cancelled', version: { increment: 1 } },
          });
        }),
      };
      await expect(
        service(db, assetAccess).submitDelivery(episodeId, userId, {
          assetNodeId,
          note: 'Final cut',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await db.crewEpisodeDelivery.count({ where: { episodeId } })).toBe(
        0,
      );
      expect(
        (await db.crewEpisode.findUniqueOrThrow({ where: { id: episodeId } }))
          .status,
      ).toBe('cancelled');
      expect(broadcast).not.toHaveBeenCalled();
    });

    it('still accepts a ready video for an active episode', async () => {
      await service(db, {
        requireNodePermission: jest.fn().mockResolvedValue(undefined),
      }).submitDelivery(episodeId, userId, { assetNodeId, note: 'Final cut' });
      expect(await db.crewEpisodeDelivery.count({ where: { episodeId } })).toBe(
        1,
      );
      expect(
        (await db.crewEpisode.findUniqueOrThrow({ where: { id: episodeId } }))
          .status,
      ).toBe('in_review');
    });

    it('keeps existing delivery history', async () => {
      await addDelivery();
      await expect(
        service().deleteEpisode(episodeId, userId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await db.crewEpisodeDelivery.count({ where: { episodeId } })).toBe(
        1,
      );
    });
    it('still deletes an empty episode and announces the change', async () => {
      await service().deleteEpisode(episodeId, userId);
      expect(await db.crewEpisode.count({ where: { id: episodeId } })).toBe(0);
      expect(broadcast).toHaveBeenCalledWith(
        crewId,
        'episode',
        episodeId,
        'deleted',
        userId,
      );
    });
  },
);
