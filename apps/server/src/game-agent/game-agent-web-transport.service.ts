import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  OnModuleDestroy,
  PayloadTooLargeException,
  RequestTimeoutException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Readable } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import { AuthService, type AuthUser } from '../auth';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { GameAgentConfigService } from './game-agent.config';
import { gameAgentWebPath } from './game-agent-web-path';

const MAX_BODY = 2 * 1024 * 1024;
const MAX_WS_MESSAGE = 1024 * 1024;
const MAX_WS_RELAY = 8 * 1024 * 1024;

@Injectable()
export class GameAgentWebTransportService implements OnModuleDestroy {
  private readonly server = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_MESSAGE,
    perMessageDeflate: false,
  });
  private readonly upstreams = new Set<WebSocket>();

  constructor(
    private readonly config: GameAgentConfigService,
    private readonly auth: AuthService,
    private readonly permissions: StoryPermissionService,
  ) {}

  matchesPath(url: string | undefined) {
    return /^\/(?:aurora\/)?game-agent\/projects\//.test(url ?? '');
  }

  private async authorize(user: AuthUser, projectId: string) {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.generate',
    );
    if (!access.capabilities.includes('story.edit'))
      throw new ForbiddenException(
        'You do not have permission to edit this story.',
      );
  }

  private headers(userId: string, projectId: string) {
    return {
      'x-game-agent-internal-token': this.config.value.internalToken,
      'x-game-agent-scope': Buffer.from(
        JSON.stringify({ userId, projectId }),
      ).toString('base64url'),
    };
  }

  async proxy(
    user: AuthUser,
    projectId: string,
    id: string,
    request: Request,
    response: Response,
  ) {
    const route = gameAgentWebPath(request.originalUrl);
    if (!route || route.projectId !== projectId || route.id !== id)
      throw new BadRequestException('Invalid Game Agent session route.');
    if (!['GET', 'HEAD', 'POST'].includes(request.method))
      throw new BadRequestException('Unsupported Game Agent request method.');
    if (
      request.method === 'POST' &&
      request.headers.origin !== this.config.value.studioOrigin
    )
      throw new ForbiddenException(
        'Game Agent requires the trusted Studio origin.',
      );
    const controller = new AbortController();
    let reading = false;
    const disconnect = () => {
      if (!response.writableEnded) controller.abort();
    };
    const abortBody = () => {
      if (reading) request.destroy();
    };
    const deadline = setTimeout(() => controller.abort(), 125_000);
    controller.signal.addEventListener('abort', abortBody);
    response.once('close', disconnect);
    try {
      await this.authorize(user, projectId);
      if (response.destroyed) controller.abort();
      controller.signal.throwIfAborted();
      if (!route.path && !request.originalUrl.split('?')[0].endsWith('/')) {
        const [pathname, ...query] = request.originalUrl.split('?');
        response.setHeader('Cache-Control', 'no-store');
        response.redirect(
          308,
          `${pathname}/${query.length ? `?${query.join('?')}` : ''}`,
        );
        return;
      }
      let body: Buffer | undefined;
      if (request.method === 'POST') {
        const raw = (request as Request & { rawBody?: Buffer }).rawBody;
        if (raw) {
          if (raw.length > MAX_BODY) throw new PayloadTooLargeException();
          body = raw;
        } else {
          if (request.body !== undefined)
            throw new BadRequestException(
              'Game Agent requires a JSON request body.',
            );
          const chunks: Buffer[] = [];
          let size = 0;
          reading = true;
          for await (const chunk of request) {
            const buffer = Buffer.from(chunk as Uint8Array);
            size += buffer.length;
            if (size > MAX_BODY) throw new PayloadTooLargeException();
            chunks.push(buffer);
          }
          reading = false;
          body = Buffer.concat(chunks);
        }
      }
      controller.signal.throwIfAborted();
      const upstream = await fetch(
        `${this.config.value.workerBaseUrl}/v1/game-agent/appearance/web/${id}/proxy/${route.suffix}`,
        {
          method: request.method,
          headers: {
            ...this.headers(user.userId, projectId),
            ...(request.method === 'POST'
              ? { 'content-type': 'application/json' }
              : {}),
          },
          body: body ? Uint8Array.from(body) : undefined,
          signal: controller.signal,
          redirect: 'manual',
        },
      );
      if (upstream.status >= 300 && upstream.status < 400)
        throw new BadGatewayException(
          'Game Agent returned an unexpected redirect.',
        );
      response.status(upstream.status);
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      const type = upstream.headers.get('content-type');
      if (type) response.setHeader('Content-Type', type);
      if (request.method === 'HEAD' || !upstream.body) {
        response.end();
        return;
      }
      const stream = Readable.fromWeb(upstream.body as never);
      stream.pipe(response);
      await new Promise<void>((resolve, reject) => {
        stream.once('end', resolve);
        stream.once('error', reject);
        controller.signal.addEventListener(
          'abort',
          () => {
            stream.destroy();
            response.destroy();
            resolve();
          },
          { once: true },
        );
      });
    } catch (error) {
      if (response.destroyed) return;
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (controller.signal.aborted)
        throw new RequestTimeoutException('Game Agent request timed out.');
      if (error instanceof HttpException) throw error;
      throw new BadGatewayException('Game Agent is unavailable.');
    } finally {
      clearTimeout(deadline);
      controller.signal.removeEventListener('abort', abortBody);
      response.off('close', disconnect);
    }
  }

  async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const reject = (status = 403) => {
      socket.end(
        `HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\n\r\n`,
      );
    };
    try {
      const route = gameAgentWebPath(request.url);
      if (
        !route ||
        route.path !== 'api/remote.mux' ||
        request.headers.origin !== this.config.value.studioOrigin
      )
        return reject();
      const cookie = request.headers.cookie;
      const session = cookie
        ? await this.auth.validateSessionContext(cookie)
        : null;
      if (!session) return reject(401);
      await this.authorize(session.user, route.projectId);
      if (socket.destroyed) return;
      const url = new URL(
        `${this.config.value.workerBaseUrl}/v1/game-agent/appearance/web/${route.id}/proxy/api/remote.mux`,
      );
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const upstream = new WebSocket(url, {
        headers: this.headers(session.user.userId, route.projectId),
        maxPayload: MAX_WS_RELAY,
        perMessageDeflate: false,
        handshakeTimeout: 15_000,
      });
      this.upstreams.add(upstream);
      let browser: WebSocket | undefined;
      let checking = false;
      let timer: NodeJS.Timeout | undefined;
      const cleanup = () => {
        if (timer) clearInterval(timer);
        this.upstreams.delete(upstream);
        upstream.terminate();
        browser?.terminate();
      };
      socket.once('close', cleanup);
      upstream.once('error', () => {
        if (!browser) reject(502);
        cleanup();
      });
      upstream.once('close', cleanup);
      upstream.once('open', () => {
        if (socket.destroyed) return cleanup();
        this.server.handleUpgrade(request, socket, head, (client) => {
          browser = client;
          client.once('close', cleanup);
          client.once('error', cleanup);
          client.on('message', (data, binary) => {
            const size = Array.isArray(data)
              ? data.reduce((sum, item) => sum + item.byteLength, 0)
              : data.byteLength;
            if (
              upstream.readyState !== WebSocket.OPEN ||
              upstream.bufferedAmount + size > MAX_WS_RELAY
            )
              return cleanup();
            upstream.send(data, { binary }, (error) => {
              if (error) cleanup();
            });
          });
          upstream.on('message', (data, binary) => {
            const size = Array.isArray(data)
              ? data.reduce((sum, item) => sum + item.byteLength, 0)
              : data.byteLength;
            if (
              client.readyState !== WebSocket.OPEN ||
              client.bufferedAmount + size > MAX_WS_RELAY
            )
              return cleanup();
            client.send(data, { binary }, (error) => {
              if (error) cleanup();
            });
          });
          timer = setInterval(() => {
            if (checking) return;
            checking = true;
            void (async () => {
              const current = await this.auth.validateSessionContext(cookie!);
              if (!current || current.user.userId !== session.user.userId)
                throw new ForbiddenException();
              await this.authorize(current.user, route.projectId);
            })()
              .catch(cleanup)
              .finally(() => {
                checking = false;
              });
          }, 60_000);
          timer.unref();
        });
      });
    } catch {
      reject();
    }
  }

  onModuleDestroy() {
    for (const upstream of this.upstreams) upstream.terminate();
    this.upstreams.clear();
    for (const browser of this.server.clients) browser.terminate();
    this.server.close();
  }
}
