import { Injectable, Logger } from '@nestjs/common';
import { PlatformDocumentVersionSource, Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import type { MergedDocumentState } from './document-crdt';
import {
  planAutosaveRetention,
  type AutosaveRetentionConfig,
} from './document-autosave';

/**
 * DocumentAutosaveService — stamps background "autosave" version checkpoints as a
 * document settles (called by the compaction service with the freshly-merged
 * state), gated so they don't pile up, and thins old ones near-dense/far-sparse.
 *
 * Layering: this is the automatic safety-net tier of version history. Fine-grained
 * recovery is the client UndoManager; intentional milestones are manual checkpoints
 * ({@link DocumentsService.createVersion}); this fills the gap between them so
 * there is always a recent point to return to without the user saving by hand.
 *
 * Kept separate from compaction (mechanics) and from DocumentsService (which would
 * be a circular dependency); depends only on Prisma. Multi-pod safe: the stamp
 * gate + insert run under the same per-document advisory lock as the op log, so
 * concurrent compactors on different pods cannot double-stamp.
 */
@Injectable()
export class DocumentAutosaveService {
  private readonly logger = new Logger(DocumentAutosaveService.name);
  private readonly config = loadConfig();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Consider stamping an autosave checkpoint for a just-compacted document.
   * No-op when disabled, when nothing changed since the last autosave, or when
   * the last autosave is younger than the minimum interval. Best-effort: never
   * throws into the compaction run.
   */
  async maybeStamp(
    documentId: string,
    merged: MergedDocumentState,
    sequence: number,
  ): Promise<void> {
    if (!this.config.enabled) return;
    // Cheap pre-check outside the lock so we don't take it on every compaction.
    const last = await this.prisma.platformDocumentVersion.findFirst({
      where: { documentId, source: PlatformDocumentVersionSource.autosave },
      orderBy: { createdAt: 'desc' },
      select: { sequence: true, createdAt: true },
    });
    if (!this.shouldStamp(last, sequence, Date.now())) return;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`platform-document:${documentId}`})::bigint)
        `;
        // Re-check under the lock so concurrent compactors don't double-stamp.
        const fresh = await tx.platformDocumentVersion.findFirst({
          where: { documentId, source: PlatformDocumentVersionSource.autosave },
          orderBy: { createdAt: 'desc' },
          select: { sequence: true, createdAt: true },
        });
        if (!this.shouldStamp(fresh, sequence, Date.now())) return;

        const doc = await tx.platformDocument.findFirst({
          where: { id: documentId, deletedAt: null },
          select: {
            title: true,
            schemaVersion: true,
            updatedById: true,
            createdById: true,
          },
        });
        if (!doc) return;

        const lastNumber = await tx.platformDocumentVersion.findFirst({
          where: { documentId },
          orderBy: { versionNumber: 'desc' },
          select: { versionNumber: true },
        });
        await tx.platformDocumentVersion.create({
          data: {
            documentId,
            versionNumber: (lastNumber?.versionNumber ?? 0) + 1,
            schemaVersion: doc.schemaVersion,
            sequence,
            title: doc.title,
            source: PlatformDocumentVersionSource.autosave,
            snapshot: merged.snapshot as unknown as Prisma.InputJsonValue,
            crdtState: Buffer.from(merged.state),
            metadata: { reason: 'autosave' },
            // Attribute to the last editor; falls back to the creator.
            createdById: doc.updatedById ?? doc.createdById,
          },
        });
      });

      await this.prune(documentId);
    } catch (err) {
      // Autosave is best-effort — never let it break a compaction run.
      this.logger.warn(
        `autosave stamp failed for document ${documentId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private shouldStamp(
    last: { sequence: number; createdAt: Date } | null,
    sequence: number,
    nowMs: number,
  ): boolean {
    if (!last) return true; // first autosave
    if (sequence <= last.sequence) return false; // nothing changed since
    return nowMs - last.createdAt.getTime() >= this.config.minIntervalMs;
  }

  /** Thin old autosaves near-dense/far-sparse (manual/system versions untouched). */
  private async prune(documentId: string): Promise<void> {
    const [autosaves, doc] = await Promise.all([
      this.prisma.platformDocumentVersion.findMany({
        where: { documentId, source: PlatformDocumentVersionSource.autosave },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.platformDocument.findUnique({
        where: { id: documentId },
        select: { currentVersionId: true },
      }),
    ]);
    const toDelete = planAutosaveRetention(
      autosaves.map((v) => ({ id: v.id, createdAtMs: v.createdAt.getTime() })),
      Date.now(),
      this.config.retention,
    ).filter((id) => id !== doc?.currentVersionId);
    if (toDelete.length === 0) return;
    // Constrain to source=autosave too, so prune can NEVER touch a manual /
    // system / restore checkpoint even if the id set were ever wrong.
    const deleted = await this.prisma.platformDocumentVersion.deleteMany({
      where: {
        id: { in: toDelete },
        source: PlatformDocumentVersionSource.autosave,
      },
    });
    if (deleted.count > 0) {
      this.logger.debug(
        `pruned ${deleted.count} autosave versions for document ${documentId}`,
      );
    }
  }
}

interface AutosaveConfig {
  enabled: boolean;
  minIntervalMs: number;
  retention: AutosaveRetentionConfig;
}

function loadConfig(): AutosaveConfig {
  return {
    enabled: boolEnv('DOCUMENT_AUTOSAVE_ENABLED', true),
    minIntervalMs: posIntEnv('DOCUMENT_AUTOSAVE_MIN_INTERVAL_MS', 300_000),
    retention: {
      denseWindowMs: posIntEnv('DOCUMENT_AUTOSAVE_DENSE_WINDOW_MS', 3_600_000),
      hourlyWindowMs: posIntEnv(
        'DOCUMENT_AUTOSAVE_HOURLY_WINDOW_MS',
        86_400_000,
      ),
      maxKeep: posIntEnv('DOCUMENT_AUTOSAVE_MAX_KEEP', 200),
    },
  };
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  return raw.trim().toLowerCase() === 'true';
}

function posIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
