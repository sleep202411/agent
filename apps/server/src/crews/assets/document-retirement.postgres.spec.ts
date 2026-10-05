import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { CrewAssetsService } from './assets.service';
import * as Y from 'yjs';
import { CreateDocumentSchema } from '../../documents/dto';
import { CrewTasksService } from '../tasks/tasks.service';
import { DocumentsService } from '../../documents/documents.service';
import { DocumentCompactionService } from '../../documents/document-compaction.service';
import { DocumentStateBuilder } from '../../documents/document-crdt';
import { rootSchemaFor } from '../../documents/document-modes';
const url = process.env.TASK01_TEST_DATABASE_URL;
const app = `crew-delete-${randomUUID()}`;
(url ? describe : describe.skip)(
  'Crew asset deletion (owned PostgreSQL)',
  () => {
    let db: PrismaClient,
      service: CrewAssetsService,
      crewId: string,
      nodeId: string,
      mediaId: string,
      workspaceId: string | undefined;
    const storage = { deleteObject: jest.fn() };
    const conversations = { broadcastCrewAssetChange: jest.fn() };
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55439' ||
        target.pathname !== '/task01'
      )
        throw Error('Owned loopback fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url, application_name: app }),
        transactionOptions: { timeout: 15000 },
      });
      await db.$connect();
      service = new CrewAssetsService(
        db as never,
        undefined as never,
        undefined as never,
        {
          requireNodePermission: jest.fn().mockResolvedValue('manage'),
        } as never,
        undefined as never,
        storage as never,
        conversations as never,
      );
    });
    beforeEach(async () => {
      workspaceId = undefined;
      storage.deleteObject.mockReset().mockResolvedValue(undefined);
      conversations.broadcastCrewAssetChange
        .mockReset()
        .mockResolvedValue(undefined);
      crewId = randomUUID();
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Deletion fixture',
          description: 'Fixture',
          logo: 'fixture.png',
          createdByUserId: 'fixture',
        },
      });
      const media = await db.mediaAsset.create({
        data: {
          kind: 'image',
          status: 'ready',
          storageProvider: 's3_compatible',
          bucket: 'fixture',
          objectKey: randomUUID(),
          metadata: { uploadKind: 'crew_asset_file', crewId },
        },
      });
      mediaId = media.id;
      const node = await db.crewAssetNode.create({
        data: {
          crewId,
          kind: 'file',
          status: 'trashed',
          trashedAt: new Date(),
          trashedByUserId: 'fixture',
          name: 'fixture.png',
          mediaAssetId: mediaId,
          createdByUserId: 'fixture',
          updatedByUserId: 'fixture',
        },
      });
      nodeId = node.id;
    });
    afterEach(async () => {
      if (workspaceId) {
        await db.aiJob.deleteMany({ where: { workspaceId } });
        await db.storyProject.deleteMany({ where: { workspaceId } });
        await db.aiEventOutbox.deleteMany({
          where: { payload: { path: ['workspaceId'], equals: workspaceId } },
        });
        await db.workspace.delete({ where: { id: workspaceId } });
      }
      await db.crew.delete({ where: { id: crewId } });
      await db.mediaAsset.delete({ where: { id: mediaId } });
    });
    afterAll(async () => db?.$disconnect());
    it.each(['snapshot-operation', 'missing-update', 'missing-state'] as const)(
      'rejects %s without overwriting task canvas content',
      async (fault) => {
        workspaceId = (
          await db.workspace.create({
            data: {
              name: 'Invalid canvas',
              ownerUserId: 'fixture',
              createdById: 'fixture',
            },
          })
        ).id;
        const project = await db.platformProject.create({
          data: {
            workspaceId,
            name: 'Invalid canvas',
            createdById: 'fixture',
          },
        });
        const document = await db.studioDocument.create({
          data: {
            workspaceId,
            platformProjectId: project.id,
            type: 'canvas',
            title: 'Invalid canvas',
            createdById: 'fixture',
            contentSnapshot: {
              nodes: { retained: { title: 'Do not discard' } },
            },
            currentSequence: fault === 'missing-state' ? 0 : 1,
          },
        });
        if (fault !== 'missing-state')
          await db.studioDocumentOperation.create({
            data: {
              documentId: document.id,
              sequence: 1,
              actorUserId: 'fixture',
              operationType:
                fault === 'snapshot-operation' ? 'snapshot' : 'yjs_update',
              snapshot: { nodes: { retained: { title: 'Still here' } } },
            },
          });
        const tasks = new CrewTasksService(
          db as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
        );
        const internal = tasks as unknown as {
          materializeCanvasDocumentTx(
            tx: Prisma.TransactionClient,
            id: string,
          ): Promise<unknown>;
        };
        await expect(
          db.$transaction((tx) =>
            internal.materializeCanvasDocumentTx(tx, document.id),
          ),
        ).rejects.toMatchObject({
          status: 409,
          response: {
            code:
              fault === 'missing-state'
                ? 'CREW_TASK_CANVAS_STATE_MISSING'
                : 'CREW_TASK_CANVAS_OPERATION_UNMERGEABLE',
            ...(fault === 'missing-state' ? {} : { sequence: 1 }),
          },
        });
        expect(
          await db.studioDocument.findUniqueOrThrow({
            where: { id: document.id },
          }),
        ).toEqual(document);
        expect(
          await db.studioDocumentOperation.count({
            where: { documentId: document.id },
          }),
        ).toBe(fault === 'missing-state' ? 0 : 1);
      },
    );

    it.each(['server checkpoint', 'client checkpoint'] as const)(
      'includes acknowledged uncompacted edits in a %s',
      async (kind) => {
        workspaceId = (
          await db.workspace.create({
            data: {
              name: 'Checkpoint',
              ownerUserId: 'fixture',
              createdById: 'fixture',
            },
          })
        ).id;
        const project = await db.platformProject.create({
          data: {
            workspaceId,
            name: 'Checkpoint',
            createdById: 'fixture',
          },
        });
        const document = await db.studioDocument.create({
          data: {
            workspaceId,
            platformProjectId: project.id,
            type: 'canvas',
            title: 'Checkpoint',
            createdById: 'fixture',
            contentSnapshot: {},
          },
        });
        const documents = new DocumentsService(
          db as never,
          {} as never,
          { requireDocument: jest.fn() } as never,
          {} as never,
          {} as never,
          { schedule: jest.fn() } as never,
        );
        const source = new Y.Doc();
        source.getMap('nodes').set('image', { mediaAssetId: mediaId, x: 30 });
        const bytes = Buffer.from(Y.encodeStateAsUpdate(source));
        source.destroy();
        await documents.appendOperation(
          { userId: 'fixture' } as never,
          document.id,
          {
            operationType: 'yjs_update',
            metadata: {},
            yjsUpdateBase64: bytes.toString('base64'),
          },
        );
        // A checkpoint may preserve an already-unavailable reference; it must
        // not confuse an acknowledged pending edit with a new attachment.
        if (kind === 'client checkpoint')
          await db.mediaAsset.update({
            where: { id: mediaId },
            data: { status: 'deleted', deletedAt: new Date() },
          });
        const { version } = await documents.createVersion(
          { userId: 'fixture' } as never,
          document.id,
          {
            source: 'manual',
            metadata: {},
            ...(kind === 'client checkpoint'
              ? {
                  crdtStateBase64: bytes.toString('base64'),
                  snapshot: {
                    nodes: { image: { mediaAssetId: mediaId, x: 30 } },
                  },
                }
              : {}),
          },
        );
        const saved = await db.studioDocumentVersion.findUniqueOrThrow({
          where: { id: version.id },
        });
        expect(saved.sequence).toBe(1);
        expect(saved.snapshot).toMatchObject({
          nodes: { image: { mediaAssetId: mediaId, x: 30 } },
        });
        expect(saved.crdtState).not.toBeNull();
        const restored = new DocumentStateBuilder(
          saved.crdtState,
          rootSchemaFor('canvas'),
        );
        try {
          expect(restored.snapshot()).toMatchObject({
            nodes: { image: { mediaAssetId: mediaId, x: 30 } },
          });
        } finally {
          restored.destroy();
        }
      },
    );
    it.each(
      (['before', 'after'] as const).flatMap((timing) =>
        (['operation', 'checkpoint', 'task'] as const).map((save) => ({
          timing,
          save,
        })),
      ),
    )(
      'preserves $save when real compaction prunes $timing its media-state read',
      async ({ timing, save }) => {
        workspaceId = (
          await db.workspace.create({
            data: {
              name: 'Compaction race',
              ownerUserId: 'fixture',
              createdById: 'fixture',
            },
          })
        ).id;
        const project = await db.platformProject.create({
          data: {
            workspaceId,
            name: 'Compaction race',
            createdById: 'fixture',
          },
        });
        const document = await db.studioDocument.create({
          data: {
            workspaceId,
            platformProjectId: project.id,
            type: 'canvas',
            title: 'Compaction race',
            createdById: 'fixture',
            contentSnapshot: {},
            currentSequence: 2,
          },
        });
        const source = new Y.Doc();
        const node = new Y.Map<unknown>();
        source.getMap('nodes').set('image', node);
        node.set('mediaAssetId', mediaId);
        const first = Buffer.from(Y.encodeStateAsUpdate(source));
        const vector = Y.encodeStateVector(source);
        node.set('x', 10);
        const second = Buffer.from(Y.encodeStateAsUpdate(source, vector));
        await db.studioDocumentOperation.createMany({
          data: [first, second].map((yjsUpdate, index) => ({
            documentId: document.id,
            sequence: index + 1,
            operationType: 'yjs_update',
            actorUserId: 'fixture',
            yjsUpdate,
          })),
        });
        // Historical unavailable media must not prevent an unrelated edit.
        // Losing the base/tail during compaction incorrectly treats it as new.
        await db.mediaAsset.update({
          where: { id: mediaId },
          data: {
            status: 'deleted',
            deletedAt: new Date(),
          },
        });
        const enabled = process.env.DOCUMENT_OP_PRUNE_ENABLED;
        const retention = process.env.DOCUMENT_OP_PRUNE_RETENTION;
        process.env.DOCUMENT_OP_PRUNE_ENABLED = 'true';
        process.env.DOCUMENT_OP_PRUNE_RETENTION = '1';
        const compactor = new DocumentCompactionService(
          db as never,
          { maybeStamp: jest.fn() } as never,
        );
        if (enabled === undefined) delete process.env.DOCUMENT_OP_PRUNE_ENABLED;
        else process.env.DOCUMENT_OP_PRUNE_ENABLED = enabled;
        if (retention === undefined)
          delete process.env.DOCUMENT_OP_PRUNE_RETENTION;
        else process.env.DOCUMENT_OP_PRUNE_RETENTION = retention;
        let compacted = false;
        const compact = async () => {
          compacted = true;
          compactor.schedule(document.id);
          await compactor.flush(document.id);
        };
        const savingDb = db.$extends({
          query: {
            studioDocument: {
              async findFirst({ args, query }) {
                const row = await query(args);
                if (save === 'task' && timing === 'before' && !compacted)
                  await compact();
                return row;
              },
            },
            async $queryRaw({ args, query }) {
              const isStateRead = (args as unknown as Prisma.Sql).sql.includes(
                'SELECT d.crdt_state',
              );
              if (isStateRead && !compacted && timing === 'before')
                await compact();
              const rows: unknown = await query(args);
              if (isStateRead && !compacted && timing === 'after')
                await compact();
              return rows;
            },
          },
        });
        const documents = new DocumentsService(
          savingDb as never,
          {} as never,
          { requireDocument: jest.fn() } as never,
          {} as never,
          {} as never,
          { schedule: jest.fn() } as never,
        );
        try {
          if (save === 'task') {
            const tasks = new CrewTasksService(
              db as never,
              {} as never,
              {} as never,
              {} as never,
              {} as never,
              {} as never,
            );
            const internal = tasks as unknown as {
              materializeCanvasDocumentTx(
                tx: Prisma.TransactionClient,
                id: string,
              ): Promise<{ contentSnapshot: unknown; crdtState: Uint8Array }>;
            };
            const result = await savingDb.$transaction((tx) =>
              internal.materializeCanvasDocumentTx(
                tx as unknown as Prisma.TransactionClient,
                document.id,
              ),
            );
            expect(result.contentSnapshot).toMatchObject({
              nodes: { image: { mediaAssetId: mediaId, x: 10 } },
            });
            const restored = new DocumentStateBuilder(
              result.crdtState,
              rootSchemaFor('canvas'),
            );
            try {
              expect(restored.snapshot()).toMatchObject({
                nodes: { image: { mediaAssetId: mediaId, x: 10 } },
              });
            } finally {
              restored.destroy();
            }
          } else if (save === 'checkpoint') {
            const result = await documents.createVersion(
              { userId: 'fixture' } as never,
              document.id,
              { source: 'manual', metadata: {} },
            );
            const version = await db.studioDocumentVersion.findUniqueOrThrow({
              where: { id: result.version.id },
            });
            expect(version.sequence).toBe(2);
            expect(version.snapshot).toMatchObject({
              nodes: { image: { mediaAssetId: mediaId, x: 10 } },
            });
            const restored = new DocumentStateBuilder(
              version.crdtState,
              rootSchemaFor('canvas'),
            );
            try {
              expect(restored.snapshot()).toMatchObject({
                nodes: { image: { mediaAssetId: mediaId, x: 10 } },
              });
            } finally {
              restored.destroy();
            }
          } else {
            node.set('x', 30);
            await documents.appendOperation(
              { userId: 'fixture' } as never,
              document.id,
              {
                operationType: 'yjs_update',
                metadata: {},
                idempotencyKey: 'move',
                yjsUpdateBase64: Buffer.from(
                  Y.encodeStateAsUpdate(source),
                ).toString('base64'),
              },
            );
          }
          expect(compacted).toBe(true);
          const persisted = await db.studioDocument.findUniqueOrThrow({
            where: { id: document.id },
          });
          expect(persisted.snapshotSequence).toBe(2);
          expect(persisted.currentSequence).toBe(save !== 'operation' ? 2 : 3);
          expect(
            await db.studioDocumentOperation.findMany({
              where: { documentId: document.id },
              orderBy: { sequence: 'asc' },
              select: { sequence: true },
            }),
          ).toEqual(
            save !== 'operation'
              ? [{ sequence: 2 }]
              : [{ sequence: 2 }, { sequence: 3 }],
          );
        } finally {
          source.destroy();
          await compactor.onModuleDestroy();
        }
      },
    );
    it.each(['snapshot', 'yjs_update'] as const)(
      'allows %s replay, unrelated edits and removing an old retired reference',
      async (operationType) => {
        const workspace = await db.workspace.create({
          data: {
            name: 'Recovery',
            ownerUserId: 'fixture',
            createdById: 'fixture',
          },
        });
        workspaceId = workspace.id;
        const project = await db.platformProject.create({
          data: { workspaceId, name: 'Recovery', createdById: 'fixture' },
        });
        const document = await db.studioDocument.create({
          data: {
            workspaceId,
            platformProjectId: project.id,
            type: 'canvas',
            title: 'Recovery',
            createdById: 'fixture',
            contentSnapshot: {},
          },
        });
        const documents = new DocumentsService(
          db as never,
          {} as never,
          { requireDocument: jest.fn() } as never,
          {} as never,
          {} as never,
          { schedule: jest.fn() } as never,
        );
        const doc = new Y.Doc();
        const node = new Y.Map<unknown>();
        node.set('mediaAssetId', mediaId);
        doc.getMap('nodes').set('image', node);
        const input = (idempotencyKey: string) => ({
          operationType,
          metadata: {},
          idempotencyKey,
          ...(operationType === 'snapshot'
            ? { snapshot: doc.toJSON() }
            : {
                yjsUpdateBase64: Buffer.from(
                  Y.encodeStateAsUpdate(doc),
                ).toString('base64'),
              }),
        });
        try {
          const initial = input('initial');
          await documents.appendOperation(
            { userId: 'fixture' } as never,
            document.id,
            initial,
          );
          // Model a reference made unavailable by another lifecycle action. It
          // must not prevent the author from repairing the rest of the document.
          await db.mediaAsset.update({
            where: { id: mediaId },
            data: { status: 'deleted', deletedAt: new Date() },
          });
          await documents.appendOperation(
            { userId: 'fixture' } as never,
            document.id,
            initial,
          );
          expect(
            await db.studioDocumentOperation.count({
              where: { documentId: document.id },
            }),
          ).toBe(1);
          node.set('x', 30);
          await documents.appendOperation(
            { userId: 'fixture' } as never,
            document.id,
            input('move'),
          );
          node.delete('mediaAssetId');
          await documents.appendOperation(
            { userId: 'fixture' } as never,
            document.id,
            input('remove'),
          );
          expect(
            await db.studioDocumentOperation.count({
              where: { documentId: document.id },
            }),
          ).toBe(3);
          node.set('mediaAssetId', mediaId);
          await expect(
            documents.appendOperation(
              { userId: 'fixture' } as never,
              document.id,
              input('reattach'),
            ),
          ).rejects.toMatchObject({ status: 400 });
          expect(
            await db.studioDocumentOperation.count({
              where: { documentId: document.id },
            }),
          ).toBe(3);
        } finally {
          doc.destroy();
        }
      },
    );
    it.each(
      (
        [
          'snapshot',
          'yjs_update',
          'pending-yjs',
          'create',
          'update',
          'version',
          'binary-version',
        ] as const
      ).flatMap((operationType) =>
        ['document', 'deletion'].map((first) => ({ operationType, first })),
      ),
    )(
      'protects $operationType when $first commits first',
      async ({ operationType, first }) => {
        const workspace = await db.workspace.create({
          data: {
            name: 'Diagnostic',
            ownerUserId: 'fixture',
            createdById: 'fixture',
          },
        });
        workspaceId = workspace.id;
        const project = await db.platformProject.create({
          data: { workspaceId, name: 'Diagnostic', createdById: 'fixture' },
        });
        const document = await db.studioDocument.create({
          data: {
            workspaceId,
            platformProjectId: project.id,
            type: 'canvas',
            title: 'Diagnostic',
            createdById: 'fixture',
            contentSnapshot: {},
          },
        });
        const documents = new DocumentsService(
          db as never,
          { requireProjectRole: jest.fn().mockResolvedValue(project) } as never,
          { requireDocument: jest.fn().mockResolvedValue(document) } as never,
          {} as never,
          { record: jest.fn() } as never,
          { schedule: jest.fn() } as never,
        );
        let release!: () => void, ready!: () => void;
        const gate = new Promise<void>((r) => {
          release = r;
        });
        const started = new Promise<void>((r) => {
          ready = r;
        });
        const transaction: <T>(
          callback: (tx: Prisma.TransactionClient) => Promise<T>,
        ) => Promise<T> = db.$transaction.bind(db) as typeof db.$transaction;
        const injected = jest
          .spyOn(db, '$transaction')
          .mockImplementationOnce(((
            callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
          ) =>
            transaction(async (tx) => {
              const result = await callback(tx);
              ready();
              await gate;
              return result;
            })) as never);
        const ydoc = new Y.Doc();
        const entry = new Y.Map<unknown>();
        ydoc.getMap('nodes').set('image', entry);
        const dependencyVector = Y.encodeStateVector(ydoc);
        entry.set('mediaAssetId', mediaId);
        const yjsUpdateBase64 = Buffer.from(
          Y.encodeStateAsUpdate(
            ydoc,
            operationType === 'pending-yjs' ? dependencyVector : undefined,
          ),
        ).toString('base64');
        ydoc.destroy();
        const snapshot = { nodes: { image: { mediaAssetId: mediaId } } };
        const save = () =>
          operationType === 'create'
            ? documents.createDocument(
                { userId: 'fixture' } as never,
                project.id,
                CreateDocumentSchema.parse({
                  type: 'brief',
                  title: 'New document',
                  contentSnapshot: { content: mediaId },
                }),
              )
            : operationType === 'update'
              ? documents.updateDocument(
                  { userId: 'fixture' } as never,
                  document.id,
                  { contentSnapshot: snapshot },
                )
              : operationType === 'version' ||
                  operationType === 'binary-version'
                ? documents.createVersion(
                    { userId: 'fixture' } as never,
                    document.id,
                    {
                      ...(operationType === 'binary-version'
                        ? { crdtStateBase64: yjsUpdateBase64, snapshot: {} }
                        : { snapshot }),
                      source: 'manual',
                      metadata: {},
                    },
                  )
                : documents.appendOperation(
                    { userId: 'fixture' } as never,
                    document.id,
                    {
                      operationType:
                        operationType === 'pending-yjs'
                          ? 'yjs_update'
                          : operationType,
                      metadata: {},
                      ...(operationType === 'snapshot'
                        ? {
                            snapshot: {
                              nodes: { image: { mediaAssetId: mediaId } },
                            },
                          }
                        : { yjsUpdateBase64 }),
                    },
                  );
        const remove = () =>
          service.removePermanently(crewId, 'fixture', nodeId);
        const leading = first === 'document' ? save() : remove();
        await started;
        const trailing = (first === 'document' ? remove() : save()).then(
          () => null,
          (error: unknown) => error,
        );
        try {
          const deadline = Date.now() + 2000;
          while (true) {
            const [row] = await db.$queryRaw<
              Array<{ count: bigint }>
            >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${app} AND wait_event_type='Lock'`;
            if (Number(row.count)) break;
            if (Date.now() > deadline)
              throw new Error('Expected reference/retirement serialization');
            await new Promise((r) => setTimeout(r, 10));
          }
        } finally {
          release();
          await leading;
          injected.mockRestore();
        }
        const error = await trailing;
        if (first === 'document') expect(error).toBeNull();
        else expect(error).toMatchObject({ status: 400 });
        expect(
          await db.studioDocumentOperation.count({
            where: { documentId: document.id },
          }),
        ).toBe(
          first === 'document' &&
            (operationType === 'snapshot' ||
              operationType === 'yjs_update' ||
              operationType === 'pending-yjs')
            ? 1
            : 0,
        );
        if (operationType === 'create')
          expect(
            await db.studioDocument.count({ where: { workspaceId } }),
          ).toBe(first === 'document' ? 2 : 1);
        if (operationType === 'version' || operationType === 'binary-version')
          expect(
            await db.studioDocumentVersion.count({
              where: { documentId: document.id },
            }),
          ).toBe(first === 'document' ? 1 : 0);
        if (operationType === 'update')
          expect(
            (
              await db.studioDocument.findUniqueOrThrow({
                where: { id: document.id },
              })
            ).contentSnapshot,
          ).toEqual(first === 'document' ? snapshot : {});
        expect(
          await db.mediaAsset.findUnique({ where: { id: mediaId } }),
        ).toMatchObject({ status: first === 'document' ? 'ready' : 'deleted' });
        expect(storage.deleteObject).toHaveBeenCalledTimes(
          first === 'document' ? 0 : 1,
        );
      },
    );
  },
);
