import { HealthController } from './health.controller';
import type { OutputStorageService } from '../storage/storage.types';
import type { PrismaService } from '../db/db.module';
import type Redis from 'ioredis';
import type { Response } from 'express';
jest.mock('../../auth', () => ({ Public: () => () => {} }));
jest.mock('../db/db.module', () => ({ PrismaService: class {} }));
jest.mock('../redis/redis.module', () => ({ REDIS: Symbol('redis') }));
function fixture(ping: () => Promise<string> = async () => 'PONG') {
  const storage = {
    providerId: 'fixture',
    isHealthy: jest.fn(async () => true),
  };
  const db = { $queryRaw: jest.fn(async () => []) };
  const redis = { ping: jest.fn(ping) };
  const status = jest.fn();
  const controller = new HealthController(
    storage as unknown as OutputStorageService,
    db as unknown as PrismaService,
    redis as unknown as Redis,
  );
  return {
    controller,
    storage,
    redis,
    status,
    response: { status } as unknown as Response,
  };
}
describe('readiness controller', () => {
  const transport = process.env.REALTIME_TRANSPORT;
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.REALTIME_TRANSPORT = '';
  });
  afterEach(() => {
    jest.useRealTimers();
    if (transport === undefined) delete process.env.REALTIME_TRANSPORT;
    else process.env.REALTIME_TRANSPORT = transport;
  });
  it('keeps healthy readiness and liveness responses', async () => {
    const f = fixture();
    expect((await f.controller.readiness(f.response)).status).toBe('ready');
    expect(f.status).not.toHaveBeenCalled();
    expect(f.controller.liveness()).toEqual({ status: 'ok' });
  });
  it('returns 503 on a stuck dependency, coalesces callers and recovers', async () => {
    let resolve!: (pong: string) => void;
    const f = fixture(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    const first = f.controller.readiness(f.response);
    const second = f.controller.readiness(f.response);
    await jest.advanceTimersByTimeAsync(3_000);
    for (const result of await Promise.all([first, second])) {
      expect(result.status).toBe('unready');
      expect(result.checks.find((c) => c.name === 'redis')?.ok).toBe(false);
    }
    expect(f.status).toHaveBeenCalledWith(503);
    expect(f.redis.ping).toHaveBeenCalledTimes(1);
    resolve('PONG');
    await jest.advanceTimersByTimeAsync(0);
    f.redis.ping.mockResolvedValue('PONG');
    expect((await f.controller.readiness(f.response)).status).toBe('ready');
  });
  it('contains unexpected storage exceptions without exposing details', async () => {
    const f = fixture();
    f.storage.isHealthy.mockRejectedValue(new Error('private-key-value'));
    const result = await f.controller.readiness(f.response);
    expect(result.status).toBe('unready');
    expect(JSON.stringify(result)).not.toContain('private-key-value');
  });
});
