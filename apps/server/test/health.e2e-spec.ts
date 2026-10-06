import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { HealthController } from '../src/infra/health/health.controller';
import { PrismaService } from '../src/infra/db/db.module';
import { REDIS } from '../src/infra/redis/redis.module';
import { OutputStorageService } from '../src/infra/storage/storage.types';

// Real Nest HTTP routing/serialization with owned dependency fixtures.
// Does not boot production workers or establish external connections.
describe('Health HTTP contract', () => {
  let app: INestApplication<App>;
  const storage = { providerId: 'fixture', isHealthy: jest.fn() };
  const prisma = { $queryRaw: jest.fn() };
  const redis = { ping: jest.fn() };
  const previousTransport = process.env.REALTIME_TRANSPORT;
  const previousSecret = process.env.REALTIME_WS_SECRET;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: OutputStorageService, useValue: storage },
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS, useValue: redis },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    process.env.REALTIME_TRANSPORT = '';
    storage.isHealthy.mockReset().mockResolvedValue(true);
    prisma.$queryRaw.mockReset().mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockReset().mockResolvedValue('PONG');
  });
  afterAll(async () => {
    await app?.close();
    for (const [key, value] of [
      ['REALTIME_TRANSPORT', previousTransport],
      ['REALTIME_WS_SECRET', previousSecret],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  });
  it('answers liveness without probing dependencies', async () => {
    await request(app.getHttpServer())
      .get('/healthz')
      .expect(200, { status: 'ok' });
    expect(storage.isHealthy).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });
  it('returns ready when every dependency succeeds', async () => {
    const response = await request(app.getHttpServer())
      .get('/ready')
      .expect(200);
    expect(response.body).toEqual({
      status: 'ready',
      checks: expect.arrayContaining([
        expect.objectContaining({ name: 'output_storage', ok: true }),
        expect.objectContaining({ name: 'postgres', ok: true }),
        expect.objectContaining({ name: 'redis', ok: true }),
      ]) as unknown,
    });
  });
  it.each(['output_storage', 'postgres', 'redis'])(
    'withdraws readiness for %s failure, preserves liveness and recovers',
    async (dependency) => {
      const probe =
        dependency === 'output_storage'
          ? storage.isHealthy
          : dependency === 'postgres'
            ? prisma.$queryRaw
            : redis.ping;
      probe.mockRejectedValueOnce(new Error('private-connection-detail'));
      const response = await request(app.getHttpServer())
        .get('/ready')
        .expect(503);
      expect(response.body).toMatchObject({
        status: 'unready',
        checks: expect.arrayContaining([
          expect.objectContaining({ name: dependency, ok: false }),
        ]) as unknown,
      });
      expect(response.text).not.toContain('private-connection-detail');
      await request(app.getHttpServer()).get('/healthz').expect(200);
      await request(app.getHttpServer()).get('/ready').expect(200);
    },
  );
  it('requires a signing secret when self-hosted realtime is enabled', async () => {
    process.env.REALTIME_TRANSPORT = 'self-hosted';
    delete process.env.REALTIME_WS_SECRET;
    await request(app.getHttpServer()).get('/ready').expect(503);
    process.env.REALTIME_WS_SECRET = 'owned-fixture-secret';
    await request(app.getHttpServer()).get('/ready').expect(200);
  });
});
