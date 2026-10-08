import type { INestApplicationContext } from '@nestjs/common';
import { createServer } from 'node:http';
import { Duplex } from 'node:stream';
import type { WebSocketServer } from 'ws';
import { RoutedWsAdapter } from './routed-ws-adapter';

function fixture() {
  const server = createServer();
  const scoped = {
    matchesPath: (url: string | undefined) =>
      url?.startsWith('/game-agent/') ?? false,
    handleUpgrade: jest.fn().mockResolvedValue(undefined),
  };
  const adapter = new RoutedWsAdapter(
    server as unknown as INestApplicationContext,
    scoped,
  );
  const socket = new Duplex({
    read() {},
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const request = (url: string) => ({ url, headers: { host: 'localhost' } });
  return { server, scoped, adapter, socket, request };
}

it('routes scoped upgrades even with no platform gateway and installs only one dispatcher', async () => {
  const f = fixture();
  expect(f.server.listenerCount('upgrade')).toBe(1);
  f.server.emit(
    'upgrade',
    f.request('/game-agent/projects/test'),
    f.socket,
    Buffer.alloc(0),
  );
  expect(f.scoped.handleUpgrade).toHaveBeenCalledTimes(1);
  const first = f.adapter.create(0, {
    path: '/platform-one',
  }) as WebSocketServer;
  const second = f.adapter.create(0, {
    path: '/platform-two',
  }) as WebSocketServer;
  expect(f.server.listenerCount('upgrade')).toBe(1);
  first.close();
  second.close();
  await f.adapter.dispose();
});

it('preserves Nest dispatch for existing gateway paths and rejection of unknown paths', async () => {
  const f = fixture();
  const gateway = f.adapter.create(0, { path: '/platform' }) as WebSocketServer;
  const upgrade = jest
    .spyOn(gateway, 'handleUpgrade')
    .mockImplementation(() => undefined);
  f.server.emit('upgrade', f.request('/platform'), f.socket, Buffer.alloc(0));
  expect(upgrade).toHaveBeenCalledTimes(1);
  expect(f.scoped.handleUpgrade).not.toHaveBeenCalled();
  f.server.emit('upgrade', f.request('/missing'), f.socket, Buffer.alloc(0));
  expect(f.socket.destroyed).toBe(true);
  gateway.close();
  await f.adapter.dispose();
});

it('contains rejected scoped upgrades by closing the socket', async () => {
  const f = fixture();
  f.scoped.handleUpgrade.mockRejectedValue(new Error('unavailable'));
  f.server.emit(
    'upgrade',
    f.request('/game-agent/projects/test'),
    f.socket,
    Buffer.alloc(0),
  );
  await Promise.resolve();
  expect(f.socket.destroyed).toBe(true);
  await f.adapter.dispose();
});
