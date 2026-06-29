import { Injectable, NotFoundException } from '@nestjs/common';
import {
  MediaProcessingJobStatus,
  MediaProcessingJobType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';

export interface EnqueueMediaProcessingJobInput {
  assetId: string;
  jobType: MediaProcessingJobType;
  sourceVariantId?: string | null;
  priority?: number;
  input?: Prisma.InputJsonValue;
  idempotencyKey?: string | null;
  createdByAdminId?: string | null;
}

@Injectable()
export class MediaProcessingService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueueJob(input: EnqueueMediaProcessingJobInput) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: input.assetId, deletedAt: null },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException('媒体资产不存在或已删除。');

    const data = {
      assetId: input.assetId,
      sourceVariantId: input.sourceVariantId ?? null,
      jobType: input.jobType,
      status: MediaProcessingJobStatus.pending,
      priority: input.priority ?? 100,
      input: input.input ?? {},
      idempotencyKey: input.idempotencyKey ?? null,
      createdByAdminId: input.createdByAdminId ?? null,
      nextAttemptAt: null,
      lockedAt: null,
      lockedBy: null,
      errorMessage: null,
      deadAt: null,
    } satisfies Prisma.MediaProcessingJobUncheckedCreateInput;

    if (!input.idempotencyKey) {
      return this.prisma.mediaProcessingJob.create({ data });
    }

    return this.prisma.mediaProcessingJob.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: data,
      // A re-enqueue is a fresh run: reset the retry budget (`attempt`) AND
      // clear `output` (provider task state like `immTaskId`). Without this a
      // previously dead-lettered job would re-poll its stale terminal task and
      // dead-letter again on the first transient error — i.e. backfill / retry
      // would be non-functional for stateful jobs (e.g. hls_stream).
      update: {
        status: MediaProcessingJobStatus.pending,
        priority: data.priority,
        input: data.input,
        attempt: 0,
        output: {},
        nextAttemptAt: null,
        lockedAt: null,
        lockedBy: null,
        errorMessage: null,
        deadAt: null,
      },
    });
  }

  async retryJob(jobId: string) {
    return this.prisma.mediaProcessingJob.update({
      where: { id: jobId },
      data: {
        status: MediaProcessingJobStatus.pending,
        // Fresh run — see enqueueJob's update branch.
        attempt: 0,
        output: {},
        nextAttemptAt: null,
        lockedAt: null,
        lockedBy: null,
        errorMessage: null,
        deadAt: null,
      },
    });
  }

  async enqueueOriginalPlacementBackfill(
    assetId: string,
    createdByAdminId?: string | null,
  ) {
    return this.enqueueJob({
      assetId,
      jobType: MediaProcessingJobType.backfill_original_placement,
      priority: 10,
      idempotencyKey: `media-backfill-original-placement:${assetId}`,
      createdByAdminId,
    });
  }
}
