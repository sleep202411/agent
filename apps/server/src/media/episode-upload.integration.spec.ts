/** Opt-in: local PostgreSQL + MinIO only. Never writes to remote storage/DB. */
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { episodeUploadTestDatabase } from './episode-upload-test-database';
import { EPISODE_UPLOAD_PART_BYTES } from '@repo/shared';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { S3CompatibleStorageService } from '../infra/storage/s3-storage.service';
import { MediaStorageAccessService } from '../infra/storage/media-storage-access.service';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import { EpisodeUploadService } from './episode-upload.service';
import { MediaUploadService } from './media-upload.service';
import { MediaAssetFactsService } from './media-asset-facts.service';

const integration =
  process.env.EPISODE_UPLOAD_INTEGRATION === '1' ? describe : describe.skip;

integration('episode upload against local PostgreSQL and MinIO', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let client: S3Client | undefined;
  let bucketCreated = false;
  let storage: S3CompatibleStorageService;
  let makeService: () => EpisodeUploadService;
  const sessionIds: string[] = [];
  const userId = `upload-test-${randomUUID()}`;
  const bucket = `episode-test-${randomUUID()}`;
  const environment = { ...process.env };

  beforeAll(async () => {
    const databaseUrl = episodeUploadTestDatabase(process.env);
    Object.assign(process.env, {
      S3_ENDPOINT: 'http://127.0.0.1:19000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: bucket,
      S3_ACCESS_KEY_ID: 'fizz-local-test',
      S3_ACCESS_KEY_SECRET: 'fizz-local-test-password',
      S3_FORCE_PATH_STYLE: 'true',
      MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE: `http://127.0.0.1:19000/${bucket}`,
    });
    client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'fizz-local-test',
        secretAccessKey: 'fizz-local-test-password',
      },
    });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    bucketCreated = true;
    prisma = buildPrisma(databaseUrl);
    storage = new S3CompatibleStorageService();
    const access = new MediaStorageAccessService(
      undefined as never,
      undefined as never,
      storage,
    );
    const registry = { forProvider: () => storage };
    const uploads = new MediaUploadService(
      prisma as PrismaService,
      storage,
      new MediaAssetUrlResolverService(),
      {} as never,
      { enqueueAutomaticChecks: () => Promise.resolve(undefined) } as never,
      {} as never,
      {} as never,
      new MediaAssetFactsService(prisma as PrismaService, access),
      registry as never,
      {} as never,
    );
    makeService = () =>
      new EpisodeUploadService(
        prisma as PrismaService,
        uploads,
        registry as never,
      );
  });

  afterAll(async () => {
    const errors: unknown[] = [];
    try {
      if (prisma) {
        const sessions = await prisma.episodeUpload.findMany({
          where: { id: { in: sessionIds } },
        });
        for (const session of sessions) {
          if (session.bucket && session.uploadId)
            await storage.abortMultipartUpload({
              ...session,
              bucket: session.bucket,
              uploadId: session.uploadId,
            });
        }
        await prisma.mediaAsset.deleteMany({
          where: { createdByUserId: userId },
        });
        await prisma.episodeUpload.deleteMany({
          where: { id: { in: sessionIds } },
        });
      }
    } catch (error) {
      errors.push(error);
    }
    try {
      if (client && bucketCreated) {
        // The random bucket belongs exclusively to this fixture.
        while (true) {
          const page = await client.send(
            new ListObjectsV2Command({ Bucket: bucket }),
          );
          const objects =
            page.Contents?.flatMap((object) =>
              object.Key ? [{ Key: object.Key }] : [],
            ) ?? [];
          if (objects.length === 0) break;
          const deleted = await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: objects },
            }),
          );
          if (deleted.Errors?.length)
            throw new Error('Fixture object cleanup failed');
        }
        await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      }
    } catch (error) {
      errors.push(error);
    }
    client?.destroy();
    try {
      await prisma?.$disconnect();
    } catch (error) {
      errors.push(error);
    } finally {
      process.env = environment;
    }
    if (errors.length)
      throw new AggregateError(errors, 'Upload fixture cleanup failed');
  });

  it('resumes after service restart, preserves every byte and creates exactly one playable asset', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'episode-upload-'));
    try {
      const path = join(directory, 'video.mp4');
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=160x90:r=24',
        '-t',
        '1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        path,
      ]);
      // A valid MP4 free atom exercises three real parts without fake sizes or
      // costly video encoding. ffprobe must still read it through the signed URL.
      const padding = Buffer.alloc(EPISODE_UPLOAD_PART_BYTES * 2);
      padding.writeUInt32BE(padding.length, 0);
      padding.write('free', 4);
      const bytes = Buffer.concat([readFileSync(path), padding]);
      const id = randomUUID();
      sessionIds.push(id);
      const first = makeService();
      const session = await first.start(userId, {
        id,
        fileName: 'episode.mp4',
        contentType: 'video/mp4',
        sizeBytes: bytes.length,
      });
      const put = async (service: EpisodeUploadService, number: number) => {
        const signed = await service.signPart(userId, id, number);
        const response = await fetch(signed.url, {
          method: 'PUT',
          headers: signed.headers,
          body: new Uint8Array(
            bytes.subarray(
              (number - 1) * session.partSize,
              number * session.partSize,
            ),
          ),
        });
        expect(response.status).toBe(200);
      };
      await put(first, 1);
      const restarted = makeService();
      expect((await restarted.status(userId, id)).parts).toEqual([
        { number: 1, sizeBytes: session.partSize },
      ]);
      await expect(restarted.complete(userId, id)).rejects.toThrow(
        'incomplete',
      );
      await Promise.all([put(restarted, 2), put(restarted, 3)]);
      const result = await restarted.complete(userId, id);
      expect((await makeService().complete(userId, id)).mediaAssetId).toBe(
        result.mediaAssetId,
      );
      const assets = await prisma.mediaAsset.findMany({
        where: { createdByUserId: userId, objectKey: result.storageKey },
        include: { variants: true },
      });
      expect(assets).toHaveLength(1);
      expect(assets[0].sizeBytes).toBe(BigInt(bytes.length));
      expect(assets[0].durationSeconds).toBe(1);
      expect(
        assets[0].variants.some((variant) => variant.variantKey === 'original'),
      ).toBe(true);
      const signed = await storage.createReadUrl({
        storageKey: result.storageKey,
        bucket,
      });
      const downloaded = Buffer.from(
        await (await fetch(signed.url)).arrayBuffer(),
      );
      const sha256 = (data: Buffer) =>
        createHash('sha256').update(data).digest('hex');
      expect(sha256(downloaded)).toBe(sha256(bytes));
      await restarted.cancel(userId, id);
      expect((await storage.headObject(result.storageKey)).sizeBytes).toBe(
        bytes.length,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('cancels actual stored parts and rejects subsequent signing', async () => {
    const service = makeService();
    const id = randomUUID();
    sessionIds.push(id);
    await service.start(userId, {
      id,
      fileName: 'cancel.mp4',
      contentType: 'video/mp4',
      sizeBytes: 8,
    });
    const signed = await service.signPart(userId, id, 1);
    expect(
      (
        await fetch(signed.url, {
          method: 'PUT',
          headers: signed.headers,
          body: '12345678',
        })
      ).ok,
    ).toBe(true);
    await service.cancel(userId, id);
    await expect(service.signPart(userId, id, 1)).rejects.toThrow('expired');
  });
});
