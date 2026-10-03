import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthGuard, AuthService } from '../auth';
import { StorySavesController } from './story-saves.controller';
import { StorySavesService } from './story-saves.service';

describe('Story saves HTTP boundary', () => {
  let app: INestApplication;
  const validateToken = jest.fn();
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
        { provide: AuthService, useValue: { validateToken } },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: StorySavesService, useValue: svc },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    validateToken.mockReset().mockResolvedValue({ userId: 'player-1' });
    for (const method of Object.values(svc)) method.mockReset();
  });

  it('requires a session for every route', async () => {
    const http = app.getHttpServer() as Server;
    await request(http).get('/story-saves/game-1/latest').expect(401);
    await request(http).get('/story-saves/game-1/save').expect(401);
    await request(http)
      .put('/story-saves/game-1/save')
      .send({ contentVersion: 'v1', state: {}, events: [] })
      .expect(401);
    await request(http).delete('/story-saves/game-1/save').expect(401);
    validateToken.mockResolvedValue(null);
    await request(http)
      .get('/story-saves/game-1/latest')
      .set('Cookie', 'satoken=expired')
      .expect(401);
  });

  it('returns the latest save inside the envelope, null when absent', async () => {
    svc.latest.mockResolvedValue(null);
    await request(app.getHttpServer() as Server)
      .get('/story-saves/game-1/latest')
      .set('Cookie', 'satoken=valid')
      .expect(200)
      .expect({ code: 200, data: null });
    expect(svc.latest).toHaveBeenCalledWith('player-1', 'game-1');
  });

  it('addresses a chapter slot via the chapterId query param', async () => {
    svc.chapter.mockResolvedValue(null);
    await request(app.getHttpServer() as Server)
      .get('/story-saves/game-1/save?chapterId=ch-2')
      .set('Cookie', 'satoken=valid')
      .expect(200)
      .expect({ code: 200, data: null });
    expect(svc.chapter).toHaveBeenCalledWith('player-1', 'game-1', 'ch-2');
  });

  it('omitting chapterId addresses the single-chapter slot', async () => {
    svc.chapter.mockResolvedValue(null);
    await request(app.getHttpServer() as Server)
      .get('/story-saves/game-1/save')
      .set('Cookie', 'satoken=valid')
      .expect(200)
      .expect({ code: 200, data: null });
    expect(svc.chapter).toHaveBeenCalledWith('player-1', 'game-1', '');
  });

  it('rejects an invalid save body', async () => {
    await request(app.getHttpServer() as Server)
      .put('/story-saves/game-1/save?chapterId=ch-1')
      .set('Cookie', 'satoken=valid')
      .send({ contentVersion: 'v1', state: 'not-an-object' })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .put('/story-saves/game-1/save?chapterId=ch-1')
      .set('Cookie', 'satoken=valid')
      .send({ contentVersion: '', state: {}, events: [] })
      .expect(400);
    expect(svc.save).not.toHaveBeenCalled();
  });

  it('persists a save for the authenticated user only', async () => {
    svc.save.mockResolvedValue({
      saved: true,
      updatedAt: '2026-10-02T00:00:00.000Z',
    });
    const body = {
      contentVersion: 'v1',
      state: { currentSceneId: 'sc-1' },
      events: [],
    };
    await request(app.getHttpServer() as Server)
      .put('/story-saves/game-1/save?chapterId=ch-1')
      .set('Cookie', 'satoken=valid')
      .send(body)
      .expect(200)
      .expect({
        code: 200,
        data: { saved: true, updatedAt: '2026-10-02T00:00:00.000Z' },
      });
    expect(svc.save).toHaveBeenCalledWith('player-1', 'game-1', 'ch-1', body);
  });

  it('clears a save slot', async () => {
    svc.clear.mockResolvedValue({ cleared: true });
    await request(app.getHttpServer() as Server)
      .delete('/story-saves/game-1/save?chapterId=ch-1')
      .set('Cookie', 'satoken=valid')
      .expect(200)
      .expect({ code: 200, data: { cleared: true } });
    expect(svc.clear).toHaveBeenCalledWith('player-1', 'game-1', 'ch-1');
  });
});
