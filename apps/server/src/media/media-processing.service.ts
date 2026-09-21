import { MEDIA_PROCESSING_LOCK_TTL_MS } from './media-worker-leases';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

  /** Replayed upload confirmation reuses its canonical job without resetting it. */
  async enqueueJob(input: EnqueueMediaProcessingJobInput) {
    return this.prisma.$transaction((tx) => this.enqueueJobTx(input, tx));
  }

  /** Administrator callers may explicitly restart an idle job within their authorized transaction. */
  async enqueueJobTx(
    input: EnqueueMediaProcessingJobInput,
    tx: Prisma.TransactionClient,
    restartExisting = false,
  ) {
    if (input.idempotencyKey)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`media:enqueue:${input.idempotencyKey}`})::bigint)`;
    if (input.idempotencyKey)
      await tx.$queryRaw`SELECT id FROM media_processing_jobs WHERE idempotency_key=${input.idempotencyKey} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM media_assets WHERE id=${input.assetId}::uuid FOR SHARE`;
    const asset = await tx.mediaAsset.findFirst({
      where: { id: input.assetId, deletedAt: null },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException('媒体资产不存在或已删除。');
    if (input.sourceVariantId) {
      await tx.$queryRaw`SELECT id FROM media_asset_variants WHERE id=${input.sourceVariantId}::uuid FOR SHARE`;
      const variant = await tx.mediaAssetVariant.findFirst({
        where: {
          id: input.sourceVariantId,
          assetId: input.assetId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!variant)
        throw new NotFoundException(
          'The source variant is unavailable for this asset.',
        );
    }
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
    if (!input.idempotencyKey) return tx.mediaProcessingJob.create({ data });
    const existing = await tx.mediaProcessingJob.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (!existing) return tx.mediaProcessingJob.create({ data });
    if (
      existing.assetId !== input.assetId ||
      existing.jobType !== input.jobType ||
      existing.sourceVariantId !== (input.sourceVariantId ?? null)
    )
      throw new ConflictException(
        'The processing key belongs to a different asset, variant or job type.',
      );
    if (!restartExisting) return existing;
    // Pending includes the interval between remote HLS polls. Resetting that
    // job would discard its task ID and submit another task on the next run.
    const output = existing.output;
    if (
      existing.jobType === MediaProcessingJobType.hls_stream &&
      existing.status === MediaProcessingJobStatus.pending &&
      output !== null &&
      typeof output === 'object' &&
      !Array.isArray(output) &&
      typeof output.immTaskId === 'string' &&
      output.immTaskId.length > 0
    )
      throw new ConflictException(
        'The HLS job is awaiting its remote task result. Wait for processing to finish before restarting.',
      );
    const [clock] = await tx.$queryRaw<
      { nowMs: number }[]
    >`SELECT extract(epoch FROM clock_timestamp())::double precision * 1000 AS "nowMs"`;
    if (
      existing.status === MediaProcessingJobStatus.processing ||
      (existing.lockedAt &&
        existing.lockedAt.getTime() >=
          clock.nowMs - MEDIA_PROCESSING_LOCK_TTL_MS)
    )
      throw new ConflictException(
        'The processing job is active and cannot be restarted.',
      );
    return tx.mediaProcessingJob.update({
      where: { id: existing.id },
      data: {
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
        completedAt: null,
        failedAt: null,
        startedAt: null,
      },
    });
  }

  async retryJob(jobId: string, transaction?: Prisma.TransactionClient) {
    const write = async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM media_processing_jobs WHERE id=${jobId}::uuid FOR UPDATE`;
      const existing = await tx.mediaProcessingJob.findUnique({
        where: { id: jobId },
      });
      if (!existing)
        throw new NotFoundException('Media processing job not found.');
      const [clock] = await tx.$queryRaw<
        { nowMs: number }[]
      >`SELECT extract(epoch FROM clock_timestamp())::double precision * 1000 AS "nowMs"`;
      if (
        ![MediaProcessingJobStatus.failed, MediaProcessingJobStatus.dead].some(
          (status) => status === existing.status,
        ) ||
        (existing.lockedAt &&
          existing.lockedAt.getTime() >=
            clock.nowMs - MEDIA_PROCESSING_LOCK_TTL_MS)
      )
        throw new ConflictException(
          'The processing job is no longer available for retry. Refresh and retry if it fails again.',
        );
      return tx.mediaProcessingJob.update({
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
    };
    return transaction ? write(transaction) : this.prisma.$transaction(write);
  }

  async enqueueOriginalPlacementBackfill(
    assetId: string,
    createdByAdminId?: string | null,
  ) {
    return this.prisma.$transaction((tx) =>
      this.enqueueJobTx(
        {
          assetId,
          jobType: MediaProcessingJobType.backfill_original_placement,
          priority: 10,
          idempotencyKey: `media-backfill-original-placement:${assetId}`,
          createdByAdminId,
        },
        tx,
        true,
      ),
    );
  }
}
