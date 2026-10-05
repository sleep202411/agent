import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthGuard } from '../../auth/auth.guard';
import { AuthService } from '../../auth/auth.service';
import {
  CrewTaskFeedbackController,
  CrewTaskFeedbackService,
} from './task-feedback';

describe('public review HTTP boundary', () => {
  let app: INestApplication;
  const publicProfile = jest
    .fn()
    .mockResolvedValue({ items: [], nextCursor: null });
  const validateSessionContext = jest.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CrewTaskFeedbackController],
      providers: [
        { provide: CrewTaskFeedbackService, useValue: { publicProfile } },
        { provide: AuthService, useValue: { validateSessionContext } },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows anonymous profile reads with bounded default pagination', async () => {
    await request(app.getHttpServer() as Server)
      .get('/creator-profiles/creator-1/reviews')
      .expect(200);
    expect(publicProfile).toHaveBeenCalledWith('creator-1', { limit: 20 });
    expect(validateSessionContext).not.toHaveBeenCalled();
  });

  it.each(['limit=0', 'limit=51', 'cursor=invalid', 'publicOnProfile=false'])(
    'rejects invalid or privacy-altering query %s',
    async (query) => {
      await request(app.getHttpServer() as Server)
        .get(`/creator-profiles/creator-1/reviews?${query}`)
        .expect(400);
      expect(publicProfile).not.toHaveBeenCalled();
    },
  );

  it.each([
    '/me/crew-task-feedback',
    '/crew-tasks/00000000-0000-4000-8000-000000000001/feedback',
  ])('does not make private history public: %s', async (path) => {
    await request(app.getHttpServer() as Server)
      .get(path)
      .expect(401);
    expect(publicProfile).not.toHaveBeenCalled();
  });
});
