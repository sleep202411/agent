import { ConflictException, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { json } from 'express';
import { AuthGuard, AuthService } from '../auth';
import { StorySavesController } from './story-saves.controller';
import { StorySavesService } from './story-saves.service';

const BODY = {
  contentVersion: 'v1',
  state: { currentSceneId: 'sc-1' },
  events: [],
  playback: { positionMs: 12_300 },
  expectedRevision: 4,
};
const CONFLICT =
  'Save has changed. Reload the latest save before trying again.';

describe('Story saves HTTP boundary', () => {
  let app: INestApplication;
  const validateSessionContext = jest.fn();
  const svc = {
    latest: jest.fn(),
    chapter: jest.fn(),
    save: jest.fn(),
    clear: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StorySavesController],
      providers: [
        { provide: AuthService, useValue: { validateSessionContext } },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: StorySavesService, useValue: svc },
      ],
    }).compile();
    app = module.createNestApplication({ bodyParser: false });
    // Match production's transport limit; the save DTO owns narrower budgets.
    app.use(json({ limit: '10mb' }));
    await app.init();
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    validateSessionContext.mockReset().mockImplementation((cookie: string) =>
      Promise.resolve(
        cookie === 'satoken=expired'
          ? null
          : {
              user: {
                userId: cookie === 'satoken=second' ? 'player-2' : 'player-1',
              },
              cookie,
            },
      ),
    );
    for (const method of Object.values(svc)) method.mockReset();
  });

  const http = () => app.getHttpServer() as Server;

  it('requires a session for every read and mutation', async () => {
    await request(http()).get('/story-saves/game-1/latest').expect(401);
    await request(http()).get('/story-saves/game-1/save').expect(401);
    await request(http())
      .put('/story-saves/game-1/save')
      .send(BODY)
      .expect(401);
    await request(http())
      .delete('/story-saves/game-1/save?expectedRevision=0')
      .expect(401);
    await request(http())
      .get('/story-saves/game-1/latest')
      .set('Cookie', 'satoken=expired')
      .expect(401);
    await request(http())
      .put('/story-saves/game-1/save')
      .set('Cookie', 'satoken=expired')
      .send(BODY)
      .expect(401);
    await request(http())
      .delete('/story-saves/game-1/save?expectedRevision=0')
      .set('Cookie', 'satoken=expired')
      .expect(401);
    expect(svc.save).not.toHaveBeenCalled();
    expect(svc.clear).not.toHaveBeenCalled();
  });

  it('returns the latest live save or null in the envelope', async () => {
    svc.latest.mockResolvedValue(null);
    await request(http())
      .get('/story-saves/game-1/latest')
      .set('Cookie', 'satoken=valid')
      .expect(200)
      .expect({ code: 200, data: null });
    expect(svc.latest).toHaveBeenCalledWith('player-1', 'game-1');
  });

  it('returns an absent slot with revision zero and default chapter identity', async () => {
    svc.chapter.mockResolvedValue({ save: null, revision: 0 });
    await request(http())
      .get('/story-saves/game-1/save')
      .set('Cookie', 'satoken=valid')
      .expect(200)
      .expect('Cache-Control', 'private, no-store')
      .expect({ code: 200, data: { save: null, revision: 0 } });
    expect(svc.chapter).toHaveBeenCalledWith('player-1', 'game-1', '');
  });

  it('returns a cleared chapter with its tombstone revision', async () => {
    svc.chapter.mockResolvedValue({ save: null, revision: 6 });
    await request(http())
      .get('/story-saves/game-1/save?chapterId=ch-2')
      .set('Cookie', 'satoken=valid')
      .expect(200)
      .expect({ code: 200, data: { save: null, revision: 6 } });
    expect(svc.chapter).toHaveBeenCalledWith('player-1', 'game-1', 'ch-2');
  });

  it('passes media cursor and revision to a save for the authenticated user', async () => {
    const ack = {
      saved: true,
      updatedAt: '2026-10-04T00:00:00.000Z',
      revision: 5,
    };
    svc.save.mockResolvedValue(ack);
    await request(http())
      .put('/story-saves/game-1/save?chapterId=ch-1')
      .set('Cookie', 'satoken=valid')
      .send(BODY)
      .expect(200)
      .expect({ code: 200, data: ack });
    expect(svc.save).toHaveBeenCalledWith('player-1', 'game-1', 'ch-1', BODY);
  });

  it.each([undefined, -1, 1.5, '4', 2_147_483_647])(
    'rejects PUT expectedRevision=%s',
    async (expectedRevision) => {
      await request(http())
        .put('/story-saves/game-1/save')
        .set('Cookie', 'satoken=valid')
        .send({ ...BODY, expectedRevision })
        .expect(400);
      expect(svc.save).not.toHaveBeenCalled();
    },
  );

  it.each(['', '-1', '1.5', '2e3', '2147483647'])(
    'rejects malformed DELETE expectedRevision=%s',
    async (revision) => {
      await request(http())
        .delete(`/story-saves/game-1/save?expectedRevision=${revision}`)
        .set('Cookie', 'satoken=valid')
        .expect(400);
      expect(svc.clear).not.toHaveBeenCalled();
    },
  );

  it('requires expectedRevision on DELETE', async () => {
    await request(http())
      .delete('/story-saves/game-1/save')
      .set('Cookie', 'satoken=valid')
      .expect(400);
    expect(svc.clear).not.toHaveBeenCalled();
  });

  it('rejects forged user identity in a strict save body', async () => {
    await request(http())
      .put('/story-saves/game-1/save')
      .set('Cookie', 'satoken=second')
      .send({ ...BODY, userId: 'player-1' })
      .expect(400);
    expect(svc.save).not.toHaveBeenCalled();
  });

  it('never switches the read or clear actor based on query parameters', async () => {
    svc.chapter.mockResolvedValue({ save: null, revision: 0 });
    svc.clear.mockResolvedValue({ cleared: true, revision: 1 });
    await request(http())
      .get('/story-saves/game-1/save?userId=player-1')
      .set('Cookie', 'satoken=second')
      .expect(200);
    await request(http())
      .delete('/story-saves/game-1/save?expectedRevision=0&userId=player-1')
      .set('Cookie', 'satoken=second')
      .expect(200);
    expect(svc.chapter).toHaveBeenCalledWith('player-2', 'game-1', '');
    expect(svc.clear).toHaveBeenCalledWith('player-2', 'game-1', '', 0);
  });

  it('clears only the addressed revision and acknowledges its successor', async () => {
    svc.clear.mockResolvedValue({ cleared: true, revision: 5 });
    await request(http())
      .delete('/story-saves/game-1/save?chapterId=ch-1&expectedRevision=4')
      .set('Cookie', 'satoken=valid')
      .expect(200)
      .expect({ code: 200, data: { cleared: true, revision: 5 } });
    expect(svc.clear).toHaveBeenCalledWith('player-1', 'game-1', 'ch-1', 4);
  });

  it('surfaces stale PUT and DELETE conflicts without rewriting the message', async () => {
    svc.save.mockRejectedValue(new ConflictException(CONFLICT));
    svc.clear.mockRejectedValue(new ConflictException(CONFLICT));
    const saved = await request(http())
      .put('/story-saves/game-1/save')
      .set('Cookie', 'satoken=valid')
      .send(BODY)
      .expect(409);
    const cleared = await request(http())
      .delete('/story-saves/game-1/save?expectedRevision=4')
      .set('Cookie', 'satoken=valid')
      .expect(409);
    expect(saved.body).toMatchObject({ message: CONFLICT });
    expect(cleared.body).toMatchObject({ message: CONFLICT });
  });

  it.each([
    { ...BODY, state: 'invalid' },
    { ...BODY, events: {} },
    { ...BODY, playback: [] },
    { ...BODY, contentVersion: '' },
  ])('rejects an invalid checkpoint body', async (body) => {
    await request(http())
      .put('/story-saves/game-1/save')
      .set('Cookie', 'satoken=valid')
      .send(body)
      .expect(400);
    expect(svc.save).not.toHaveBeenCalled();
  });

  const journeyDelta = {
    version: 1,
    signature: 'graph-v1',
    addedVisitedNodeIds: ['scene-a'],
    addedTraversedEdges: [],
    addedTraversedPaths: [],
    addedWatchedMedia: [],
    anchors: [
      {
        sceneId: 'scene-a',
        state: { currentSceneId: 'scene-a' },
        events: [],
        requiredAccessRefs: [],
      },
    ],
  };

  it('accepts incremental journey updates only for the authenticated slot', async () => {
    svc.save.mockResolvedValue({ saved: true, revision: 5, updatedAt: 'now' });
    await request(http())
      .put('/story-saves/game-1/save?chapterId=chapter-2&userId=player-1')
      .set('Cookie', 'satoken=second')
      .send({ ...BODY, journeyDelta })
      .expect(200);
    expect(svc.save).toHaveBeenCalledWith('player-2', 'game-1', 'chapter-2', {
      ...BODY,
      journeyDelta,
    });
  });

  it('returns full journey only on the addressed chapter read', async () => {
    const journey = {
      version: 1,
      signature: 'graph-v1',
      visitedNodeIds: ['scene-a'],
      traversedEdges: [],
      traversedPaths: [],
      watchedMedia: [],
      anchors: journeyDelta.anchors,
    };
    svc.chapter.mockResolvedValue({
      save: { ...BODY, revision: 4, journey },
      revision: 4,
    });
    const response = await request(http())
      .get('/story-saves/game-1/save?chapterId=chapter-2')
      .set('Cookie', 'satoken=second')
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(
      (response.body as { data: { save: { journey: unknown } } }).data.save
        .journey,
    ).toEqual(journey);
    expect(svc.chapter).toHaveBeenCalledWith('player-2', 'game-1', 'chapter-2');
  });

  it.each([
    {
      ...journeyDelta,
      anchors: [{ ...journeyDelta.anchors[0], userId: 'other' }],
    },
    { ...journeyDelta, anchors: [{ ...journeyDelta.anchors[0], journey: {} }] },
    {
      ...journeyDelta,
      addedTraversedEdges: [
        {
          fromSceneId: 'a',
          bindingId: 'b',
          routeId: 'r',
          toSceneId: 's',
          toEndingId: 'e',
        },
      ],
    },
    {
      ...journeyDelta,
      addedVisitedNodeIds: Array.from({ length: 1025 }, (_, i) => `scene-${i}`),
    },
    {
      ...journeyDelta,
      anchors: [
        { ...journeyDelta.anchors[0], state: { blob: 'x'.repeat(129 * 1024) } },
      ],
    },
  ])(
    'rejects malformed, forged or excessive journey updates',
    async (invalid) => {
      await request(http())
        .put('/story-saves/game-1/save')
        .set('Cookie', 'satoken=valid')
        .send({ ...BODY, journeyDelta: invalid })
        .expect(400);
      expect(svc.save).not.toHaveBeenCalled();
    },
  );

  it('preserves the revision conflict message for a rejected journey delta', async () => {
    svc.save.mockRejectedValue(new ConflictException(CONFLICT));
    const response = await request(http())
      .put('/story-saves/game-1/save')
      .set('Cookie', 'satoken=valid')
      .send({ ...BODY, journeyDelta })
      .expect(409);
    expect((response.body as { message: string }).message).toBe(CONFLICT);
  });
});
