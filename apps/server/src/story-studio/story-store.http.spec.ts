import {
  ServiceUnavailableException,
  type INestApplication,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AuthGuard, AuthService } from '../auth';
import { StoryStoreController } from './story-store.controller';
import { StoryStoreService } from './story-store.service';

describe('Story store HTTP boundary', () => {
  let app: INestApplication;
  const validateSessionContext = jest.fn();
  const svc = { getListing: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StoryStoreController],
      providers: [
        { provide: AuthService, useValue: { validateSessionContext } },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: StoryStoreService, useValue: svc },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    validateSessionContext.mockReset().mockResolvedValue({
      user: { userId: 'someone' },
      cookie: 'satoken=valid',
    });
    svc.getListing.mockReset();
  });

  it('serves anonymous callers — the web store dialog reads it logged-out', async () => {
    svc.getListing.mockResolvedValue(null);
    await request(app.getHttpServer() as Server)
      .get(`/story-store/${randomUUID()}`)
      .expect(200)
      .expect({ code: 200, data: null });
  });

  it('returns the listing inside the envelope', async () => {
    const gameId = randomUUID();
    svc.getListing.mockResolvedValue({
      gameId,
      title: '金陵入梦',
      defaultLocale: 'zh-CN',
      description: '一座会记仇的大观园\n\n走进活的红楼梦。\n\n第一章。',
      tags: ['剧情', '多结局'],
      developer: 'Rumeng Crew',
      trailerUrl: 'https://cdn.example/t.mp4',
      coverUrl: 'https://cdn.example/c.jpg',
      screenshots: [{ url: 'https://cdn.example/s1.jpg' }],
    });
    const res = await request(app.getHttpServer() as Server)
      .get(`/story-store/${gameId}`)
      .set('Cookie', 'satoken=valid')
      .expect(200);
    expect(res.body).toMatchObject({
      code: 200,
      data: {
        title: '金陵入梦',
        description: '一座会记仇的大观园\n\n走进活的红楼梦。\n\n第一章。',
        tags: ['剧情', '多结局'],
      },
    });
    expect(res.body).not.toHaveProperty('data.genres');
    expect(res.body).not.toHaveProperty('data.tagline');
    expect(res.body).not.toHaveProperty('data.shortDescription');
    expect(res.body).not.toHaveProperty('data.aboutParagraphs');
    expect(svc.getListing).toHaveBeenCalledWith(gameId);
  });

  it('accepts legacy Java stable IDs for the no-snapshot fallback', async () => {
    svc.getListing.mockResolvedValue(null);
    await request(app.getHttpServer() as Server)
      .get('/story-store/legacyfilm_1')
      .expect(200)
      .expect({ code: 200, data: null });
    expect(svc.getListing).toHaveBeenCalledWith('legacyfilm_1');
  });

  it('surfaces a damaged frozen public listing as an error instead of a successful null fallback', async () => {
    svc.getListing.mockRejectedValue(
      new ServiceUnavailableException({
        code: 'STORY_PUBLICATION_LISTING_INVALID',
        message:
          'The published promotional materials are invalid and cannot be displayed.',
      }),
    );
    await request(app.getHttpServer() as Server)
      .get(`/story-store/${randomUUID()}`)
      .expect(503)
      .expect({
        code: 'STORY_PUBLICATION_LISTING_INVALID',
        message:
          'The published promotional materials are invalid and cannot be displayed.',
      });
  });

  it('rejects a malformed gameId', async () => {
    await request(app.getHttpServer() as Server)
      .get('/story-store/%40invalid')
      .expect(400);
    expect(svc.getListing).not.toHaveBeenCalled();
  });
});
