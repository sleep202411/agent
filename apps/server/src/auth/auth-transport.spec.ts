import { EventEmitter } from 'node:events';
import { get } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { AuthService } from './auth.service';

jest.mock('node:http', () => ({ get: jest.fn() }));

describe('Auth transport completion and shutdown', () => {
  let service: AuthService;
  let request: EventEmitter & { destroy: jest.Mock };
  let response: EventEmitter & {
    statusCode: number;
    complete: boolean;
    setEncoding: jest.Mock;
    destroy: jest.Mock;
  };
  let respond: (value: IncomingMessage) => void;
  const read = () =>
    (
      service as unknown as {
        getJson: (
          url: string,
          cookie: string,
          label: string,
          timeout: number,
        ) => Promise<unknown>;
      }
    ).getJson('http://fixture/auth', 'satoken=fixture', 'fixture', 100);
  beforeEach(() => {
    jest.useFakeTimers();
    request = Object.assign(new EventEmitter(), { destroy: jest.fn() });
    response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      complete: false,
      setEncoding: jest.fn(),
      destroy: jest.fn(),
    });
    jest
      .mocked(get)
      .mockReset()
      .mockImplementation((...args: unknown[]) => {
        respond = args[2] as typeof respond;
        return request as never;
      });
    service = new AuthService();
  });
  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it.each(['connection', 'trickle'] as const)(
    'bounds the complete %s wait',
    async (phase) => {
      const pending = read();
      if (phase === 'trickle') {
        respond(response as never);
        for (let i = 0; i < 4; i++) {
          await jest.advanceTimersByTimeAsync(20);
          response.emit('data', ' ');
        }
      }
      await jest.advanceTimersByTimeAsync(100);
      await expect(pending).resolves.toBeNull();
      expect(request.destroy).toHaveBeenCalledTimes(1);
      response.emit('data', '{}');
      response.emit('end');
      expect(jest.getTimerCount()).toBe(1);
    },
  );

  it.each(['error', 'aborted', 'close'] as const)(
    'settles a response %s and permits another request',
    async (event) => {
      const pending = read();
      respond(response as never);
      response.emit(event, new Error('fixture'));
      await expect(pending).resolves.toBeNull();
      const next = read();
      respond(response as never);
      response.emit('data', '{"ok":true}');
      response.complete = true;
      response.emit('end');
      await expect(next).resolves.toEqual({ ok: true });
      expect(jest.getTimerCount()).toBe(1);
    },
  );

  it('releases its timer on success and does not destroy the completed request', async () => {
    const pending = read();
    respond(response as never);
    response.emit('data', '{"ok":true}');
    response.complete = true;
    response.emit('end');
    response.emit('close');
    await expect(pending).resolves.toEqual({ ok: true });
    await jest.advanceTimersByTimeAsync(100);
    expect(request.destroy).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
  });

  it('settles shutdown requests and rejects later admission', async () => {
    const pending = read();
    service.onModuleDestroy();
    await expect(pending).resolves.toBeNull();
    await expect(read()).resolves.toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
    expect(request.destroy).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not cache or return a validation that completes after shutdown', async () => {
    let release!: (user: { userId: string }) => void;
    const internal = service as unknown as {
      validateSatoken: () => Promise<{ userId: string }>;
      cache: Map<string, unknown>;
    };
    jest.spyOn(internal, 'validateSatoken').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = service.validateToken('satoken=fixture');
    service.onModuleDestroy();
    release({ userId: 'creator' });
    await expect(pending).resolves.toBeNull();
    expect(internal.cache.size).toBe(0);
    await expect(service.validateToken('satoken=fixture')).resolves.toBeNull();
  });
});
