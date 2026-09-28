import { Logger } from '@nestjs/common';
import { AlertingService } from './alerting.service';
import type { AlertEvent } from './alerting.types';

describe('Alert delivery during Redis failures', () => {
  const event: AlertEvent = {
    kind: 'server_http_exception',
    severity: 'error',
    source: 'server.http',
    title: 'Request failed',
    fingerprint: 'test-request-error',
  };
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  let post: jest.Mock;
  let redis: { status: string; set: jest.Mock };
  let service: AlertingService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.FEISHU_ALERT_ENABLED = 'true';
    process.env.FEISHU_ALERT_WEBHOOK_URL = 'https://alerts.test.invalid';
    process.env.FEISHU_ALERT_DEDUP_TTL_SECONDS = '30';
    post = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{"code":0}'),
    });
    global.fetch = post as typeof fetch;
    redis = { status: 'ready', set: jest.fn().mockResolvedValue('OK') };
    service = new AlertingService(redis as never);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it('sends one alert for concurrent duplicates while Redis is healthy', async () => {
    await Promise.all([service.dispatch(event), service.dispatch(event)]);
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('respects a duplicate already claimed by another process', async () => {
    redis.set.mockResolvedValue(null);
    await service.dispatch(event);
    expect(post).not.toHaveBeenCalled();
  });

  it('still delivers when Redis rejects the deduplication command', async () => {
    redis.set.mockRejectedValue(new Error('Redis unavailable'));
    await service.dispatch(event);
    await service.dispatch(event);
    expect(post).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it('skips offline commands and limits repeated alerts until the TTL expires', async () => {
    redis.status = 'reconnecting';
    await service.dispatch(event);
    await service.dispatch(event);
    expect(redis.set).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30_000);
    await service.dispatch(event);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('delivers within one second when Redis stalls after the readiness check', async () => {
    redis.set.mockReturnValue(new Promise(() => {}));
    const pending = service.dispatch(event);
    await jest.advanceTimersByTimeAsync(999);
    expect(post).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await pending;
    expect(post).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not contact Redis or the webhook when alerts are disabled', async () => {
    process.env.FEISHU_ALERT_ENABLED = 'false';
    await service.dispatch(event);
    expect(redis.set).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
  it('rejects a failed body read after successful HTTP headers', async () => {
    const failure = new Error('response connection closed');
    post.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(failure);
          },
        }),
        { status: 200 },
      ),
    );
    await expect(service.dispatch(event)).rejects.toBe(failure);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('logs a response-body timeout through the non-blocking notify path', async () => {
    process.env.FEISHU_ALERT_TIMEOUT_MS = '1000';
    post.mockImplementation((_url: string, options: RequestInit) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              options.signal!.addEventListener(
                'abort',
                () => {
                  controller.error(new Error('alert response timed out'));
                },
                { once: true },
              );
            },
          }),
          { status: 200 },
        ),
      ),
    );
    service.notify(event);
    await jest.advanceTimersByTimeAsync(1000);
    expect(warn).toHaveBeenCalledWith(
      'Alert dispatch failed: alert response timed out',
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('preserves successful empty acknowledgements', async () => {
    post.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(service.dispatch(event)).resolves.toBeUndefined();
  });
});
