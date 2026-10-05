import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import type { PrismaClient } from '@prisma/client';
import { buildPrisma } from '../infra/db/db.module';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { encodeDocumentSnapshot } from '../documents/document-crdt';
import { rootSchemaFor } from '../documents/document-modes';
import { captureSavedStoryboard } from './saved-storyboard';
const url = process.env.STORYBOARD_EXPORT_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'saved export snapshot (isolated PostgreSQL)',
  () => {
    let db: PrismaClient;
    let workspaceId: string;
    let projectId: string;
    const actor = `export-${randomUUID()}`;
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55441' ||
        target.pathname !== '/audit_migrations_20261005'
      )
        throw new Error('Dedicated audit database required');
      db = buildPrisma(url);
      const workspace = await db.workspace.create({
        data: {
          name: 'Export fixture',
          ownerUserId: actor,
          createdById: actor,
        },
      });
      workspaceId = workspace.id;
      const project = await db.platformProject.create({
        data: { workspaceId, name: 'Export fixture', createdById: actor },
      });
      projectId = project.id;
    });
    afterAll(async () => {
      if (workspaceId)
        await db.workspace.delete({ where: { id: workspaceId } });
      await db?.$disconnect();
    });
    async function seed() {
      const snapshot = {
        nodes: {
          shot: { id: 'shot', type: 'shot', data: { order: 'a1' } },
          source: {
            id: 'source',
            type: 'videoAsset',
            data: {
              src: 'https://media.invalid/source.mp4',
              mediaAssetId: randomUUID(),
            },
          },
        },
        edges: { edge: { id: 'edge', source: 'source', target: 'shot' } },
      };
      const base = encodeDocumentSnapshot(snapshot, rootSchemaFor('canvas')!);
      const row = await db.studioDocument.create({
        data: {
          workspaceId,
          platformProjectId: projectId,
          type: 'canvas',
          title: 'Fixture',
          slug: randomUUID(),
          createdById: actor,
          contentSnapshot: snapshot,
          crdtState: Buffer.from(base.state),
        },
      });
      const client = new Y.Doc();
      Y.applyUpdate(client, base.state);
      const updates: Uint8Array[] = [];
      client.on('update', (u: Uint8Array) => updates.push(u));
      const data = client
        .getMap<Y.Map<unknown>>('nodes')
        .get('source')!
        .get('data') as Y.Map<unknown>;
      const changedId = randomUUID();
      data.set('mediaAssetId', changedId);
      data.set('src', 'https://media.invalid/changed.mp4');
      client.destroy();
      return { row, updates, changedId };
    }
    async function append(id: string, sequence: number, update: Uint8Array) {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`platform-document:${id}`})::bigint)`;
        await tx.studioDocumentOperation.create({
          data: {
            documentId: id,
            sequence,
            operationType: 'yjs_update',
            actorUserId: actor,
            yjsUpdate: Buffer.from(update),
          },
        });
        await tx.studioDocument.update({
          where: { id },
          data: { currentSequence: sequence },
        });
      });
    }
    it('captures acknowledged updates before background compaction instead of stale JSON', async () => {
      const t = await seed();
      await append(t.row.id, 1, Y.mergeUpdates(t.updates));
      const result = await db.$transaction((tx) =>
        captureSavedStoryboard(tx, t.row.id, 1),
      );
      expect(result.sequence).toBe(1);
      expect(result.clips[0]).toMatchObject({
        mediaAssetId: t.changedId,
        sourceUrl: 'https://media.invalid/changed.mp4',
      });
      expect(
        (await db.studioDocument.findUniqueOrThrow({ where: { id: t.row.id } }))
          .snapshotSequence,
      ).toBe(0);
    });
    it('rejects a stale client revision and incomplete dependency state', async () => {
      const t = await seed();
      await append(t.row.id, 1, t.updates[1]);
      await expect(
        db.$transaction((tx) => captureSavedStoryboard(tx, t.row.id, 0)),
      ).rejects.toThrow('saved canvas changed');
      await expect(
        db.$transaction((tx) => captureSavedStoryboard(tx, t.row.id, 1)),
      ).rejects.toThrow('waiting for dependencies');
      await append(t.row.id, 2, t.updates[0]);
      const result = await db.$transaction((tx) =>
        captureSavedStoryboard(tx, t.row.id, 2),
      );
      expect(result.clips[0].mediaAssetId).toBe(t.changedId);
    });
    it('rejects archived and deleted canvases', async () => {
      const t = await seed();
      await db.studioDocument.update({
        where: { id: t.row.id },
        data: { status: 'archived' },
      });
      await expect(
        db.$transaction((tx) => captureSavedStoryboard(tx, t.row.id, 0)),
      ).rejects.toThrow('Active canvas');
      await db.studioDocument.update({
        where: { id: t.row.id },
        data: { status: 'active', deletedAt: new Date() },
      });
      await expect(
        db.$transaction((tx) => captureSavedStoryboard(tx, t.row.id, 0)),
      ).rejects.toThrow('Active canvas');
    });
  },
);
