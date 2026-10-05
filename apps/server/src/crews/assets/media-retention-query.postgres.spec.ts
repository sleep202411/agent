import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as Y from 'yjs';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { savedProjectMediaReferences } from './saved-project-media-references';
import { DocumentCompactionService } from '../../documents/document-compaction.service';
import { DocumentAutosaveService } from '../../documents/document-autosave.service';
import { PrismaService } from '../../infra/db/db.module';
const url = process.env.TASK01_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Media retention scans (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    let workspaceId: string;
    let projectId: string;
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55439' ||
        target.pathname !== '/task01'
      )
        throw new Error('Owned loopback fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });
      await db.$connect();
    });
    beforeEach(async () => {
      workspaceId = (
        await db.workspace.create({
          data: {
            name: 'Retention scan',
            ownerUserId: 'fixture',
            createdById: 'fixture',
          },
        })
      ).id;
      projectId = (
        await db.platformProject.create({
          data: { workspaceId, name: 'Scan fixture', createdById: 'fixture' },
        })
      ).id;
    });
    afterEach(async () => {
      await db.workspace.delete({ where: { id: workspaceId } });
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    it('handles mixed non-CRDT references and unreferenced candidates', async () => {
      const referenced = randomUUID(),
        unused = randomUUID();
      await db.studioDocument.create({
        data: {
          workspaceId,
          platformProjectId: projectId,
          type: 'storyboard',
          title: 'Fixture',
          createdById: 'fixture',
          contentSnapshot: { mediaAssetId: referenced },
        },
      });
      expect(
        await savedProjectMediaReferences(db, [referenced, unused]),
      ).toEqual(new Set([referenced]));
    });
    it.each(['snapshot', 'binary', 'version'] as const)(
      'retains case-insensitive UUID references in %s content',
      async (kind) => {
        const referenced = randomUUID();
        const content = {
          nodes: { image: { mediaAssetId: referenced.toUpperCase() } },
        };
        const source = new Y.Doc();
        source.getMap('nodes').set('image', content.nodes.image);
        const state = Buffer.from(Y.encodeStateAsUpdate(source));
        source.destroy();
        const document = await db.studioDocument.create({
          data: {
            workspaceId,
            platformProjectId: projectId,
            type: 'canvas',
            title: 'Imported reference',
            createdById: 'fixture',
            contentSnapshot: kind === 'snapshot' ? content : {},
            crdtState: kind === 'binary' ? state : null,
          },
        });
        if (kind === 'version')
          await db.studioDocumentVersion.create({
            data: {
              documentId: document.id,
              versionNumber: 1,
              sequence: 0,
              schemaVersion: '1',
              snapshot: {},
              crdtState: state,
              createdById: 'fixture',
            },
          });
        expect(await savedProjectMediaReferences(db, [referenced])).toEqual(
          new Set([referenced]),
        );
      },
    );
    it.each([
      ['before', false],
      ['after', false],
      ['before', true],
      ['after', true],
    ] as const)(
      'retains media when real compaction prunes %s the page read (pending dependency: %s)',
      async (timing, pendingDependency) => {
        const mediaId = randomUUID();
        const source = new Y.Doc();
        const node = new Y.Map<unknown>();
        source.getMap('nodes').set('image', node);
        const dependencyVector = Y.encodeStateVector(source);
        node.set('mediaAssetId', mediaId);
        const referenceUpdate = Buffer.from(
          Y.encodeStateAsUpdate(
            source,
            pendingDependency ? dependencyVector : undefined,
          ),
        );
        source.destroy();
        const unrelated = new Y.Doc();
        unrelated.getMap('meta').set('title', 'Unrelated edit');
        const secondUpdate = Buffer.from(Y.encodeStateAsUpdate(unrelated));
        unrelated.destroy();
        const document = await db.studioDocument.create({
          data: {
            workspaceId,
            platformProjectId: projectId,
            type: 'canvas',
            title: 'Compaction fixture',
            createdById: 'fixture',
            contentSnapshot: {},
            currentSequence: 2,
          },
        });
        await db.studioDocumentOperation.createMany({
          data: [referenceUpdate, secondUpdate].map((yjsUpdate, index) => ({
            documentId: document.id,
            sequence: index + 1,
            operationType: 'yjs_update',
            actorUserId: 'fixture',
            yjsUpdate,
          })),
        });
        const savedPrune = process.env.DOCUMENT_OP_PRUNE_ENABLED;
        const savedRetention = process.env.DOCUMENT_OP_PRUNE_RETENTION;
        process.env.DOCUMENT_OP_PRUNE_ENABLED = 'true';
        process.env.DOCUMENT_OP_PRUNE_RETENTION = '1';
        const compactor = new DocumentCompactionService(
          db as unknown as PrismaService,
          { maybeStamp: jest.fn() } as unknown as DocumentAutosaveService,
        );
        if (savedPrune === undefined)
          delete process.env.DOCUMENT_OP_PRUNE_ENABLED;
        else process.env.DOCUMENT_OP_PRUNE_ENABLED = savedPrune;
        if (savedRetention === undefined)
          delete process.env.DOCUMENT_OP_PRUNE_RETENTION;
        else process.env.DOCUMENT_OP_PRUNE_RETENTION = savedRetention;
        let compacted = false;
        const scanningDb = db.$extends({
          query: {
            async $queryRaw({ args, query }) {
              const rows: unknown = await query(args);
              const text = (args as unknown as Prisma.Sql).sql;
              const trigger =
                timing === 'before'
                  ? text.includes('SELECT candidate.id')
                  : text.includes('ORDER BY d.id LIMIT 64');
              if (trigger && !compacted) {
                compacted = true;
                compactor.schedule(document.id);
                await compactor.flush(document.id);
              }
              return rows;
            },
          },
        });
        try {
          expect(
            await savedProjectMediaReferences(scanningDb, [mediaId]),
          ).toEqual(new Set([mediaId]));
          expect(compacted).toBe(true);
          const persisted = await db.studioDocument.findUniqueOrThrow({
            where: { id: document.id },
          });
          expect(persisted.snapshotSequence).toBe(2);
          expect(persisted.crdtState?.length).toBeGreaterThan(0);
          expect(
            await db.studioDocumentOperation.findMany({
              where: { documentId: document.id },
              select: { sequence: true },
            }),
          ).toEqual([{ sequence: 2 }]);
          // Re-read after the source operation is gone: the compacted binary
          // must retain unresolved dependencies as well as visible media.
          expect(await savedProjectMediaReferences(db, [mediaId])).toEqual(
            new Set([mediaId]),
          );
          if (pendingDependency)
            expect(JSON.stringify(persisted.contentSnapshot)).not.toContain(
              mediaId,
            );
        } finally {
          await compactor.onModuleDestroy();
        }
      },
    );
    it('bounds database round trips across document and version histories', async () => {
      const doc = new Y.Doc();
      for (let i = 0; i < 100; i++)
        doc
          .getMap('nodes')
          .set(`node-${i}`, { title: `Shot ${i}`, x: i, y: i });
      const state = Buffer.from(Y.encodeStateAsUpdate(doc));
      doc.destroy();
      const documents = Array.from({ length: 128 }, () => ({
        id: randomUUID(),
        workspaceId,
        platformProjectId: projectId,
        type: 'canvas' as const,
        title: 'Fixture',
        createdById: 'fixture',
        contentSnapshot: {},
        crdtState: state,
      }));
      await db.studioDocument.createMany({ data: documents });
      await db.studioDocumentVersion.createMany({
        data: Array.from({ length: 64 }, (_, index) => ({
          documentId: documents[0].id,
          versionNumber: index + 1,
          sequence: 0,
          schemaVersion: '1',
          snapshot: {},
          crdtState: state,
          createdById: 'fixture',
        })),
      });
      const query = jest.spyOn(db, '$queryRaw');
      try {
        expect(await savedProjectMediaReferences(db, [randomUUID()])).toEqual(
          new Set(),
        );
        expect(query.mock.calls.length).toBeLessThanOrEqual(10);
        const documentRef = randomUUID(),
          versionRef = randomUUID();
        const referenceState = (id: string) => {
          const referenceDoc = new Y.Doc();
          referenceDoc.getMap('nodes').set('image', { mediaAssetId: id });
          const bytes = Buffer.from(Y.encodeStateAsUpdate(referenceDoc));
          referenceDoc.destroy();
          return bytes;
        };
        const lastDocument = documents
          .map((row) => row.id)
          .sort()
          .at(-1)!;
        const lastVersion = await db.studioDocumentVersion.findFirstOrThrow({
          where: { documentId: documents[0].id },
          orderBy: { id: 'desc' },
        });
        await db.studioDocument.update({
          where: { id: lastDocument },
          data: { crdtState: referenceState(documentRef) },
        });
        await db.studioDocumentVersion.update({
          where: { id: lastVersion.id },
          data: { crdtState: referenceState(versionRef) },
        });
        query.mockClear();
        expect(
          await savedProjectMediaReferences(db, [
            documentRef,
            versionRef,
            randomUUID(),
          ]),
        ).toEqual(new Set([documentRef, versionRef]));
        expect(query.mock.calls.length).toBeLessThanOrEqual(10);
      } finally {
        query.mockRestore();
      }
    });
  },
);
