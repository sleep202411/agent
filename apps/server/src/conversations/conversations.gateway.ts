/**
 * ConversationsGateway — WS push channel for incoming messages,
 * read-cursor advances, and conversation context flips.
 *
 * One connection per browser tab. The connection authenticates via
 * satoken (cookie or `?satoken=` query, matching NotificationGateway
 * and EntityEventsGateway). On `conversation:user:{userId}` Redis
 * pub/sub messages, every connected tab for that user receives a
 * `ConversationFrame` data frame.
 *
 * Lifecycle mirrors NotificationGateway:
 *   - 30s server heartbeat
 *   - 90s zombie watchdog
 *   - 1008 close on auth failure (with `terminate` data frame so the
 *     client can distinguish from a network drop)
 *
 * Recovery model:
 *   - DB is authoritative; the WS is a latency optimization.
 *   - Clients on reconnect re-page the tail of the thread with
 *     `GET /conversations/:id/messages` (`cursor` + `limit`, newest
 *     first — there is no `since` parameter, see
 *     ListMessagesQuerySchema) and call `GET /conversations` to
 *     rebuild inbox state.
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
  CONVERSATION_CHANNEL_PATTERN,
  CONVERSATION_CHANNEL_PREFIX,
  type ConversationFrame,
} from '@repo/shared/conversation';
import { AuthService } from '../auth/auth.service';

const HEARTBEAT_INTERVAL_MS = 30_000;
const ZOMBIE_TIMEOUT_MS = 90_000;
const REDIS_SUBSCRIPTION_WAIT_MS = 10_000;
const REDIS_SUBSCRIPTION_RETRY_MS = 1_000;
const CLOSE_POLICY = 1008;
const CLOSE_NORMAL = 1000;
const CLOSE_TRY_AGAIN_LATER = 1013;

type TrackedSocket = WebSocket & {
  __userId?: string;
  __lastActivity?: number;
  __zombieCheck?: NodeJS.Timeout;
  __readySent?: boolean;
};

// nginx / ingress strip `/aurora/` before forwarding (same convention
// as EntityEventsGateway / NotificationGateway). Path lives under `/ws/`
// to avoid collision with `@Controller('conversations')` `@Get(':id')`
// — Express would otherwise match `:id="subscribe"` and the global
// AuthGuard would 401 the upgrade before WsAdapter sees it.
@WebSocketGateway({ path: '/ws/conversations' })
export class ConversationsGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger(ConversationsGateway.name);

  @WebSocketServer()
  private server!: Server;

  private redisSubscriber!: Redis;
  private redisSubscriptionReady = false;
  private redisSubscribeInFlight: Promise<void> | null = null;
  private redisSubscribeRetryTimer?: NodeJS.Timeout;
  private readonly redisReadyWaiters = new Set<() => void>();
  private readonly socketsByUser = new Map<string, Set<TrackedSocket>>();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(private readonly authService: AuthService) {}

  afterInit() {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.redisSubscriber = new Redis(url, { maxRetriesPerRequest: null });

    // A browser `ready` frame is a recovery boundary only if the
    // server-side Redis fan-out is also subscribed. ioredis emits
    // `ready` on every reconnect; explicitly (re)subscribe there and
    // notify already-open browsers once the subscription ACK arrives.
    // Merely constructing the subscriber and firing psubscribe in the
    // background left a startup gap, while a Redis-only outage left no
    // signal that clients needed to REST-recover missed messages.
    this.redisSubscriber.on('ready', () => {
      void this.ensureRedisSubscription();
    });
    const markRedisUnavailable = () => {
      this.redisSubscriptionReady = false;
    };
    this.redisSubscriber.on('close', markRedisUnavailable);
    this.redisSubscriber.on('end', markRedisUnavailable);
    this.redisSubscriber.on('reconnecting', markRedisUnavailable);
    this.redisSubscriber.on('error', (err) => {
      this.logger.warn(`redis subscriber error: ${err.message}`);
    });

    this.redisSubscriber.on('pmessage', (_pattern, channel, raw) => {
      const userId = channel.slice(CONVERSATION_CHANNEL_PREFIX.length);
      const subs = this.socketsByUser.get(userId);
      if (!subs || subs.size === 0) return;
      let parsed: ConversationFrame;
      try {
        parsed = JSON.parse(raw) as ConversationFrame;
      } catch {
        this.logger.warn(`malformed payload on ${channel}`);
        return;
      }
      const frame = JSON.stringify(parsed);
      for (const sock of subs) {
        if (sock.readyState === sock.OPEN) sock.send(frame);
      }
    });

    this.heartbeatTimer = setInterval(
      () => this.sendHeartbeats(),
      HEARTBEAT_INTERVAL_MS,
    );
  }

  async handleConnection(client: TrackedSocket, request: IncomingMessage) {
    try {
      // Same query-first / cookie-fallback token extraction as
      // entity-events + notification gateways.
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

      // Do not advertise a recovery boundary until Redis has confirmed
      // the pattern subscription. If Redis remains unavailable, close
      // with 1013 so the browser's normal non-fatal reconnect loop
      // retries instead of sitting on a socket that cannot receive.
      if (!(await this.waitForRedisSubscription())) {
        this.close(client, CLOSE_TRY_AGAIN_LATER, 'realtime_unavailable');
        return;
      }
      if (client.readyState !== client.OPEN) return;

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

      // `open` on the browser only means the TCP/WebSocket handshake
      // finished; auth and registration above were still in flight.
      // This explicit boundary lets the client refetch DB state only
      // after no future pub/sub frame can slip through that startup gap.
      client.send(
        JSON.stringify({
          event: 'ready',
          data: { serverTime: Date.now() },
        }),
      );
      client.__readySent = true;
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
    if (this.redisSubscribeRetryTimer) {
      clearTimeout(this.redisSubscribeRetryTimer);
    }
    this.redisReadyWaiters.clear();
    try {
      await this.redisSubscriber?.quit();
    } catch (err) {
      // Best-effort shutdown — quit() can throw if the connection
      // was already torn down. Log and move on; we're exiting.
      this.logger.debug(
        `redis quit during shutdown: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private addSubscriber(userId: string, sock: TrackedSocket) {
    let set = this.socketsByUser.get(userId);
    if (!set) {
      set = new Set();
      this.socketsByUser.set(userId, set);
    }
    set.add(sock);
  }

  private ensureRedisSubscription(): Promise<void> {
    if (this.redisSubscribeInFlight) return this.redisSubscribeInFlight;

    this.redisSubscribeInFlight = (async () => {
      try {
        await this.redisSubscriber.psubscribe(CONVERSATION_CHANNEL_PATTERN);
        const recovered = !this.redisSubscriptionReady;
        this.redisSubscriptionReady = true;
        this.logger.log(`subscribed to ${CONVERSATION_CHANNEL_PATTERN}`);

        for (const resolve of this.redisReadyWaiters) resolve();
        this.redisReadyWaiters.clear();

        // Only sockets that already crossed an earlier ready boundary
        // need a second one. Initial handshakes are waiting above and
        // will send their own ready after this method resolves.
        if (recovered) this.sendReadyToConnectedSockets();
      } catch (err) {
        this.redisSubscriptionReady = false;
        this.logger.error(
          `psubscribe failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.scheduleRedisSubscribeRetry();
      } finally {
        this.redisSubscribeInFlight = null;
      }
    })();
    return this.redisSubscribeInFlight;
  }

  private scheduleRedisSubscribeRetry(): void {
    if (this.redisSubscribeRetryTimer) return;
    this.redisSubscribeRetryTimer = setTimeout(() => {
      this.redisSubscribeRetryTimer = undefined;
      if (this.redisSubscriber.status === 'ready') {
        void this.ensureRedisSubscription();
      }
    }, REDIS_SUBSCRIPTION_RETRY_MS);
  }

  private async waitForRedisSubscription(): Promise<boolean> {
    const deadline = Date.now() + REDIS_SUBSCRIPTION_WAIT_MS;
    while (!this.redisSubscriptionReady) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      const becameReady = await new Promise<boolean>((resolve) => {
        const onReady = () => {
          clearTimeout(timer);
          this.redisReadyWaiters.delete(onReady);
          resolve(true);
        };
        const timer = setTimeout(() => {
          this.redisReadyWaiters.delete(onReady);
          resolve(false);
        }, remaining);
        this.redisReadyWaiters.add(onReady);
      });
      if (!becameReady) return false;
      // Redis may have closed in the microtask between resolving the
      // waiter and resuming this coroutine. Loop and verify the flag.
    }
    return true;
  }

  private sendReadyToConnectedSockets(): void {
    const frame = JSON.stringify({
      event: 'ready',
      data: { serverTime: Date.now() },
    });
    for (const subs of this.socketsByUser.values()) {
      for (const sock of subs) {
        if (!sock.__readySent || sock.readyState !== sock.OPEN) continue;
        try {
          sock.send(frame);
        } catch {
          /* dead socket; close handler will fire */
        }
      }
    }
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
    // Best-effort send + close — both can throw on a half-closed
    // socket. We don't care to retry; just suppress.
    try {
      client.send(
        JSON.stringify({ event: 'terminate', data: { reason, code } }),
      );
    } catch {
      /* socket already gone */
    }
    try {
      client.close(code, reason);
    } catch {
      /* socket already gone */
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
          /* dead socket; close handler will fire */
        }
      }
    }
  }
}
