import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { CrewAssetsService } from '../../crews/assets/assets.service';
import { ChannelVideosService } from '../../ip-commerce/channel-videos';
import { MediaStorageAccessService } from './media-storage-access.service';
import { randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { S3CompatibleStorageService } from './s3-storage.service';

// Explicit opt-in; credentials and endpoint are owned local fixtures only.
(process.env.S3_LOCAL_INTEGRATION === '1' ? describe : describe.skip)(
  'S3 storage against local MinIO',
  () => {
    const endpoint = 'http://127.0.0.1:59000';
    const publicBucket = `pax-public-${randomUUID()}`;
    const privateBucket = `pax-private-${randomUUID()}`;
    const environment = { ...process.env };
    let client: S3Client;
    let storage: S3CompatibleStorageService;
    const createdBuckets: string[] = [];

    beforeAll(async () => {
      Object.assign(process.env, {
        S3_ENDPOINT: endpoint,
        S3_REGION: 'us-east-1',
        S3_BUCKET: publicBucket,
        S3_PRIVATE_BUCKET: privateBucket,
        S3_ACCESS_KEY_ID: 'pax-local-test',
        S3_ACCESS_KEY_SECRET: 'pax-local-test-only-password',
        S3_FORCE_PATH_STYLE: 'true',
        MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE: `${endpoint}/${publicBucket}`,
      });
      client = new S3Client({
        endpoint,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: {
          accessKeyId: 'pax-local-test',
          secretAccessKey: 'pax-local-test-only-password',
        },
      });
      for (const Bucket of [publicBucket, privateBucket]) {
        await client.send(new CreateBucketCommand({ Bucket }));
        createdBuckets.push(Bucket);
      }
      await client.send(
        new PutBucketPolicyCommand({
          Bucket: publicBucket,
          Policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: '*',
                Action: 's3:GetObject',
                Resource: `arn:aws:s3:::${publicBucket}/*`,
              },
            ],
          }),
        }),
      );
      storage = new S3CompatibleStorageService();
    });

    afterAll(async () => {
      try {
        for (const Bucket of createdBuckets) {
          const objects = await client.send(
            new ListObjectsV2Command({ Bucket }),
          );
          if (objects.Contents?.length)
            await client.send(
              new DeleteObjectsCommand({
                Bucket,
                Delete: {
                  Objects: objects.Contents.map(({ Key }) => ({ Key })),
                },
              }),
            );
          await client.send(new DeleteBucketCommand({ Bucket }));
        }
      } finally {
        client?.destroy();
        (storage as unknown as { client?: S3Client })?.client?.destroy();
        process.env = environment;
      }
    });

    it('resumes/retries multipart bytes, completes exact content and safely aborts/deletes', async () => {
      const chunks = [
        Buffer.alloc(5 * 1024 * 1024, 19),
        Buffer.alloc(17003, 71),
      ];
      const ref = await storage.beginMultipartUpload(
        'video/test.mp4',
        'video/mp4',
      );
      try {
        for (const number of [1, 1, 2]) {
          const signed = await storage.signUploadPart(ref, number);
          const response = await fetch(signed.url, {
            method: 'PUT',
            headers: signed.headers,
            body: new Uint8Array(chunks[number - 1]),
          });
          expect(response.status).toBe(200);
          expect(response.headers.get('etag')).toBeTruthy();
          if (number === 1)
            expect(await storage.listUploadParts(ref)).toHaveLength(1);
        }
        const parts = await storage.listUploadParts(ref);
        expect(parts.map((p) => [p.number, p.sizeBytes])).toEqual([
          [1, chunks[0].length],
          [2, chunks[1].length],
        ]);
        await storage.completeMultipartUpload(ref, parts);
        const read = await storage.createReadUrl(ref);
        const response = await fetch(read.url);
        expect(response.status).toBe(200);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(
          Buffer.concat(chunks),
        );
        await storage.abortMultipartUpload(ref);
        expect((await storage.headStoredObject(ref)).exists).toBe(true);
        await storage.deleteObject(ref);
        await storage.deleteObject(ref);
        expect((await storage.headStoredObject(ref)).exists).toBe(false);
      } finally {
        await storage.abortMultipartUpload(ref);
      }
      const abandoned = await storage.beginMultipartUpload(
        'video/abandoned.mp4',
        'video/mp4',
      );
      await storage.abortMultipartUpload(abandoned);
      await storage.abortMultipartUpload(abandoned);
      expect((await storage.headStoredObject(abandoned)).exists).toBe(false);
    }, 30_000);

    it('keeps submitted Crew bytes and reclaims them only after the final reference is removed', async () => {
      const raw = process.env.TASK01_TEST_DATABASE_URL ?? '';
      const url = postgresFixtureUrl(raw);
      if (
        url.hostname !== '127.0.0.1' ||
        url.port !== '55439' ||
        url.pathname !== '/task01'
      )
        throw new Error('Owned task01 database required');
      const db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: raw }),
      });
      const crewId = randomUUID();
      const assetId = randomUUID();
      const channelId = randomUUID();
      const objectKey = `crew/${assetId}.mp4`;
      const ref = {
        bucket: publicBucket,
        region: 'us-east-1',
        storageKey: objectKey,
      };
      try {
        await storage.upload({
          key: objectKey,
          body: Buffer.from('opaque storage fixture bytes'),
          contentType: 'video/mp4',
        });
        await db.crew.create({
          data: {
            id: crewId,
            name: 'Local retention fixture',
            description: '',
            logo: 'fixture.png',
            createdByUserId: 'fixture',
          },
        });
        await db.mediaAsset.create({
          data: {
            id: assetId,
            kind: 'video',
            source: 'user_upload',
            createdByUserId: 'fixture',
            storageProvider: 's3_compatible',
            bucket: publicBucket,
            region: ref.region,
            objectKey,
            metadata: { uploadKind: 'crew_asset_file', crewId },
          },
        });
        const node = await db.crewAssetNode.create({
          data: {
            crewId,
            kind: 'file',
            status: 'trashed',
            trashedAt: new Date(),
            trashedByUserId: 'fixture',
            name: 'fixture.mp4',
            mediaAssetId: assetId,
            createdByUserId: 'fixture',
            updatedByUserId: 'fixture',
          },
        });
        await db.ip.create({
          data: {
            id: channelId,
            createdById: 'fixture',
            channelType: 'community',
            status: 'published',
            listingVisibility: 'public',
          },
        });
        await db.$executeRaw`INSERT INTO ip_channel_submission_settings(ip_id,open,updated_by_id) VALUES (${channelId}::uuid,true,'fixture')`;
        const mediaStorage = new MediaStorageAccessService(
          undefined as never,
          undefined as never,
          storage,
        );
        const channels = new ChannelVideosService(
          db as never,
          { ensurePublicEngagementTarget: jest.fn() } as never,
          mediaStorage,
        );
        const assets = new CrewAssetsService(
          db as never,
          undefined as never,
          undefined as never,
          { requireNodePermission: jest.fn() } as never,
          undefined as never,
          mediaStorage,
          { broadcastCrewAssetChange: jest.fn() } as never,
        );
        await channels.submit(
          channelId,
          { userId: 'fixture' },
          { assetId, title: 'Retained', description: '' },
        );
        await assets.removePermanently(crewId, 'fixture', node.id);
        expect((await storage.headStoredObject(ref)).exists).toBe(true);
        expect(
          (await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } }))
            .status,
        ).toBe('ready');
        await db.ip.delete({ where: { id: channelId } });
        await assets.reclaimExpiredPendingUpload(
          assetId,
          new Date(Date.now() + 60_000),
        );
        expect((await storage.headStoredObject(ref)).exists).toBe(false);
        expect(
          (await db.mediaAsset.findUniqueOrThrow({ where: { id: assetId } }))
            .status,
        ).toBe('deleted');
      } finally {
        await db.ip.deleteMany({ where: { id: channelId } });
        await db.crew.deleteMany({ where: { id: crewId } });
        await db.mediaAsset.deleteMany({ where: { id: assetId } });
        await db.$disconnect();
      }
    }, 30_000);

    it('pins upload content type and keeps finalized private documents inaccessible anonymously', async () => {
      const bytes = Buffer.from(
        '%PDF-1.7\nLocal private archive fixture\n%%EOF',
      );
      const upload = await storage.createPrivateUploadUrl({
        storageKey: 'archive/pending.pdf',
        contentType: 'application/pdf',
        maxBytes: bytes.length,
      });
      expect(upload.bucket).toBe(privateBucket);
      const rejected = await fetch(upload.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: bytes,
      });
      expect(rejected.status).toBe(403);
      expect(
        (
          await fetch(upload.url, {
            method: 'PUT',
            headers: upload.headers,
            body: bytes,
          })
        ).status,
      ).toBe(200);
      const final = {
        bucket: upload.bucket,
        region: upload.region,
        storageKey: 'archive/final.pdf',
      };
      await storage.promoteObject({
        source: upload,
        destination: final,
        expectedSizeBytes: bytes.length,
        contentType: 'application/pdf',
        cacheControl: 'private, no-store',
      });
      expect(await storage.headStoredObject(final)).toMatchObject({
        exists: true,
        sizeBytes: bytes.length,
        contentType: 'application/pdf',
      });
      expect(
        (await fetch(`${endpoint}/${privateBucket}/${final.storageKey}`))
          .status,
      ).toBe(403);
      const read = await storage.createReadUrl({
        ...final,
        cacheControl: 'private, no-store',
      });
      const response = await fetch(read.url);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
      await storage.deleteObject(final);
      expect((await storage.headStoredObject(final)).exists).toBe(false);
    }, 30_000);
  },
);
