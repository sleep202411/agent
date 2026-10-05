import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { DeviceCityController, DeviceCityService } from './device-city';
// Actual guard, controller and validation; session verification/service are fixtures.
describe('device city HTTP boundary', () => {
  let app: INestApplication;
  const service = { read: jest.fn(), suggest: jest.fn() };
  const input = {
    requestId: '11111111-1111-4111-8111-111111111111',
    latitude: 1,
    longitude: 2,
    locale: 'en-US',
    consent: true,
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DeviceCityController],
      providers: [
        { provide: DeviceCityService, useValue: service },
        {
          provide: AuthService,
          useValue: {
            validateSessionContext: (cookie: string) =>
              Promise.resolve(
                cookie === 'satoken=fixture'
                  ? { user: { userId: 'verified-owner' }, cookie }
                  : null,
              ),
          },
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    service.suggest.mockResolvedValue({ state: 'completed', city: null });
    service.read.mockResolvedValue({ state: 'missing', city: null });
  });
  afterAll(async () => app.close());
  it('rejects anonymous and expired sessions', async () => {
    for (const cookie of ['', 'satoken=expired'])
      await request(app.getHttpServer() as Server)
        .post('/creator-location/me/device-city')
        .set('Cookie', cookie)
        .send(input)
        .expect(401);
    expect(service.suggest).not.toHaveBeenCalled();
  });
  it('binds lookup and read to the verified account', async () => {
    await request(app.getHttpServer() as Server)
      .post('/creator-location/me/device-city')
      .set('Cookie', 'satoken=fixture')
      .send(input)
      .expect(200);
    expect(service.suggest).toHaveBeenCalledWith(
      { userId: 'verified-owner' },
      input,
    );
    await request(app.getHttpServer() as Server)
      .get(`/creator-location/me/device-city/${input.requestId}`)
      .set('Cookie', 'satoken=fixture')
      .expect(200);
    expect(service.read).toHaveBeenCalledWith(
      { userId: 'verified-owner' },
      input.requestId,
    );
  });
  it('rejects unconsented, out-of-range, spoofed-owner and malformed requests', async () => {
    for (const invalid of [
      { ...input, consent: false },
      { ...input, latitude: 91 },
      { ...input, userId: 'other' },
      { ...input, requestId: 'bad' },
    ])
      await request(app.getHttpServer() as Server)
        .post('/creator-location/me/device-city')
        .set('Cookie', 'satoken=fixture')
        .send(invalid)
        .expect(400);
    await request(app.getHttpServer() as Server)
      .get('/creator-location/me/device-city/bad')
      .set('Cookie', 'satoken=fixture')
      .expect(400);
    expect(service.suggest).not.toHaveBeenCalled();
    expect(service.read).not.toHaveBeenCalled();
  });
});
