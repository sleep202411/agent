import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  Prisma,
  StudioDocumentStatus,
  StudioDocumentType,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { backgroundTasksEnabled } from '../common/background-tasks';
import { encodeDocumentSnapshot } from './document-crdt';
import { rootSchemaFor } from './document-modes';

/**
 * Enforces the invariant that every active CRDT-backed document has a complete
 * binary state. It also performs the deterministic conversion for imported
 * materialized snapshots (including Story canvases migrated from JSON).
 */
@Injectable()
export class StudioDocumentStateService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StudioDocumentStateService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    let converted = 0;
    for (;;) {
      const rows = await this.prisma.studioDocument.findMany({
        where: {
          crdtState: null,
          type: { in: [StudioDocumentType.canvas, StudioDocumentType.brief] },
          status: StudioDocumentStatus.active,
          deletedAt: null,
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
      if (rows.length === 0) break;
      let batchConverted = 0;
      for (const row of rows) {
        if (await this.initialize(row.id)) {
          converted += 1;
          batchConverted += 1;
        }
      }
      // Rows for non-CRDT modes intentionally keep crdtState null.
      if (batchConverted === 0) break;
    }
    if (converted > 0) {
      this.logger.log(
        `initialized CRDT state for ${converted} Studio documents`,
      );
    }
  }

  async initialize(documentId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`studio-document:${documentId}`})::bigint)
      `;
      const document = await tx.studioDocument.findFirst({
        where: { id: documentId, deletedAt: null },
      });
      if (!document || document.crdtState) return false;
      const schema = rootSchemaFor(document.type);
      if (!schema) return false;

      const encoded = encodeDocumentSnapshot(document.contentSnapshot, schema);
      await tx.studioDocument.update({
        where: { id: document.id },
        data: {
          crdtState: Buffer.from(encoded.state),
          contentSnapshot: encoded.snapshot as unknown as Prisma.InputJsonValue,
          snapshotSequence: document.currentSequence,
          lastCompactedAt: new Date(),
        },
      });
      if (document.currentVersionId) {
        await tx.studioDocumentVersion.updateMany({
          where: { id: document.currentVersionId, crdtState: null },
          data: {
            crdtState: Buffer.from(encoded.state),
            snapshot: encoded.snapshot as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return true;
    });
  }
}
