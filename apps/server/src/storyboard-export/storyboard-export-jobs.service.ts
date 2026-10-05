import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type StoryboardExportJob } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../infra/db/db.module';
import { StudioDocumentAccessService } from '../documents/studio-document-access.service';
import { MediaAccessService } from '../media/media-access.service';
import { captureAuthorizedStoryboard } from './authorized-storyboard';
const dimension = z
  .number()
  .int()
  .min(64)
  .max(1920)
  .refine((value) => value % 2 === 0);
export const CreateStoryboardExport = z.strictObject({
  requestId: z.uuid(),
  documentId: z.uuid(),
  expectedSequence: z.number().int().nonnegative(),
  width: dimension,
  height: dimension,
});

@Injectable()
export class StoryboardExportJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: StudioDocumentAccessService,
    private readonly media: MediaAccessService,
  ) {}
  async create(userId: string, raw: z.input<typeof CreateStoryboardExport>) {
    z.string().min(1).max(64).parse(userId);
    const input = CreateStoryboardExport.parse(raw);
    await this.documents.requireDocumentRef(userId, input.documentId, 'read');
    const requestHash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    return this.prisma.$transaction(
      async (tx) => {
        // One admission lock per account protects both request replay and capacity.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`storyboard-export:${userId}`},0))`;
        const previous = await tx.storyboardExportJob.findUnique({
          where: { userId_requestId: { userId, requestId: input.requestId } },
        });
        if (previous) {
          if (previous.requestHash !== requestHash)
            throw new ConflictException(
              'This export request was already used with different settings.',
            );
          await this.documents.requireDocumentRef(
            userId,
            input.documentId,
            'read',
          );
          return publicExportJob(previous);
        }
        const active = await tx.storyboardExportJob.count({
          where: {
            userId,
            status: { in: ['queued', 'running'] },
            expiresAt: { gt: new Date() },
          },
        });
        if (active >= 3)
          throw new ConflictException(
            'Three exports are already in progress. Wait for one to finish or cancel it.',
          );
        const captured = await captureAuthorizedStoryboard(
          tx,
          this.documents,
          this.media,
          userId,
          input.documentId,
          input.expectedSequence,
        );
        const job = await tx.storyboardExportJob.create({
          data: {
            requestId: input.requestId,
            requestHash,
            userId,
            documentId: input.documentId,
            sequence: captured.sequence,
            width: input.width,
            height: input.height,
            clips: captured.clips as unknown as Prisma.InputJsonValue,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
        for (const assetId of new Set(
          captured.clips.map((clip) => clip.source.assetId),
        )) {
          await tx.mediaAssetUsage.create({
            data: {
              assetId,
              userId,
              workspaceId: captured.document.workspaceId,
              projectId: captured.document.platformProjectId,
              storyboardExportJobId: job.id,
              surface: 'canvas',
              sourceSurface: 'storyboard_export',
              role: 'reference',
              idempotencyKey: `storyboard-export:${job.id}:${assetId}`,
            },
          });
        }
        return publicExportJob(job);
      },
      { timeout: 30_000 },
    );
  }
  async get(userId: string, id: string) {
    z.uuid().parse(id);
    const job = await this.prisma.storyboardExportJob.findFirst({
      where: { id, userId },
    });
    if (!job || !job.documentId)
      throw new NotFoundException('Export not found.');
    await this.documents.requireDocumentRef(userId, job.documentId, 'read');
    return publicExportJob(job);
  }

  async list(userId: string, documentId: string) {
    z.uuid().parse(documentId);
    await this.documents.requireDocumentRef(userId, documentId, 'read');
    const jobs = await this.prisma.storyboardExportJob.findMany({
      where: { userId, documentId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
    });
    return jobs.map(publicExportJob);
  }

  async cancel(userId: string, id: string) {
    z.uuid().parse(id);
    return this.prisma.$transaction(async (tx) => {
      // Owners may cancel even after losing canvas access. Scope the lock to
      // their account so a guessed ID cannot disclose another person's job.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM storyboard_export_jobs WHERE id = ${id}::uuid AND user_id = ${userId} FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Export not found.');
      await tx.storyboardExportJob.updateMany({
        where: { id, status: { in: ['queued', 'running'] } },
        data: {
          status: 'cancelled',
          cancelRequested: true,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      const job = await tx.storyboardExportJob.findUniqueOrThrow({
        where: { id },
      });
      if (job.status === 'cancelled') {
        await tx.mediaAssetUsage.updateMany({
          where: { storyboardExportJobId: id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
      }
      return { id: job.id, status: job.status };
    });
  }
}
export function publicExportJob(job: StoryboardExportJob) {
  return {
    id: job.id,
    documentId: job.documentId,
    sequence: job.sequence,
    width: job.width,
    height: job.height,
    status: job.expiresAt.getTime() <= Date.now() ? 'expired' : job.status,
    cancelRequested: job.cancelRequested,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt.toISOString(),
  };
}
