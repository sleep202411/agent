import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  Injectable,
  ConflictException,
  ServiceUnavailableException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import type { MediaStorageProvider, StoryboardExportJob } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { StorageProviderRegistry } from '../infra/storage/storage-provider-registry.service';
import { crewAssetStorageProviderForCell } from '../infra/storage/crew-asset-storage-policy';
import { CURRENT_CELL } from '../common/region/current-cell';
import { StudioDocumentAccessService } from '../documents/studio-document-access.service';
import { MediaAccessService } from '../media/media-access.service';
import { StoryboardExportQueueService } from './storyboard-export-queue.service';
import { reauthorizeStoryboardJob } from './reauthorize-storyboard-job';

interface OutputRow {
  object_key: string;
  job_id: string | null;
  provider: MediaStorageProvider;
  bucket: string;
  region: string | null;
  status: string;
  due: boolean;
}

@Injectable()
export class StoryboardExportOutputService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: StorageProviderRegistry,
    private readonly documents: StudioDocumentAccessService,
    private readonly media: MediaAccessService,
    private readonly queue: StoryboardExportQueueService,
  ) {}

  /** Validate signing configuration before enqueueing expensive render work.
   * Signing does not create an object or expose this capability to the client. */
  async assertConfigured() {
    const storage = this.registry.forProvider(
      crewAssetStorageProviderForCell(CURRENT_CELL),
    );
    if (!storage)
      throw new ServiceUnavailableException(
        'Private export storage is unavailable.',
      );
    await storage.createPrivateUploadUrl({
      storageKey: `storyboard-exports/config-check/${randomUUID()}.mp4`,
      contentType: 'video/mp4',
      maxBytes: 1,
      expiresInSeconds: 60,
    });
  }

  async download(userId: string, id: string) {
    z.uuid().parse(id);
    return this.prisma.$transaction(
      async (tx) => {
        const job = await tx.storyboardExportJob.findFirst({
          where: { id, userId },
        });
        if (!job || job.status !== 'completed')
          throw new NotFoundException('Completed export not found.');
        await reauthorizeStoryboardJob(tx, this.documents, this.media, job);
        const ref = z
          .strictObject({
            storageProvider: z.enum([
              'azure_blob',
              'aliyun_oss',
              's3_compatible',
            ]),
            bucket: z.string().min(1),
            region: z.string().nullable(),
            objectKey: z.string().min(1),
            contentType: z.literal('video/mp4'),
            sizeBytes: z
              .number()
              .int()
              .positive()
              .max(512 * 1024 * 1024),
          })
          .parse(job.outputRef);
        const [row] = await tx.$queryRaw<
          OutputRow[]
        >`SELECT *,next_attempt_at<=now() AS due FROM storyboard_export_outputs WHERE object_key=${ref.objectKey} AND job_id=${id}::uuid AND status='published'`;
        if (
          !row ||
          row.provider !== ref.storageProvider ||
          row.bucket !== ref.bucket ||
          row.region !== ref.region
        )
          throw new NotFoundException('Export output is no longer available.');
        const storage = this.registry.forProvider(ref.storageProvider);
        if (!storage)
          throw new ServiceUnavailableException(
            'Export download storage is unavailable.',
          );
        const ttl = Math.min(
          60,
          Math.floor((job.expiresAt.getTime() - Date.now()) / 1000),
        );
        if (ttl < 1) throw new NotFoundException('Export has expired.');
        const signed = await storage.createReadUrl({
          bucket: ref.bucket,
          region: ref.region,
          storageKey: ref.objectKey,
          contentType: 'video/mp4',
          filename: 'storyboard.mp4',
          cacheControl: 'private, no-store',
          expiresInSeconds: ttl,
        });
        const url = new URL(signed.url);
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          !(Date.parse(signed.expiresAt) > Date.now())
        )
          throw new ServiceUnavailableException(
            'Export download URL is invalid.',
          );
        return { url: signed.url, expiresAt: signed.expiresAt };
      },
      { timeout: 30_000 },
    );
  }

  /** Only accepts the owned file returned by the renderer. Placement recovery is
   * durable before PUT; no write capability is returned to the browser. */
  async upload(
    job: StoryboardExportJob,
    filePath: string,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const info = await stat(filePath);
    if (!info.isFile() || info.size <= 0 || info.size > 512 * 1024 * 1024)
      throw new Error('Export output exceeds the size limit.');
    const storage = this.registry.forProvider(
      crewAssetStorageProviderForCell(CURRENT_CELL),
    );
    if (!storage)
      throw new ServiceUnavailableException(
        'Private export storage is unavailable.',
      );
    const key = `storyboard-exports/${job.id}/${randomUUID()}.mp4`;
    const placement = await storage.createPrivateUploadUrl({
      storageKey: key,
      contentType: 'video/mp4',
      maxBytes: info.size,
      expiresInSeconds: 300,
    });
    const target = new URL(placement.url);
    if (
      placement.storageKey !== key ||
      !placement.bucket ||
      placement.provider !== storage.providerId ||
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      !(Date.parse(placement.expiresAt) > Date.now())
    )
      throw new ServiceUnavailableException(
        'Private export destination is invalid.',
      );
    await this.prisma
      .$executeRaw`INSERT INTO storyboard_export_outputs(object_key,job_id,provider,bucket,region) VALUES(${key},${job.id}::uuid,${placement.provider}::"MediaStorageProvider",${placement.bucket},${placement.region})`;
    const body = createReadStream(filePath);
    try {
      const options = {
        method: 'PUT',
        headers: {
          ...placement.headers,
          'content-type': 'video/mp4',
          'content-length': String(info.size),
        },
        body: body as unknown as BodyInit,
        duplex: 'half',
        signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
        redirect: 'error' as const,
      };
      const response = await fetch(target, options);
      await response.body?.cancel();
      if (!response.ok)
        throw new ServiceUnavailableException('Private export upload failed.');
    } finally {
      body.destroy();
    }
    signal.throwIfAborted();
    const stored = await storage.headStoredObject({
      bucket: placement.bucket,
      region: placement.region,
      storageKey: key,
    });
    if (
      !stored.exists ||
      stored.sizeBytes !== info.size ||
      stored.contentType?.split(';')[0].trim().toLowerCase() !== 'video/mp4'
    )
      throw new ServiceUnavailableException(
        'Private export upload verification failed.',
      );
    return { key, sizeBytes: info.size };
  }

  async publish(
    job: StoryboardExportJob,
    leaseToken: string,
    output: { key: string; sizeBytes: number },
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`storyboard-output:${output.key}`},0))`;
        const [row] = await tx.$queryRaw<
          OutputRow[]
        >`SELECT *,next_attempt_at<=now() AS due FROM storyboard_export_outputs WHERE object_key=${output.key}`;
        if (!row || row.job_id !== job.id || row.status !== 'pending')
          throw new ConflictException(
            'Export output is no longer publishable.',
          );
        await reauthorizeStoryboardJob(tx, this.documents, this.media, job);
        const published = await this.queue.complete(
          job.id,
          leaseToken,
          {
            storageProvider: row.provider,
            bucket: row.bucket,
            region: row.region,
            objectKey: row.object_key,
            contentType: 'video/mp4',
            sizeBytes: output.sizeBytes,
          },
          tx,
        );
        if (!published)
          throw new ConflictException('Export worker lease was lost.');
        await tx.$executeRaw`UPDATE storyboard_export_outputs SET status='published',next_attempt_at=${job.expiresAt} WHERE object_key=${output.key}`;
        return true;
      },
      { timeout: 30_000 },
    );
  }

  async cleanup(key: string) {
    const retired = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`storyboard-output:${key}`},0))`;
      const [row] = await tx.$queryRaw<
        OutputRow[]
      >`SELECT *,next_attempt_at<=now() AS due FROM storyboard_export_outputs WHERE object_key=${key}`;
      if (!row || !row.due) return null;
      const job = row.job_id
        ? await tx.storyboardExportJob.findUnique({ where: { id: row.job_id } })
        : null;
      const ref = job?.outputRef as { objectKey?: string } | null;
      if (
        job?.status === 'completed' &&
        job.expiresAt > new Date() &&
        ref?.objectKey === key
      ) {
        await tx.$executeRaw`UPDATE storyboard_export_outputs SET next_attempt_at=${job.expiresAt} WHERE object_key=${key}`;
        return null;
      }
      await tx.$executeRaw`UPDATE storyboard_export_outputs SET status='retired',next_attempt_at=now()+interval '15 minutes' WHERE object_key=${key}`;
      return row;
    });
    if (!retired) return;
    const storage = this.registry.forProvider(retired.provider);
    if (!storage)
      throw new ServiceUnavailableException(
        'Export cleanup storage is unavailable.',
      );
    await storage.deleteObject({
      bucket: retired.bucket,
      region: retired.region,
      storageKey: key,
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE storyboard_export_jobs SET output_ref=NULL
        WHERE id=${retired.job_id}::uuid AND output_ref->>'objectKey'=${key}
        AND (status<>'completed' OR expires_at<=now())`;
      await tx.$executeRaw`DELETE FROM storyboard_export_outputs WHERE object_key=${key} AND status='retired'`;
    });
  }

  async sweep() {
    const rows = await this.prisma.$queryRaw<
      Array<{ object_key: string }>
    >`SELECT object_key FROM storyboard_export_outputs WHERE next_attempt_at<=now() ORDER BY next_attempt_at,object_key LIMIT 50`;
    const results = await Promise.allSettled(
      rows.map((row) => this.cleanup(row.object_key)),
    );
    return {
      attempted: results.length,
      failed: results.filter((result) => result.status === 'rejected').length,
    };
  }
}
