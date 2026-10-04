import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { StorySavesService } from './story-saves.service';

const requireModule = process
  .getBuiltinModule('module')
  .createRequire(__filename);
const { PGlite } = requireModule(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');
const { PGLiteSocketServer } = requireModule(
  '@electric-sql/pglite-socket',
) as typeof import('@electric-sql/pglite-socket');

/** Real Prisma statements against a disposable PostgreSQL engine. No env URLs. */
describe('revisioned story saves (Prisma + PGlite)', () => {
  let directory: string;
  let sql: InstanceType<typeof PGlite>;
  let socket: InstanceType<typeof PGLiteSocketServer>;
  let prisma: PrismaClient;
  let saves: StorySavesService;
  let migratedLegacy: unknown;
  const body = {
    contentVersion: 'v1',
    state: { currentSceneId: 'scene-1' },
    events: [{ type: 'scene.goto', payload: { sceneId: 'paid-2' } }],
    playback: { positionMs: 12_300, watchedMs: 20_000 },
    expectedRevision: 0,
  };

  beforeEach(async () => {
    directory = await mkdtemp('/tmp/story-saves-');
    sql = await PGlite.create();
    await sql.exec(
      await readFile(
        join(
          __dirname,
          '../../prisma/migrations/20261002232707_story_play_saves/migration.sql',
        ),
        'utf8',
      ),
    );
    await sql.exec(
      `INSERT INTO story_play_saves VALUES ('legacy', 'game', '', 'v0', '{"currentSceneId":"scene-old"}', '[]', NOW(), NOW())`,
    );
    await sql.exec(
      await readFile(
        join(
          __dirname,
          '../../prisma/migrations/20261004213000_story_play_save_revisions/migration.sql',
        ),
        'utf8',
      ),
    );
    await sql.exec(
      await readFile(
        join(
          __dirname,
          '../../prisma/migrations/20261004230000_story_play_save_journeys/migration.sql',
        ),
        'utf8',
      ),
    );
    migratedLegacy = (
      await sql.query(
        'SELECT state, playback, journey, revision, cleared FROM story_play_saves',
      )
    ).rows[0];
    await sql.exec('DELETE FROM story_play_saves');
    socket = new PGLiteSocketServer({
      db: sql,
      path: join(directory, '.s.PGSQL.5432'),
    });
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener(
        'error',
        (event) => {
          const cause: unknown = 'detail' in event ? event.detail : event.type;
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        },
        { once: true },
      );
      void socket.start().then(resolve, reject);
    });
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        host: directory,
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        max: 1,
      }),
    });
    saves = new StorySavesService(prisma as never);
  }, 30_000);

  afterEach(async () => {
    await prisma?.$disconnect();
    await socket?.stop();
    await sql?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('migrates existing saves without deleting their runtime state', () => {
    expect(migratedLegacy).toEqual({
      state: { currentSceneId: 'scene-old' },
      playback: null,
      journey: null,
      revision: 0,
      cleared: false,
    });
  });

  it('round-trips the seconds cursor, pending events and revision with real JSON columns', async () => {
    expect(await saves.chapter('player', 'game', 'chapter')).toEqual({
      save: null,
      revision: 0,
    });
    expect(await saves.save('player', 'game', 'chapter', body)).toMatchObject({
      saved: true,
      revision: 1,
    });
    expect(await saves.chapter('player', 'game', 'chapter')).toMatchObject({
      revision: 1,
      save: {
        state: body.state,
        events: body.events,
        playback: body.playback,
        revision: 1,
      },
    });
  });

  it('retains a tombstone, blocks late writes and allows a fresh run at the new revision', async () => {
    await saves.save('player', 'game', 'chapter', body);
    expect(await saves.clear('player', 'game', 'chapter', 1)).toEqual({
      cleared: true,
      revision: 2,
    });
    expect(await saves.chapter('player', 'game', 'chapter')).toEqual({
      save: null,
      revision: 2,
    });
    expect(await saves.latest('player', 'game')).toBeNull();
    const row = await prisma.storyPlaySave.findFirstOrThrow();
    expect(row).toMatchObject({
      state: {},
      events: [],
      playback: null,
      cleared: true,
      revision: 2,
    });
    await expect(
      saves.save('player', 'game', 'chapter', { ...body, expectedRevision: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      await saves.save('player', 'game', 'chapter', {
        ...body,
        expectedRevision: 2,
      }),
    ).toMatchObject({ revision: 3 });
    await expect(
      saves.clear('player', 'game', 'chapter', 1),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await saves.chapter('player', 'game', 'chapter')).toMatchObject({
      revision: 3,
      save: { playback: body.playback },
    });
  });

  it('guards a never-saved slot against a delayed revision-zero write after restart', async () => {
    expect(await saves.clear('player', 'game', 'chapter', 0)).toEqual({
      cleared: true,
      revision: 1,
    });
    expect(await saves.chapter('player', 'game', 'chapter')).toEqual({
      save: null,
      revision: 1,
    });
    // Expected unique violations end PGlite's single protocol session.
    await expect(
      saves.save('player', 'game', 'chapter', body),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('admits only one concurrent writer for the same expected revision', async () => {
    await saves.save('player', 'game', 'chapter', body);
    const result = await Promise.allSettled([
      saves.save('player', 'game', 'chapter', {
        ...body,
        state: { currentSceneId: 'left' },
        expectedRevision: 1,
      }),
      saves.save('player', 'game', 'chapter', {
        ...body,
        state: { currentSceneId: 'right' },
        expectedRevision: 1,
      }),
    ]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    const failures = result.filter((item) => item.status === 'rejected');
    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toBeInstanceOf(ConflictException);
    expect(await saves.chapter('player', 'game', 'chapter')).toMatchObject({
      revision: 2,
    });
    expect(await prisma.storyPlaySave.count()).toBe(1);
  });

  it('resolves concurrent first write and clear without resurrecting or losing the winner', async () => {
    const result = await Promise.allSettled([
      saves.save('player', 'game', 'chapter', body),
      saves.clear('player', 'game', 'chapter', 0),
    ]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    const failures = result.filter((item) => item.status === 'rejected');
    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toBeInstanceOf(ConflictException);
    // Read directly after the losing CREATE: the engine persists correctly,
    // while PGlite does not recover its protocol session like real PostgreSQL.
    const persisted = await sql.query<{ revision: number }>(
      'SELECT revision FROM story_play_saves',
    );
    expect(persisted.rows).toEqual([{ revision: 1 }]);
  });

  it('isolates actors and chapters and ignores newer tombstones in latest lookup', async () => {
    await saves.save('player', 'game', 'chapter-1', body);
    await saves.save('other', 'game', 'chapter-1', body);
    await saves.clear('player', 'game', 'chapter-2', 0);
    expect(await saves.latest('player', 'game')).toMatchObject({
      chapterId: 'chapter-1',
      revision: 1,
    });
    expect(await saves.chapter('third', 'game', 'chapter-1')).toEqual({
      save: null,
      revision: 0,
    });
    await saves.clear('other', 'game', 'chapter-1', 1);
    expect(await saves.latest('other', 'game')).toBeNull();
    expect(await saves.latest('player', 'game')).toMatchObject({
      chapterId: 'chapter-1',
    });
  });

  it('clears the SQL JSON cursor when a new checkpoint omits playback', async () => {
    await saves.save('player', 'game', 'chapter', body);
    await saves.save('player', 'game', 'chapter', {
      contentVersion: 'v2',
      state: {},
      events: [],
      expectedRevision: 1,
    });
    expect(await saves.chapter('player', 'game', 'chapter')).toMatchObject({
      revision: 2,
      save: { playback: null },
    });
  });

  const anchor = (sceneId: string) => ({
    sceneId,
    state: { currentSceneId: sceneId },
    events: [],
    playback: { positionMs: 0 },
    requiredAccessRefs: [],
  });
  const delta = {
    version: 1 as const,
    signature: 'graph-1',
    addedVisitedNodeIds: ['scene-a'],
    addedTraversedEdges: [],
    addedTraversedPaths: [],
    addedWatchedMedia: [],
    anchors: [anchor('scene-a')],
  };

  it('persists only changed anchors and retains full history through ordinary progress writes', async () => {
    await saves.save('player', 'game', 'chapter', {
      ...body,
      journeyDelta: delta,
    });
    await saves.save('player', 'game', 'chapter', {
      ...body,
      state: { currentSceneId: 'scene-b' },
      expectedRevision: 1,
    });
    const result = await saves.chapter('player', 'game', 'chapter');
    expect(result.save?.journey).toMatchObject({
      signature: 'graph-1',
      visitedNodeIds: ['scene-a'],
      anchors: [anchor('scene-a')],
    });
    expect(await prisma.storyPlaySaveAnchor.count()).toBe(1);
    expect(await saves.latest('player', 'game')).not.toHaveProperty('journey');
  });

  it('merges routes without inventing paths and increases partial watch bounds monotonically', async () => {
    const edge = {
      fromSceneId: 'scene-a',
      bindingId: 'choice',
      routeId: 'left',
      toSceneId: 'scene-b',
    };
    const media = {
      sceneId: 'scene-a',
      rendererInstanceId: 'video-a',
      sequenceIndex: 0,
      assetId: 'asset-a',
      mediaSignature: 'media-1',
      watchedUntilMs: 4000,
    };
    await saves.save('player', 'game', 'chapter', {
      ...body,
      journeyDelta: {
        ...delta,
        addedTraversedEdges: [edge],
        addedTraversedPaths: [[edge]],
        addedWatchedMedia: [media],
      },
    });
    await saves.save('player', 'game', 'chapter', {
      ...body,
      expectedRevision: 1,
      journeyDelta: {
        ...delta,
        addedVisitedNodeIds: ['scene-b'],
        addedTraversedEdges: [edge, { ...edge, routeId: 'right' }],
        addedTraversedPaths: [[edge]],
        addedWatchedMedia: [{ ...media, watchedUntilMs: 2000 }],
        anchors: [anchor('scene-b')],
      },
    });
    const result = await saves.chapter('player', 'game', 'chapter');
    expect(result.save?.journey).toMatchObject({
      visitedNodeIds: ['scene-a', 'scene-b'],
      traversedEdges: [edge, { ...edge, routeId: 'right' }],
      traversedPaths: [[edge]],
      watchedMedia: [media],
      anchors: [anchor('scene-a'), anchor('scene-b')],
    });
  });

  it('preserves entry gates while the current branch gates can rewind and reset atomically', async () => {
    const refs = [
      { kind: 'node' as const, sceneId: 'scene-a' },
      {
        kind: 'route' as const,
        sceneId: 'scene-a',
        bindingId: 'choice',
        routeId: 'paid',
      },
    ];
    await saves.save('player', 'game', 'chapter', {
      ...body,
      journeyDelta: {
        ...delta,
        activeAccessRefs: refs,
        anchors: [{ ...anchor('scene-a'), requiredAccessRefs: refs }],
      },
    });
    await saves.save('player', 'game', 'chapter', {
      ...body,
      expectedRevision: 1,
      journeyDelta: { ...delta, anchors: [] },
    });
    expect(
      (await saves.chapter('player', 'game', 'chapter')).save?.journey,
    ).toMatchObject({
      activeAccessRefs: refs,
      anchors: [{ requiredAccessRefs: refs }],
    });
    await expect(
      saves.save('player', 'game', 'chapter', {
        ...body,
        expectedRevision: 1,
        journeyDelta: { ...delta, anchors: [], activeAccessRefs: [] },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (await saves.chapter('player', 'game', 'chapter')).save?.journey
        ?.activeAccessRefs,
    ).toEqual(refs);
    await saves.save('player', 'game', 'chapter', {
      ...body,
      expectedRevision: 2,
      journeyDelta: { ...delta, anchors: [], activeAccessRefs: [] },
    });
    expect(
      (await saves.chapter('player', 'game', 'chapter')).save?.journey,
    ).toMatchObject({
      activeAccessRefs: [],
      anchors: [{ requiredAccessRefs: refs }],
    });
    await saves.save('player', 'game', 'chapter', {
      ...body,
      expectedRevision: 3,
      journeyDelta: { ...delta, activeAccessRefs: refs, anchors: [] },
    });
    await saves.save('player', 'game', 'chapter', {
      ...body,
      expectedRevision: 4,
      journeyDelta: { ...delta, signature: 'new-graph' },
    });
    expect(
      (await saves.chapter('player', 'game', 'chapter')).save?.journey,
    ).toMatchObject({
      signature: 'new-graph',
      activeAccessRefs: [],
      anchors: [{ requiredAccessRefs: [] }],
    });
  });

  it('keeps rejected stale journey writes and clears from changing committed anchors', async () => {
    await saves.save('player', 'game', 'chapter', {
      ...body,
      journeyDelta: delta,
    });
    await expect(
      saves.save('player', 'game', 'chapter', {
        ...body,
        journeyDelta: {
          ...delta,
          anchors: [{ ...anchor('scene-a'), state: { poisoned: true } }],
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      saves.clear('player', 'game', 'chapter', 0),
    ).rejects.toBeInstanceOf(ConflictException);
    const result = await saves.chapter('player', 'game', 'chapter');
    expect(result.revision).toBe(1);
    expect(result.save?.journey?.anchors).toEqual([anchor('scene-a')]);
  });

  it('atomically resets graph history on signature change and clears anchors with the tombstone', async () => {
    await saves.save('player', 'game', 'chapter', {
      ...body,
      journeyDelta: delta,
    });
    await saves.save('player', 'game', 'chapter', {
      ...body,
      expectedRevision: 1,
      journeyDelta: {
        ...delta,
        signature: 'graph-2',
        addedVisitedNodeIds: ['scene-c'],
        anchors: [anchor('scene-c')],
      },
    });
    expect(
      (await saves.chapter('player', 'game', 'chapter')).save?.journey,
    ).toMatchObject({
      signature: 'graph-2',
      visitedNodeIds: ['scene-c'],
      anchors: [anchor('scene-c')],
    });
    expect(await prisma.storyPlaySaveAnchor.count()).toBe(1);
    await saves.clear('player', 'game', 'chapter', 2);
    expect(await prisma.storyPlaySaveAnchor.count()).toBe(0);
    expect(await prisma.storyPlaySave.findFirst()).toMatchObject({
      journey: null,
      cleared: true,
      revision: 3,
    });
  });

  it('rolls back the CAS, graph reset and upserts together after an invalid changed anchor', async () => {
    await saves.save('player', 'game', 'chapter', {
      ...body,
      journeyDelta: delta,
    });
    await expect(
      saves.save('player', 'game', 'chapter', {
        ...body,
        state: { poisoned: true },
        expectedRevision: 1,
        journeyDelta: {
          ...delta,
          signature: 'graph-2',
          addedVisitedNodeIds: ['scene-c'],
          anchors: [anchor('not-visited')],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const result = await saves.chapter('player', 'game', 'chapter');
    expect(result).toMatchObject({
      revision: 1,
      save: {
        state: body.state,
        journey: { signature: 'graph-1', anchors: [anchor('scene-a')] },
      },
    });
  });

  it('isolates history by account, game and chapter and accepts manifest-length scene identities', async () => {
    const longScene = 's'.repeat(160);
    await saves.save('player', 'game', 'chapter', {
      ...body,
      journeyDelta: {
        ...delta,
        addedVisitedNodeIds: [longScene],
        anchors: [anchor(longScene)],
      },
    });
    for (const [user, game, chapter] of [
      ['other', 'game', 'chapter'],
      ['player', 'other', 'chapter'],
      ['player', 'game', 'other'],
    ]) {
      expect(await saves.chapter(user, game, chapter)).toEqual({
        save: null,
        revision: 0,
      });
    }
    expect(
      (await saves.chapter('player', 'game', 'chapter')).save?.journey
        ?.anchors[0]?.sceneId,
    ).toBe(longScene);
  });

  it('enforces the accumulated journey byte limit and rolls back only the excessive update', async () => {
    let expectedRevision = 0;
    const large = (sceneId: string) => ({
      sceneId,
      state: { blob: 'x'.repeat(127 * 1024) },
      events: [],
      requiredAccessRefs: [],
    });
    for (let group = 0; group < 21; group++) {
      const ids = [0, 1, 2].map((part) => `scene-${group * 3 + part}`);
      const ack = await saves.save('player', 'game', 'chapter', {
        ...body,
        expectedRevision,
        journeyDelta: {
          ...delta,
          addedVisitedNodeIds: ids,
          anchors: ids.map(large),
        },
      });
      expectedRevision = ack.revision;
    }
    await expect(
      saves.save('player', 'game', 'chapter', {
        ...body,
        expectedRevision,
        journeyDelta: {
          ...delta,
          addedVisitedNodeIds: ['excessive', 'excessive-2'],
          anchors: [large('excessive'), large('excessive-2')],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.storyPlaySaveAnchor.count()).toBe(63);
    const result = await saves.chapter('player', 'game', 'chapter');
    expect(result.revision).toBe(21);
    expect(result.save?.journey?.anchors).toHaveLength(63);
  }, 30_000);
});
