import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthGuard, AuthService, type AuthUser } from '../auth';
import {
  CrewApplicationAmendmentsController,
  CrewAmendmentSettlementQueueController,
  CrewApplicationAmendmentsService,
} from './application-amendments';

describe('Amendment HTTP boundary', () => {
  let app: INestApplication;
  const validateToken = jest.fn();
  const svc = {
    list: jest.fn(),
    listSettlementQueue: jest.fn(),
    decide: jest.fn(),
    settle: jest.fn(),
  };
  const base = '/applications/application-1/amendments';
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        CrewApplicationAmendmentsController,
        CrewAmendmentSettlementQueueController,
      ],
      providers: [
        {
          provide: AuthService,
          useValue: {
            validateSessionContext: async (cookie: string) => {
              const user = (await validateToken(cookie)) as AuthUser | null;
              return user ? { user, cookie } : null;
            },
          },
        },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: CrewApplicationAmendmentsService, useValue: svc },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    validateToken
      .mockReset()
      .mockResolvedValue({ userId: 'authenticated-actor' });
    for (const method of Object.values(svc))
      method.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  });
  it('requires sessions for history, finance discovery and settlement', async () => {
    await request(app.getHttpServer() as Server)
      .get(base)
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get('/crews/crew-1/application-amendments')
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post(`${base}/${randomUUID()}/settle`)
      .expect(401);
    validateToken.mockResolvedValue(null);
    await request(app.getHttpServer() as Server)
      .get(base)
      .set('Cookie', 'satoken=expired')
      .expect(401);
    for (const method of Object.values(svc))
      expect(method).not.toHaveBeenCalled();
  });
  it('rejects malformed amendment UUIDs before either write service runs', async () => {
    for (const id of ['not-a-uuid', '123']) {
      await request(app.getHttpServer() as Server)
        .post(`${base}/${id}/settle`)
        .set('Cookie', 'satoken=fixture')
        .expect(400);
      await request(app.getHttpServer() as Server)
        .post(`${base}/${id}/decision`)
        .set('Cookie', 'satoken=fixture')
        .send({ action: 'confirm' })
        .expect(400);
    }
    expect(svc.settle).not.toHaveBeenCalled();
    expect(svc.decide).not.toHaveBeenCalled();
  });
  it('validates bounded queries and rejects caller-supplied identities', async () => {
    for (const query of [
      'limit=0',
      'limit=101',
      'limit=1.5',
      'cursor=invalid',
      'userId=someone-else',
    ]) {
      await request(app.getHttpServer() as Server)
        .get(`${base}?${query}`)
        .set('Cookie', 'satoken=fixture')
        .expect(400);
    }
    await request(app.getHttpServer() as Server)
      .get('/crews/crew-1/application-amendments?status=effective')
      .set('Cookie', 'satoken=fixture')
      .expect(400);
    expect(svc.list).not.toHaveBeenCalled();
    expect(svc.listSettlementQueue).not.toHaveBeenCalled();
  });
  it('forwards parsed pagination and only the authenticated actor', async () => {
    const cursor = randomUUID();
    await request(app.getHttpServer() as Server)
      .get(`${base}?limit=5&cursor=${cursor}`)
      .set('Cookie', 'satoken=fixture')
      .expect(200, { items: [], nextCursor: null });
    expect(svc.list).toHaveBeenCalledWith(
      'application-1',
      'authenticated-actor',
      { limit: 5, cursor },
    );
    await request(app.getHttpServer() as Server)
      .get('/crews/crew-1/application-amendments')
      .set('Cookie', 'satoken=fixture')
      .expect(200);
    expect(svc.listSettlementQueue).toHaveBeenCalledWith(
      'crew-1',
      'authenticated-actor',
      { limit: 20, status: 'awaiting_settlement' },
    );
    const id = randomUUID();
    await request(app.getHttpServer() as Server)
      .post(`${base}/${id}/settle`)
      .set('Cookie', 'satoken=fixture')
      .send({ userId: 'someone-else' })
      .expect(201);
    expect(svc.settle).toHaveBeenCalledWith(
      'application-1',
      id,
      'authenticated-actor',
    );
    await request(app.getHttpServer() as Server)
      .post(`${base}/${id}/decision`)
      .set('Cookie', 'satoken=fixture')
      .send({ action: 'confirm' })
      .expect(201);
    expect(svc.decide).toHaveBeenCalledWith(
      'application-1',
      id,
      'authenticated-actor',
      'confirm',
    );
  });
  it('preserves finance authorization denial as an HTTP error', async () => {
    svc.listSettlementQueue.mockRejectedValue(
      new ForbiddenException('Finance permission required'),
    );
    svc.settle.mockRejectedValue(
      new ForbiddenException('Finance permission required'),
    );
    await request(app.getHttpServer() as Server)
      .get('/crews/crew-1/application-amendments')
      .set('Cookie', 'satoken=fixture')
      .expect(403);
    await request(app.getHttpServer() as Server)
      .post(`${base}/${randomUUID()}/settle`)
      .set('Cookie', 'satoken=fixture')
      .expect(403);
  });
});
