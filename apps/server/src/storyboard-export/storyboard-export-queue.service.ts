import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 3;

/** Internal worker coordination. A lease is not an authorization grant: workers
 * must revalidate the saved document and media before rendering and publishing. */
@Injectable()
export class StoryboardExportQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async claim() {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM storyboard_export_jobs
        WHERE expires_at > now() AND document_id IS NOT NULL
          AND NOT cancel_requested AND attempts < ${MAX_ATTEMPTS}
          AND (status = 'queued' OR (status = 'running' AND lease_expires_at <= now()))
        ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!rows[0]) return null;
      return tx.storyboardExportJob.update({
        where: { id: rows[0].id },
        data: {
          status: 'running',
          attempts: { increment: 1 },
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        },
      });
    });
  }

  async heartbeat(id: string, leaseToken: string) {
    const result = await this.prisma.storyboardExportJob.updateMany({
      where: this.liveLease(id, leaseToken),
      data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
    });
    return result.count === 1;
  }

  /** The caller owns cleanup of an uploaded output if this returns false.
   * Keep source usages for completed jobs until expiry so access/moderation
   * can be checked again at download time. */
  async complete(
    id: string,
    leaseToken: string,
    outputRef: Prisma.InputJsonObject,
    db: Pick<Prisma.TransactionClient, 'storyboardExportJob'> = this.prisma,
  ) {
    const result = await db.storyboardExportJob.updateMany({
      where: this.liveLease(id, leaseToken),
      data: {
        status: 'completed',
        outputRef,
        error: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    return result.count === 1;
  }

  async fail(id: string, leaseToken: string, publicError: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.storyboardExportJob.updateMany({
        where: this.liveLease(id, leaseToken),
        data: {
          status: 'failed',
          error: publicError.slice(0, 1000),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (result.count) await releaseSources(tx, id);
      return result.count === 1;
    });
  }

  /** Bounded housekeeping. Expired outputs retain their private reference until
   * the storage cleanup worker has successfully deleted the object. */
  async sweep() {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          expired: boolean;
          cancel: boolean;
          missing: boolean;
        }>
      >`
        SELECT id, status, expires_at <= now() AS expired,
          cancel_requested AS cancel, document_id IS NULL AS missing
        FROM storyboard_export_jobs
        WHERE status IN ('queued','running','completed')
          AND (expires_at <= now() OR document_id IS NULL OR cancel_requested
            OR (status = 'running' AND lease_expires_at <= now() AND attempts >= ${MAX_ATTEMPTS}))
        ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 100`;
      for (const row of rows) {
        await tx.storyboardExportJob.update({
          where: { id: row.id },
          data: {
            status: row.expired
              ? 'expired'
              : row.cancel
                ? 'cancelled'
                : 'failed',
            error:
              row.expired || row.cancel
                ? null
                : row.missing
                  ? 'The source canvas is no longer available.'
                  : 'Export could not finish after repeated worker interruptions. Please try again.',
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        await releaseSources(tx, row.id);
      }
      return rows.length;
    });
  }

  private liveLease(
    id: string,
    leaseToken: string,
  ): Prisma.StoryboardExportJobWhereInput {
    const now = new Date();
    return {
      id,
      leaseToken,
      status: 'running',
      cancelRequested: false,
      documentId: { not: null },
      leaseExpiresAt: { gt: now },
      expiresAt: { gt: now },
    };
  }
}

async function releaseSources(tx: Prisma.TransactionClient, jobId: string) {
  await tx.mediaAssetUsage.updateMany({
    where: { storyboardExportJobId: jobId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}
