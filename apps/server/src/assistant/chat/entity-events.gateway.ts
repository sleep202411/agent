import { requiredEnv } from '../../common/required-env';
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
import { describeUnknown } from '../../common/values';

const HEARTBEAT_INTERVAL_MS = 30_000;
const ZOMBIE_TIMEOUT_MS = 90_000;

const CLOSE_POLICY = 1008;
const CLOSE_NORMAL = 1000;

type TrackedSocket = WebSocket & {
  __userId?: string;
  __lastActivity?: number;
  __zombieCheck?: NodeJS.Timeout;
};

// Path is the in-process listener; upstream nginx / AKS ingress both
// strip the `/aurora/` prefix before forwarding (matches REST controller
// paths, which also live at /users, /crews, etc. without prefix).
@WebSocketGateway({
  path: '/entity-events/subscribe',
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

  afterInit() {
    const url = requiredEnv('REDIS_URL');
    this.redisSubscriber = new Redis(url, { maxRetriesPerRequest: null });

    void this.redisSubscriber.psubscribe(
      ENTITY_EVENTS_CHANNEL_PATTERN,
      (err) => {
        if (err) {
          this.logger.error(
            `Failed to psubscribe(${ENTITY_EVENTS_CHANNEL_PATTERN}): ${describeUnknown(err)}`,
          );
          return;
        }
        this.logger.log(
          `EntityEventsGateway subscribed to ${ENTITY_EVENTS_CHANNEL_PATTERN}`,
        );
      },
    );

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
      // Query satoken takes precedence over cookie. Cross-origin WS
      // upgrades (page on fizzdragon.com → wss to fizzstudio subdomain)
      // may auto-attach a stale host-only satoken cookie left over
      // from the iframe-era flow; the frontend always ships the fresh
      // satoken in the query, so we trust query first and rewrite the
      // cookie string before handing it to AuthService.
      let cookie = request.headers.cookie ?? '';
      const reqUrl = request.url
        ? new URL(request.url, 'http://localhost')
        : null;
      const querySatoken = reqUrl?.searchParams.get('satoken') ?? null;
      const cookieSatoken =
        cookie.match(/(?:^|;\s*)satoken=([^;]+)/)?.[1] ?? null;
      const chosenToken = querySatoken ?? cookieSatoken;
      const tokenSource = querySatoken
        ? 'query'
        : cookieSatoken
          ? 'cookie'
          : 'none';
      if (chosenToken) {
        const cleaned = cookie
          .split(/;\s*/)
          .filter((kv) => !/^satoken=/.test(kv))
          .join('; ');
        cookie = cleaned
          ? `${cleaned}; satoken=${chosenToken}`
          : `satoken=${chosenToken}`;
      }
      const tokenHint = chosenToken?.slice(0, 8) ?? '(none)';
      this.logger.log(`ws handshake token=${tokenHint} src=${tokenSource}`);
      const user = await this.authenticateFromCookie(cookie);
      if (!user) {
        this.logger.warn(`ws unauthorized token=${tokenHint}`);
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
    } catch {
      this.logger.debug('redis subscriber quit skipped during shutdown');
    }
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
    } catch {
      this.logger.debug('terminate frame skipped because socket is closing');
    }
    try {
      client.close(code, reason);
    } catch {
      this.logger.debug(
        'socket close skipped because socket is already closed',
      );
    }
  }

  private sendHeartbeats() {
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
        } catch {
          this.logger.debug('heartbeat skipped because socket is closing');
        }
      }
    }
  }
}
