import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import Redis from 'ioredis';
import type { WebSocket } from 'ws';
import { ConversationsGateway } from './conversations.gateway';
import type { AuthService } from '../auth/auth.service';

jest.mock('ioredis');

class FakeRedis extends EventEmitter {
  status = 'connecting';
  psubscribe = jest.fn<Promise<number>, [string]>();
  quit = jest.fn().mockResolvedValue('OK');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function socket() {
  return {
    OPEN: 1,
    readyState: 1,
    send: jest.fn<void, [string]>(),
    close: jest.fn(),
    on: jest.fn(),
  } as unknown as WebSocket & {
    send: jest.Mock<void, [string]>;
    close: jest.Mock;
    on: jest.Mock;
  };
}

function request(): IncomingMessage {
  return {
    headers: { cookie: 'satoken=test' },
    url: '/ws/conversations',
  } as IncomingMessage;
}

describe('ConversationsGateway recovery boundary', () => {
  let redis: FakeRedis;
  let gateway: ConversationsGateway;

  beforeEach(() => {
    jest.useFakeTimers();
    redis = new FakeRedis();
    (Redis as unknown as jest.Mock).mockImplementation(() => redis);
    const auth = {
      validateToken: jest.fn().mockResolvedValue({ userId: 'user-1' }),
    };
    gateway = new ConversationsGateway(auth as unknown as AuthService);
    gateway.afterInit();
  });

  afterEach(async () => {
    await gateway.onModuleDestroy();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('does not send ready before Redis acknowledges the pattern subscription', async () => {
    const subscribed = deferred<number>();
    redis.psubscribe.mockReturnValueOnce(subscribed.promise);
    redis.status = 'ready';
    redis.emit('ready');

    const client = socket();
    const connected = gateway.handleConnection(client, request());
    await Promise.resolve();
    expect(client.send).not.toHaveBeenCalled();

    subscribed.resolve(1);
    await connected;

    expect(
      client.send.mock.calls.some(
        ([raw]) => (JSON.parse(raw) as { event?: unknown }).event === 'ready',
      ),
    ).toBe(true);
  });

  it('sends a fresh ready boundary after a Redis-only reconnect', async () => {
    redis.psubscribe.mockResolvedValue(1);
    redis.status = 'ready';
    redis.emit('ready');
    await Promise.resolve();
    await Promise.resolve();

    const client = socket();
    await gateway.handleConnection(client, request());
    client.send.mockClear();

    redis.emit('close');
    redis.status = 'ready';
    redis.emit('ready');
    await Promise.resolve();
    await Promise.resolve();

    expect(
      client.send.mock.calls.filter(
        ([raw]) => (JSON.parse(raw) as { event?: unknown }).event === 'ready',
      ),
    ).toHaveLength(1);
  });
});
