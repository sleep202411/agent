import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { json } from 'express';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import WebSocket, { WebSocketServer } from 'ws';
import { AuthGuard, AuthService } from '../auth';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { GameAgentConfigService } from './game-agent.config';
import { GameAgentWebProxyController } from './game-agent-web-proxy.controller';
import { GameAgentWebTransportService } from './game-agent-web-transport.service';
import { gameAgentWebPath } from './game-agent-web-path';

const PROJECT = '019f60f4-b101-70d4-8000-000000000002';
const ID = '019f60f4-b101-70d4-8000-000000000003';
const ORIGIN = 'https://fizzdragon.com';
const mount = `/game-agent/projects/${PROJECT}/appearance/web/${ID}`;

it.each([
  '../api/remote.mux',
  '%2e%2e/api/remote.mux',
  '%252e%252e/api/remote.mux',
  'api%2fremote.mux',
  'api\\remote.mux',
])('rejects ambiguous or traversing mount path %s', (path) => {
  expect(() => gameAgentWebPath(`${mount}/${path}`)).toThrow(
    'Invalid Game Agent request path.',
  );
});

describe('authenticated GUI HTTP and WebSocket transport', () => {
  let app: INestApplication;
  let upstream: Server;
  let sockets: WebSocketServer;
  let transport: GameAgentWebTransportService;
  let browserBase: string;
  let workerFrames = 0;
  const received: Array<{
    path?: string;
    headers: Record<string, unknown>;
    body?: string;
  }> = [];
  const permissions = { requireProject: jest.fn() };
  const auth = {
    validateSessionContext: jest.fn((cookie: string) =>
      Promise.resolve(
        cookie === 'satoken=actor'
          ? { user: { userId: 'actor' }, cookie }
          : null,
      ),
    ),
  };

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req)
          chunks.push(Buffer.from(chunk as Uint8Array));
        received.push({
          path: req.url,
          headers: { ...req.headers },
          body: Buffer.concat(chunks).toString(),
        });
        res.writeHead(200, {
          'content-type': 'text/plain',
          'set-cookie': 'private-harness-token=never-expose',
          location: 'http://localhost:1234/?token=never-expose',
        });
        if (req.url?.endsWith('/hanging-body')) {
          res.write('partial GUI output');
          return;
        }
        res.end('private GUI output');
      })().catch(() => res.destroy());
    });
    sockets = new WebSocketServer({ noServer: true });
    upstream.on('upgrade', (req, socket, head) => {
      received.push({ path: req.url, headers: { ...req.headers } });
      sockets.handleUpgrade(req, socket, head, (connection) => {
        connection.on('message', (data, binary) => {
          workerFrames += 1;
          if (Buffer.isBuffer(data) && data.toString() === 'large-history')
            connection.send('h'.repeat(3 * 1024 * 1024));
          else connection.send(data, { binary });
        });
      });
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const workerBaseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const module = await Test.createTestingModule({
      controllers: [GameAgentWebProxyController],
      providers: [
        GameAgentWebTransportService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: AuthService, useValue: auth },
        { provide: StoryPermissionService, useValue: permissions },
        {
          provide: GameAgentConfigService,
          useValue: {
            value: {
              workerBaseUrl,
              internalToken: 'private-test-internal-token',
              studioOrigin: ORIGIN,
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication({ bodyParser: false });
    app.use(
      json({
        limit: '3mb',
        verify: (req, _res, buffer) => {
          (req as typeof req & { rawBody?: Buffer }).rawBody =
            Buffer.from(buffer);
        },
      }),
    );
    await app.init();
    transport = module.get(GameAgentWebTransportService);
    const server = app.getHttpServer() as Server;
    server.on('upgrade', (req, socket, head) => {
      void transport.handleUpgrade(req, socket, head);
    });
    await app.listen(0, '127.0.0.1');
    browserBase = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    await app.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
  beforeEach(() => {
    received.length = 0;
    workerFrames = 0;
    jest.clearAllMocks();
    permissions.requireProject.mockResolvedValue({
      capabilities: ['story.generate', 'story.edit'],
    });
  });

  it('streams mounted assets with server-only scope and strips worker credentials', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get(`${mount}/assets/app.js?v=1`)
      .set('Cookie', 'satoken=actor')
      .set('Authorization', 'unrelated')
      .expect(200);
    expect(response.text).toBe('private GUI output');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers.location).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(received[0].path).toBe(
      `/v1/game-agent/appearance/web/${ID}/proxy/assets/app.js?v=1`,
    );
    expect(received[0].headers.cookie).toBeUndefined();
    expect(received[0].headers.authorization).toBeUndefined();
    expect(received[0].headers['x-game-agent-internal-token']).toBe(
      'private-test-internal-token',
    );
    expect(
      JSON.parse(
        Buffer.from(
          received[0].headers['x-game-agent-scope'] as string,
          'base64url',
        ).toString(),
      ),
    ).toEqual({ userId: 'actor', projectId: PROJECT });
  });

  it('closes the browser stream when the worker body stalls past its deadline', async () => {
    const schedule = global.setTimeout;
    const timer = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(((
        callback: (...args: unknown[]) => void,
        timeout: number | undefined,
        ...args: unknown[]
      ) =>
        schedule(
          callback,
          timeout === 125_000 ? 100 : timeout,
          ...args,
        )) as typeof setTimeout);
    try {
      const response = await fetch(
        `${browserBase.replace('ws:', 'http:')}${mount}/hanging-body`,
        { headers: { Cookie: 'satoken=actor' } },
      );
      expect(response.status).toBe(200);
      await expect(response.text()).rejects.toThrow();
      expect(received).toHaveLength(1);
    } finally {
      timer.mockRestore();
    }
  });

  it('canonicalizes bare session mounts before resolving any relative GUI assets', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get(`${mount}?locale=en`)
      .set('Cookie', 'satoken=actor')
      .expect(308);
    expect(response.headers.location).toBe(`${mount}/?locale=en`);
    expect(received).toHaveLength(0);
    expect(permissions.requireProject).toHaveBeenCalledWith(
      'actor',
      PROJECT,
      'story.generate',
    );
  });

  it('rechecks project permissions for assets and rejects cross-origin commands', async () => {
    permissions.requireProject.mockRejectedValueOnce(
      new ForbiddenException('Access revoked.'),
    );
    await request(app.getHttpServer() as Server)
      .get(`${mount}/`)
      .set('Cookie', 'satoken=actor')
      .expect(403);
    await request(app.getHttpServer() as Server)
      .post(`${mount}/api/remote.rpc`)
      .set('Cookie', 'satoken=actor')
      .set('Origin', 'https://other.example')
      .send({ endpoint: 'untrusted' })
      .expect(403);
    expect(received).toHaveLength(0);
  });

  it('forwards the exact bounded JSON bytes without user authorization headers', async () => {
    const body = JSON.stringify({
      endpoint: 'Session.test',
      input: { value: 'retained' },
    });
    await request(app.getHttpServer() as Server)
      .post(`${mount}/api/remote.rpc`)
      .set('Cookie', 'satoken=actor')
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(200);
    expect(received[0].body).toBe(body);
    await request(app.getHttpServer() as Server)
      .post(`${mount}/api/remote.rpc`)
      .set('Cookie', 'satoken=actor')
      .set('Origin', ORIGIN)
      .send({ text: 'x'.repeat(2 * 1024 * 1024) })
      .expect(413);
    expect(received).toHaveLength(1);
  });

  it('authenticates WS upgrades before opening the scoped upstream and relays frames', async () => {
    const browser = new WebSocket(`${browserBase}${mount}/api/remote.mux`, {
      origin: ORIGIN,
      headers: { Cookie: 'satoken=actor' },
    });
    try {
      await once(browser, 'open');
      const message = once(browser, 'message');
      browser.send('Harness message');
      const [data] = (await message) as [Buffer];
      expect(data.toString()).toBe('Harness message');
      expect(received[0].path).toBe(
        `/v1/game-agent/appearance/web/${ID}/proxy/api/remote.mux`,
      );
      expect(received[0].headers.cookie).toBeUndefined();
      expect(received[0].headers.authorization).toBeUndefined();
      expect(
        JSON.parse(
          Buffer.from(
            received[0].headers['x-game-agent-scope'] as string,
            'base64url',
          ).toString(),
        ),
      ).toEqual({ userId: 'actor', projectId: PROJECT });
    } finally {
      browser.terminate();
    }
  });

  it('closes an admitted WS when project edit permission is revoked', async () => {
    const schedule = global.setInterval;
    const timer = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(((
        callback: (...args: unknown[]) => void,
        timeout: number | undefined,
        ...args: unknown[]
      ) =>
        schedule(
          callback,
          timeout === 60_000 ? 20 : timeout,
          ...args,
        )) as typeof setInterval);
    const browser = new WebSocket(`${browserBase}${mount}/api/remote.mux`, {
      origin: ORIGIN,
      headers: { Cookie: 'satoken=actor' },
    });
    try {
      await once(browser, 'open');
      permissions.requireProject.mockResolvedValue({
        capabilities: ['story.generate'],
      });
      await once(browser, 'close');
      expect(auth.validateSessionContext).toHaveBeenCalledTimes(2);
      expect(permissions.requireProject).toHaveBeenCalledTimes(2);
    } finally {
      timer.mockRestore();
      browser.terminate();
    }
  });

  it('relays trusted retained history larger than the browser command limit', async () => {
    const browser = new WebSocket(`${browserBase}${mount}/api/remote.mux`, {
      origin: ORIGIN,
      headers: { Cookie: 'satoken=actor' },
    });
    try {
      await once(browser, 'open');
      const message = once(browser, 'message');
      browser.send('large-history');
      const [data] = (await message) as [Buffer];
      expect(data.length).toBe(3 * 1024 * 1024);
      expect(workerFrames).toBe(1);
    } finally {
      browser.terminate();
    }
  });

  it('rejects oversized browser commands before forwarding a worker frame', async () => {
    const browser = new WebSocket(`${browserBase}${mount}/api/remote.mux`, {
      origin: ORIGIN,
      headers: { Cookie: 'satoken=actor' },
    });
    try {
      await once(browser, 'open');
      const closed = once(browser, 'close');
      browser.send(Buffer.alloc(1024 * 1024 + 1));
      await closed;
      expect(workerFrames).toBe(0);
    } finally {
      browser.terminate();
    }
  });

  it.each([
    { origin: ORIGIN, cookie: '' },
    { origin: 'https://other.example', cookie: 'satoken=actor' },
  ])(
    'rejects unauthorized WS admission %j before worker access',
    async ({ origin, cookie }) => {
      const browser = new WebSocket(`${browserBase}${mount}/api/remote.mux`, {
        origin,
        headers: { Cookie: cookie },
      });
      const [error] = (await once(browser, 'error')) as [Error];
      expect(error.message).toMatch(/401|403/);
      expect(received).toHaveLength(0);
      browser.terminate();
    },
  );
});
