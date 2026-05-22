/**
 * NotificationGateway — WS push channel for the bell badge + toast.
 *
 * One connection per browser tab. The connection authenticates via
 * satoken (cookie or `?satoken=` query, matching the entity-events
 * convention) and subscribes to the user's pub/sub channel. When
 * NotificationService.send() publishes, every connected tab for that
 * user receives a `{ event: "notification", data: NotificationDTO }`
 * frame.
 *
 * Lifecycle is mirrored after EntityEventsGateway:
 *   - heartbeat every 30s (server → client)
 *   - zombie watchdog: close if no activity for 90s
 *   - 1008 close on auth failure (with a `terminate` data frame so the
 *     client can distinguish from a network-level drop)
 *
 * The DB row is authoritative — clients on reconnect should:
 *   1. Refetch unread-count
 *   2. Optionally refetch list page 1 (cheap)
 * so a missed push during the offline window is transparently recovered.
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
  NOTIFICATION_CHANNEL_PATTERN,
  NOTIFICATION_CHANNEL_PREFIX,
  type NotificationDTO,
} from '@repo/shared';
import { AuthService } from '../auth/auth.service';

const HEARTBEAT_INTERVAL_MS = 30_000;
const ZOMBIE_TIMEOUT_MS = 90_000;
const CLOSE_POLICY = 1008;
const CLOSE_NORMAL = 1000;

type TrackedSocket = WebSocket & {
  __userId?: string;
  __lastActivity?: number;
  __zombieCheck?: NodeJS.Timeout;
};

// See EntityEventsGateway: upstreams strip `/aurora/` before forwarding.
// Path under `/ws/` to keep the WS upgrade clear of `@Controller('notifications')`
// HTTP routes — see ConversationsGateway header for the routing collision.
@WebSocketGateway({ path: '/ws/notifications' })
export class NotificationGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger(NotificationGateway.name);

  @WebSocketServer()
  private server!: Server;

  private redisSubscriber!: Redis;
  private readonly socketsByUser = new Map<string, Set<TrackedSocket>>();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(private readonly authService: AuthService) {}

  afterInit(_server: Server) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.redisSubscriber = new Redis(url, { maxRetriesPerRequest: null });

    this.redisSubscriber.psubscribe(NOTIFICATION_CHANNEL_PATTERN, (err) => {
      if (err) {
        this.logger.error(`psubscribe failed: ${err.message}`);
        return;
      }
      this.logger.log(`subscribed to ${NOTIFICATION_CHANNEL_PATTERN}`);
    });

    this.redisSubscriber.on('pmessage', (_pattern, channel, raw) => {
      const userId = channel.slice(NOTIFICATION_CHANNEL_PREFIX.length);
      const subs = this.socketsByUser.get(userId);
      if (!subs || subs.size === 0) return;
      let parsed: NotificationDTO;
      try {
        parsed = JSON.parse(raw) as NotificationDTO;
      } catch {
        this.logger.warn(`malformed payload on ${channel}`);
        return;
      }
      const frame = JSON.stringify({ event: 'notification', data: parsed });
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
      // Same query-first / cookie-fallback token extraction as entity-events.
      let cookie = request.headers.cookie ?? '';
      const reqUrl = request.url
        ? new URL(request.url, 'http://localhost')
        : null;
      const querySatoken = reqUrl?.searchParams.get('satoken') ?? null;
      const cookieSatoken =
        cookie.match(/(?:^|;\s*)satoken=([^;]+)/)?.[1] ?? null;
      const chosenToken = querySatoken ?? cookieSatoken;
      if (chosenToken) {
        const cleaned = cookie
          .split(/;\s*/)
          .filter((kv) => !/^satoken=/.test(kv))
          .join('; ');
        cookie = cleaned
          ? `${cleaned}; satoken=${chosenToken}`
          : `satoken=${chosenToken}`;
      }

      const user = await this.authenticateFromCookie(cookie);
      if (!user) {
        this.close(client, CLOSE_POLICY, 'unauthorized');
        return;
      }

      client.__userId = user.userId;
      client.__lastActivity = Date.now();
      this.addSubscriber(user.userId, client);

      client.__zombieCheck = setInterval(() => {
        const last = client.__lastActivity ?? 0;
        if (Date.now() - last > ZOMBIE_TIMEOUT_MS) {
          this.close(client, CLOSE_NORMAL, 'zombie_timeout');
        }
      }, HEARTBEAT_INTERVAL_MS);

      client.on('pong', () => (client.__lastActivity = Date.now()));
      client.on('message', () => (client.__lastActivity = Date.now()));

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
