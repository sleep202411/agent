import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { VideoPosterService } from './video-poster.service';

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
const databaseUrl = process.env.TASK01_TEST_DATABASE_URL;
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

(databaseUrl ? describe : describe.skip)(
  'Poster overlap (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    let assetId: string;
    beforeAll(async () => {
      const url = postgresFixtureUrl(databaseUrl!);
      if (
        url.hostname !== '127.0.0.1' ||
        url.port !== '55439' ||
        url.pathname !== '/task01'
      )
        throw new Error('Owned task01 fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
      await db.$connect();
    });
    beforeEach(async () => {
      assetId = (
        await db.mediaAsset.create({
          data: {
            kind: 'video',
            status: 'ready',
            storageProvider: 's3_compatible',
            bucket: 'fixture',
            objectKey: randomUUID(),
          },
        })
      ).id;
      jest
        .mocked(execFile)
        .mockImplementation(((
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, output: Buffer) => void,
        ) => callback(null, bytes)) as never);
    });
    afterEach(async () => {
      await db.mediaAsset.delete({ where: { id: assetId } });
    });
    afterAll(async () => {
      await db?.$disconnect();
    });

    it.each([false, true])(
      'preserves the winning bytes when a delayed attempt resumes (blocked=%s)',
      async (blocked) => {
        const objects = new Map<string, Buffer>();
        const uploaded = deferred();
        const resume = deferred();
        let writes = 0;
        const storage = {
          upload: jest.fn(
            async ({ key, body }: { key: string; body: Buffer }) => {
              objects.set(key, body);
              if (++writes === 1) {
                uploaded.resolve();
                await resume.promise;
              }
              return {
                provider: 's3_compatible',
                bucket: 'fixture',
                region: null,
                storagePath: key,
              };
            },
          ),
          deleteObject: jest.fn(({ storageKey }: { storageKey: string }) => {
            objects.delete(storageKey);
            return Promise.resolve();
          }),
        };
        const service = new VideoPosterService(
          db as never,
          {
            createReadUrl: jest
              .fn()
              .mockResolvedValue({ url: 'https://fixture.invalid/video' }),
          } as never,
          storage as never,
        );
        const delayed = service.generate(assetId).then(
          (value) => ({ value, error: null }),
          (error: unknown) => ({ value: null, error }),
        );
        let winner: { variantId: string };
        try {
          await uploaded.promise;
          winner = await service.generate(assetId);
          if (blocked)
            await db.mediaAsset.update({
              where: { id: assetId },
              data: { moderationStatus: 'blocked' },
            });
        } finally {
          resume.resolve();
        }
        const result = await delayed;
        if (blocked)
          expect(result.error).toEqual(
            new Error('Video is no longer available.'),
          );
        else expect(result.value).toEqual(winner!);
        const placements = await db.mediaObjectPlacement.findMany({
          where: { assetId, status: 'active' },
        });
        expect(placements).toHaveLength(1);
        expect(placements[0].variantId).toBe(winner!.variantId);
        expect(objects.get(placements[0].objectKey!)).toEqual(bytes);
        expect(objects.size).toBe(1);
        expect(storage.deleteObject).toHaveBeenCalledTimes(1);
      },
    );
  },
);
