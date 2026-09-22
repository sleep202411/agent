/**
 * Repair existing single-output generation URLs using authoritative asset identity.
 * Run from apps/server: npx tsx scripts/repair-canvas-generation-urls.ts
 *   --document=<uuid> --assets=<uuid>,<uuid> [--allow-remote] [--write]
 * Dry-run is the default. No generation, output, or media asset row is changed.
 */
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import * as Y from 'yjs';
import { PrismaService } from '../src/infra/db/db.module';
import { resolveMediaPublicUrl } from '../src/infra/storage/media-asset-url-resolver.service';
import { repairCanvasGenerationUrls } from '../src/documents/canvas-generation-url-repair';
import { DocumentCompactionService } from '../src/documents/document-compaction.service';
import { DocumentAutosaveService } from '../src/documents/document-autosave.service';

const args = process.argv.slice(2);
const documentId = args.find((a) => a.startsWith('--document='))?.slice(11);
const assetIds = [
  ...new Set(
    args
      .find((a) => a.startsWith('--assets='))
      ?.slice(9)
      .split(',') ?? [],
  ),
];
const write = args.includes('--write');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function targets(db: Prisma.TransactionClient, id: string) {
  const document = await db.studioDocument.findUniqueOrThrow({ where: { id } });
  if (
    document.type !== 'canvas' ||
    document.status !== 'active' ||
    document.deletedAt ||
    !document.platformProjectId
  ) {
    throw new Error('Expected an active platform canvas');
  }
  const jobs = await db.aiJob.findMany({
    where: {
      documentId: id,
      projectId: document.platformProjectId,
      status: 'completed',
      deletedAt: null,
      outputs: { some: { assetId: { in: assetIds }, deletedAt: null } },
    },
    include: {
      outputs: {
        where: { deletedAt: null },
        include: {
          asset: {
            include: {
              placements: true,
              variants: { include: { placements: true } },
            },
          },
        },
      },
    },
  });
  return assetIds.map((assetId) => {
    const matches = jobs.flatMap((job) =>
      job.outputs
        .filter((o) => o.assetId === assetId)
        .map((output) => ({ job, output })),
    );
    if (matches.length !== 1)
      throw new Error(`Ambiguous/missing job for ${assetId}`);
    const { job, output } = matches[0];
    if (!job.documentBlockId || !output.asset || output.type !== 'video')
      throw new Error(`Invalid video output ${assetId}`);
    // Never copy ai_outputs.url: it can contain the storage API URL captured at upload.
    const url = resolveMediaPublicUrl(output.asset);
    if (!url || !output.asset.sizeBytes)
      throw new Error(`Asset is not publicly resolvable: ${assetId}`);
    return {
      nodeId: job.documentBlockId,
      jobId: job.id,
      assetId,
      url,
      bytes: output.asset.sizeBytes.toString(),
    };
  });
}

async function probe(url: string, bytes: string) {
  const response = await fetch(url, {
    headers: { Range: 'bytes=0-31' },
    signal: AbortSignal.timeout(20_000),
  });
  try {
    if (
      response.status !== 206 ||
      response.headers.get('content-range') !== `bytes 0-31/${bytes}` ||
      !response.headers.get('content-type')?.startsWith('video/')
    ) {
      throw new Error(`Public video probe failed: HTTP ${response.status}`);
    }
    const header = Buffer.from(await response.arrayBuffer());
    if (header.length !== 32 || header.toString('ascii', 4, 8) !== 'ftyp')
      throw new Error('Invalid MP4 header');
  } finally {
    if (response.body && !response.bodyUsed) await response.body.cancel();
  }
}

async function main() {
  if (
    !documentId ||
    !uuid.test(documentId) ||
    !assetIds.length ||
    assetIds.some((id) => !uuid.test(id)) ||
    args.some(
      (a) =>
        !a.startsWith('--document=') &&
        !a.startsWith('--assets=') &&
        !['--write', '--allow-remote'].includes(a),
    )
  ) {
    throw new Error(
      'Use --document=<uuid> --assets=<uuid>,<uuid> [--allow-remote] [--write]',
    );
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(databaseUrl).hostname,
    ) &&
    !args.includes('--allow-remote')
  ) {
    throw new Error('Remote database access requires --allow-remote');
  }
  if (write && !process.env.REDIS_URL)
    throw new Error('REDIS_URL is required for live peer notification');
  const prisma = new PrismaService();
  const compaction = new DocumentCompactionService(
    prisma,
    new DocumentAutosaveService(prisma),
  );
  try {
    const planned = await targets(prisma, documentId);
    // Probe before locking the document. Storage network latency never holds the edit lock.
    for (const target of planned) await probe(target.url, target.bytes);
    const result = await prisma.$transaction(
      async (tx) => {
        if (!write) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        if (write) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`platform-document:${documentId}`})::bigint)`;
          await tx.$queryRaw`SELECT id FROM studio_documents WHERE id=${documentId}::uuid FOR UPDATE`;
        }
        const fresh = await targets(tx, documentId);
        if (JSON.stringify(fresh) !== JSON.stringify(planned))
          throw new Error('Asset identity changed after validation');
        const document = await tx.studioDocument.findUniqueOrThrow({
          where: { id: documentId },
        });
        if (
          !document.crdtState ||
          document.currentSequence !== document.snapshotSequence
        ) {
          throw new Error(
            'Canvas is not fully compacted; retry after compaction',
          );
        }
        const doc = new Y.Doc();
        try {
          for (const root of ['meta', 'nodes', 'edges', 'groups', 'assets'])
            doc.getMap(root);
          Y.applyUpdate(doc, new Uint8Array(document.crdtState));
          const beforeSnapshot = doc.toJSON();
          const vector = Y.encodeStateVector(doc);
          const changes = repairCanvasGenerationUrls(doc, fresh);
          if (!write || !changes.length) return { changes, operation: null };

          // A full pre-repair checkpoint makes even a future operation-prune reversible.
          const last = await tx.studioDocumentVersion.findFirst({
            where: { documentId },
            orderBy: { versionNumber: 'desc' },
          });
          await tx.studioDocumentVersion.create({
            data: {
              documentId,
              versionNumber: (last?.versionNumber ?? 0) + 1,
              schemaVersion: document.schemaVersion,
              sequence: document.currentSequence,
              title: document.title,
              source: 'system',
              label: 'Before generation URL repair',
              createdById: 'system',
              snapshot: beforeSnapshot as Prisma.InputJsonValue,
              crdtState: document.crdtState,
              metadata: { reason: 'canvas_generation_url_repair_backup' },
            },
          });
          const idempotencyKey = `canvas-generation-urls:${createHash('sha256')
            .update(
              JSON.stringify({
                documentId,
                sequence: document.currentSequence,
                changes,
              }),
            )
            .digest('hex')}`;
          const operation = await tx.studioDocumentOperation.create({
            data: {
              documentId,
              sequence: document.currentSequence + 1,
              operationType: 'yjs_update',
              actorUserId: 'system',
              clientMutationId: idempotencyKey,
              idempotencyKey,
              yjsUpdate: Buffer.from(Y.encodeStateAsUpdate(doc, vector)),
              metadata: { reason: 'canvas_generation_url_repair', changes },
            },
          });
          await tx.studioDocument.update({
            where: { id: documentId },
            data: {
              currentSequence: operation.sequence,
              updatedById: 'system',
              version: { increment: 1 },
            },
          });
          return { changes, operation };
        } finally {
          doc.destroy();
        }
      },
      { timeout: 30_000 },
    );

    if (result.operation) {
      console.log(
        JSON.stringify({
          phase: 'committed',
          documentId,
          sequence: result.operation.sequence,
          changes: result.changes,
        }),
      );
      // Use the normal compactor, the sole writer of CRDT snapshots.
      compaction.schedule(documentId);
      await compaction.flush(documentId);
      const persisted = await prisma.studioDocument.findUniqueOrThrow({
        where: { id: documentId },
      });
      if (persisted.snapshotSequence < result.operation.sequence)
        throw new Error('Repair committed but compaction incomplete');
      const redis = new Redis(process.env.REDIS_URL!, {
        maxRetriesPerRequest: 1,
        connectTimeout: 5_000,
      });
      try {
        const { yjsUpdate, ...op } = result.operation;
        await redis.publish(
          `document:events:${documentId}`,
          JSON.stringify({
            event: 'document_operation',
            originSocketId: 'system-media-url-repair',
            data: {
              ...op,
              yjsUpdateBase64: Buffer.from(yjsUpdate!).toString('base64'),
            },
          }),
        );
      } finally {
        redis.disconnect();
      }
    }
    console.log(
      JSON.stringify({
        phase: 'complete',
        mode: write ? 'write' : 'dry-run',
        documentId,
        sequence: result.operation?.sequence ?? null,
        changes: result.changes,
      }),
    );
  } finally {
    await compaction.onModuleDestroy();
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
