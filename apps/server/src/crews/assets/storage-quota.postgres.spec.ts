import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  cancelCrewUpload,
  completeCrewUpload,
  crewStorageUsage,
  reserveCrewUpload,
} from './storage-quota';

const url =
  process.env.CREW_QUOTA_TEST_DATABASE_URL ??
  process.env.TASK01_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Crew quota native PostgreSQL transactions',
  () => {
    let db: PrismaClient;
    let crewId: string;
    const expires = () => new Date(Date.now() + 60000);
    beforeAll(() => {
      const target = new URL(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        !(
          (target.port === '55441' && target.pathname === '/fizzquota') ||
          (target.port === '55439' && target.pathname === '/task01')
        )
      )
        throw new Error('Only the isolated quota database is allowed');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
        transactionOptions: { timeout: 15000 },
      });
    });
    beforeEach(async () => {
      crewId = randomUUID();
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Quota test',
          description: 'Test',
          logo: 'test.png',
          createdByUserId: 'test-user',
        },
      });
      await db.$executeRaw`UPDATE crews SET storage_limit_bytes=100 WHERE id=${crewId}`;
    });
    afterEach(async () => {
      await db.crew.delete({ where: { id: crewId } });
      await db.mediaAsset.deleteMany({
        where: { metadata: { path: ['crewId'], equals: crewId } },
      });
    });
    afterAll(async () => db.$disconnect());
    const reserve = (key: string, bytes: number, user = 'test-user') =>
      db.$transaction((tx) =>
        reserveCrewUpload(tx, crewId, user, key, bytes, expires()),
      );
    it('allows only one of two concurrent reservations that would exceed capacity', async () => {
      const results = await Promise.allSettled([
        reserve(randomUUID(), 60),
        reserve(randomUUID(), 60),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await crewStorageUsage(db, crewId)).toMatchObject({
        usedBytes: 0,
        reservedBytes: 60,
        remainingBytes: 40,
      });
    });
    it('atomically converts a reservation to actual stored bytes', async () => {
      const key = randomUUID();
      await reserve(key, 70);
      await db.$transaction(async (tx) => {
        await completeCrewUpload(tx, crewId, 'test-user', key, 60);
        await tx.mediaAsset.create({
          data: {
            kind: 'image',
            storageProvider: 's3_compatible',
            bucket: 'test',
            objectKey: randomUUID(),
            sizeBytes: 60n,
            metadata: { crewId },
          },
        });
      });
      expect(await crewStorageUsage(db, crewId)).toMatchObject({
        usedBytes: 60,
        reservedBytes: 0,
        remainingBytes: 40,
      });
      await expect(
        db.$transaction((tx) =>
          completeCrewUpload(tx, crewId, 'test-user', key, 60),
        ),
      ).rejects.toThrow();
    });
    it('rolls back completion when the asset write fails', async () => {
      const key = randomUUID();
      await reserve(key, 70);
      await expect(
        db.$transaction(async (tx) => {
          await completeCrewUpload(tx, crewId, 'test-user', key, 60);
          throw Error('asset write failed');
        }),
      ).rejects.toThrow();
      expect((await crewStorageUsage(db, crewId)).reservedBytes).toBe(70);
      await db.$transaction((tx) =>
        cancelCrewUpload(tx, crewId, 'test-user', key),
      );
      expect((await crewStorageUsage(db, crewId)).reservedBytes).toBe(0);
    });
    it('does not credit a reservation that expires between validation and usage', async () => {
      const key = randomUUID();
      await reserve(key, 70);
      await reserve(randomUUID(), 30);
      await expect(
        db.$transaction(async (tx) => {
          let first = true;
          const query = async (
            sql: TemplateStringsArray | Prisma.Sql,
            ...values: unknown[]
          ) => {
            const result = await tx.$queryRaw<unknown>(sql, ...values);
            if (first) {
              first = false;
              await tx.$executeRaw`UPDATE crew_upload_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE storage_key=${key}`;
            }
            return result;
          };
          await completeCrewUpload(
            {
              $executeRaw: (
                sql: TemplateStringsArray | Prisma.Sql,
                ...values: unknown[]
              ) => tx.$executeRaw(sql, ...values),
              $queryRaw: query as typeof tx.$queryRaw,
            },
            crewId,
            'test-user',
            key,
            90,
          );
        }),
      ).rejects.toThrow('Stored file exceeds');
      expect((await crewStorageUsage(db, crewId)).reservedBytes).toBe(100);
    });

    it('enforces ownership on cancellation and rejects cancelled or expired confirmation', async () => {
      const key = randomUUID();
      await reserve(key, 70);
      await db.$transaction((tx) =>
        cancelCrewUpload(tx, crewId, 'another-user', key),
      );
      expect((await crewStorageUsage(db, crewId)).reservedBytes).toBe(70);
      await db.$transaction((tx) =>
        cancelCrewUpload(tx, crewId, 'test-user', key),
      );
      await expect(
        db.$transaction((tx) =>
          completeCrewUpload(tx, crewId, 'test-user', key, 60),
        ),
      ).rejects.toThrow();
      const expired = randomUUID();
      await reserve(expired, 80);
      await db.$executeRaw`UPDATE crew_upload_reservations SET expires_at=now()-interval '1 second' WHERE storage_key=${expired}`;
      expect((await crewStorageUsage(db, crewId)).remainingBytes).toBe(100);
      await expect(
        db.$transaction((tx) =>
          completeCrewUpload(tx, crewId, 'test-user', expired, 80),
        ),
      ).rejects.toThrow();
    });
    it('counts an asset once across links, retains Trash, and releases deleted bytes', async () => {
      const media = await db.mediaAsset.create({
        data: {
          kind: 'image',
          storageProvider: 's3_compatible',
          bucket: 'test',
          objectKey: randomUUID(),
          sizeBytes: 40n,
          metadata: { crewId },
        },
      });
      for (const name of ['first', 'second'])
        await db.crewAssetNode.create({
          data: {
            crewId,
            name,
            kind: 'file',
            mediaAssetId: media.id,
            createdByUserId: 'test-user',
            updatedByUserId: 'test-user',
          },
        });
      expect((await crewStorageUsage(db, crewId)).usedBytes).toBe(40);
      await db.crewAssetNode.updateMany({
        where: { crewId },
        data: {
          status: 'trashed',
          trashedAt: new Date(),
          trashedByUserId: 'test-user',
        },
      });
      expect((await crewStorageUsage(db, crewId)).usedBytes).toBe(40);
      await db.mediaAsset.update({
        where: { id: media.id },
        data: { deletedAt: new Date(), status: 'deleted' },
      });
      expect((await crewStorageUsage(db, crewId)).usedBytes).toBe(0);
    });
    it('rejects larger stored bytes and fails closed for unknown legacy sizes', async () => {
      const key = randomUUID();
      await reserve(key, 90);
      await expect(
        db.$transaction((tx) =>
          completeCrewUpload(tx, crewId, 'test-user', key, 101),
        ),
      ).rejects.toThrow();
      await db.mediaAsset.create({
        data: {
          kind: 'image',
          storageProvider: 's3_compatible',
          bucket: 'test',
          objectKey: randomUUID(),
          metadata: { crewId },
        },
      });
      await expect(reserve(randomUUID(), 1)).rejects.toThrow(
        'awaiting size verification',
      );
    });
  },
);
