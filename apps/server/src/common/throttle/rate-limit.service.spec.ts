import { Logger } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';

describe('rate limiter Redis outage admission', () => {
  const args = { bucket: 'test', actorId: 'user', max: 3, windowSec: 60 };
  let redis: { status: string; eval: jest.Mock };
  let service: RateLimitService;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(Date.parse('2026-09-22T00:00:10Z'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    redis = { status: 'ready', eval: jest.fn().mockResolvedValue(1) };
    service = new RateLimitService(redis as never);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not enqueue a command while Redis is reconnecting', async () => {
    redis.status = 'reconnecting';
    redis.eval.mockReturnValue(new Promise(() => {}));
    let result: unknown;
    void service.guard(args).then((value) => {
      result = value;
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(redis.eval).not.toHaveBeenCalled();
    expect(result).toEqual({ remaining: 3, resetInSec: 60 });
  });

  it('fails open within one second if Redis stalls after the readiness check', async () => {
    let rejectCommand!: (error: Error) => void;
    redis.eval.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectCommand = reject;
      }),
    );
    let result: unknown;
    void service.guard(args).then((value) => {
      result = value;
    });
    await jest.advanceTimersByTimeAsync(999);
    expect(result).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ remaining: 3, resetInSec: 60 });
    rejectCommand(new Error('late command failure'));
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retains normal counter admission and removes its timer', async () => {
    await expect(service.guard(args)).resolves.toEqual({
      remaining: 2,
      resetInSec: 50,
    });
    expect(jest.getTimerCount()).toBe(0);
  });
  it('retains HTTP 429 when the healthy counter exceeds the maximum', async () => {
    redis.eval.mockResolvedValue(4);
    await expect(service.guard(args)).rejects.toMatchObject({
      status: 429,
      response: { code: 'RATE_LIMITED', retryAfterSec: 50 },
    });
    expect(jest.getTimerCount()).toBe(0);
  });
  it('preserves fail-open on immediate Redis rejection', async () => {
    redis.eval.mockRejectedValue(new Error('Redis unavailable'));
    await expect(service.guard(args)).resolves.toEqual({
      remaining: 3,
      resetInSec: 60,
    });
    expect(jest.getTimerCount()).toBe(0);
  });
});
