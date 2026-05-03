/**
 * EntityEventsGateway — WS broker for per-user entity-change events.
 *
 * Sibling of ChatEventsGateway. Whereas chat events are scoped to a
 * single projectId (one conversation), entity events are scoped to
 * userId so one connection surfaces mutations made anywhere in the
 * user's session — other tabs, background workers, LLM tool calls,
 * button short-circuits, etc.
 *
 * Client lifecycle:
 *   1. Connect ws://.../aurora/entity-events/subscribe
 *   2. Server authenticates cookie → binds socket to userId
 *   3. Server pushes events:
 *        { event: "entity_changed", data: EntityEvent }
 *   4. Heartbeat every 30s + protocol-level ping
 *
 * Wire: push-only channel. The client's only job is to read
 * `entity_changed` events and invalidate caches / refetch queries.
 */
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { IncomingMessage } from 'http';
import type { Server, WebSocket } from 'ws';
import {
  ENTITY_EVENTS_CHANNEL_PATTERN,
  ENTITY_EVENTS_CHANNEL_PREFIX,
  type EntityEvent,
} from '@repo/shared/entity-events';
import { AuthService } from '../../auth/auth.service';

const HEARTBEAT_INTERVAL_MS = 30_000;
const ZOMBIE_TIMEOUT_MS = 90_000;

const CLOSE_POLICY = 1008;
const CLOSE_NORMAL = 1000;

type TrackedSocket = WebSocket & {
  __userId?: string;
  __lastActivity?: number;
  __zombieCheck?: NodeJS.Timeout;
};

@WebSocketGateway({
  path: '/aurora/entity-events/subscribe',
})
export class EntityEventsGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger(EntityEventsGateway.name);

  @WebSocketServer()
  private server!: Server;

  private redisSubscriber!: Redis;

  /** userId → set of sockets watching. */
  private readonly socketsByUser = new Map<string, Set<TrackedSocket>>();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(private readonly authService: AuthService) {}

  afterInit(_server: Server) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.redisSubscriber = new Redis(url, { maxRetriesPerRequest: null });

    this.redisSubscriber.psubscribe(ENTITY_EVENTS_CHANNEL_PATTERN, (err) => {
      if (err) {
        this.logger.error(
          `Failed to psubscribe(${ENTITY_EVENTS_CHANNEL_PATTERN}): ${err.message}`,
        );
        return;
      }
      this.logger.log(
        `EntityEventsGateway subscribed to ${ENTITY_EVENTS_CHANNEL_PATTERN}`,
      );
    });

    this.redisSubscriber.on('pmessage', (_pattern, channel, raw) => {
      const userId = channel.slice(ENTITY_EVENTS_CHANNEL_PREFIX.length);
      const subs = this.socketsByUser.get(userId);
      this.logger.log(
        `pmessage channel=${channel} userId=${userId} subscribers=${subs?.size ?? 0}`,
      );
      if (!subs || subs.size === 0) return;
      let parsed: EntityEvent;
      try {
        parsed = JSON.parse(raw) as EntityEvent;
      } catch {
        this.logger.warn(`Malformed pub/sub payload on ${channel}`);
        return;
      }
      const frame = JSON.stringify({ event: 'entity_changed', data: parsed });
      for (const sock of subs) {
        if (sock.readyState === sock.OPEN) sock.send(frame);
      }
    });

    this.heartbeatTimer = setInterval(
      () => void this.sendHeartbeats(),
      HEARTBEAT_INTERVAL_MS,
    );
  }

  async handleConnection(client: TrackedSocket, request: IncomingMessage) {
    try {
      // Cookie header is preferred. When the page is served from a
      // different origin than the WS host (CDN-fronted main domain →
      // platform host), the browser won't auto-attach cookies, so the
      // client tunnels `satoken` through the query string instead.
      let cookie = request.headers.cookie;
      if (!cookie && request.url) {
        const url = new URL(request.url, 'http://localhost');
        const t = url.searchParams.get('satoken');
        if (t) cookie = `satoken=${t}`;
      }
      const user = await this.authenticateFromCookie(cookie);
      if (!user) {
        this.close(client, CLOSE_POLICY, 'unauthorized');
        return;
      }

      client.__userId = user.userId;
      client.__lastActivity = Date.now();
      this.addSubscriber(user.userId, client);

      // Zombie watchdog — mirrors ChatEventsGateway.
      client.__zombieCheck = setInterval(() => {
        const last = client.__lastActivity ?? 0;
        if (Date.now() - last > ZOMBIE_TIMEOUT_MS) {
          this.close(client, CLOSE_NORMAL, 'zombie_timeout');
        }
      }, HEARTBEAT_INTERVAL_MS);

      client.on('pong', () => (client.__lastActivity = Date.now()));
      client.on('message', () => (client.__lastActivity = Date.now()));

      // Initial heartbeat so the client knows we're live.
      client.send(
        JSON.stringify({
          event: 'heartbeat',
          data: { serverTime: Date.now() },
        }),
      );

      this.logger.log(`ws connected userId=${user.userId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`handleConnection failed: ${msg}`);
      this.close(client, CLOSE_POLICY, 'handshake_error');
    }
  }

  handleDisconnect(client: TrackedSocket) {
    if (client.__zombieCheck) clearInterval(client.__zombieCheck);
    const userId = client.__userId;
    if (!userId) return;
    const subs = this.socketsByUser.get(userId);
    if (subs) {
      subs.delete(client);
      if (subs.size === 0) this.socketsByUser.delete(userId);
    }
    this.logger.log(`ws disconnected userId=${userId}`);
  }

  async onModuleDestroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    try {
      await this.redisSubscriber?.quit();
    } catch {}
  }

  // ─── Helpers ─────────────────────────────────────────────

  private addSubscriber(userId: string, sock: TrackedSocket) {
    let set = this.socketsByUser.get(userId);
    if (!set) {
      set = new Set();
      this.socketsByUser.set(userId, set);
    }
    set.add(sock);
  }

  private async authenticateFromCookie(cookie: string | undefined) {
    if (process.env.AUTH_DISABLED === 'true') {
      return {
        userId: 'dev',
        userName: 'dev',
        nickName: 'Developer',
        userLevel: 'VIP3' as const,
      };
    }
    if (!cookie) return null;
    try {
      return await this.authService.validateToken(cookie);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`ws auth failed: ${msg}`);
      return null;
    }
  }

  private close(client: WebSocket, code: number, reason: string) {
    try {
      client.send(
        JSON.stringify({ event: 'terminate', data: { reason, code } }),
      );
    } catch {}
    try {
      client.close(code, reason);
    } catch {}
  }

  private async sendHeartbeats() {
    for (const subs of this.socketsByUser.values()) {
      for (const sock of subs) {
        if (sock.readyState !== sock.OPEN) continue;
        try {
          sock.send(
            JSON.stringify({
              event: 'heartbeat',
              data: { serverTime: Date.now() },
            }),
          );
          (sock as TrackedSocket & { ping?: () => void }).ping?.();
        } catch {}
      }
    }
  }
}
