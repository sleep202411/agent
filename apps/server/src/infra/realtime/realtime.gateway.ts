/**
 * RealtimeGateway — the self-hosted WS plane for asset/entity pushes
 * (`/ws/realtime`), the region-portable counterpart to Azure Web PubSub.
 *
 * Connect:
 *   ws(s)://<host>/aurora/ws/realtime?token=<signed>
 *
 * The token (minted by the negotiate endpoint via SelfHostedRealtimeService)
 * carries the authorized fan-out groups; the gateway trusts them after verifying
 * the HMAC signature — no per-connection DB round trip, mirroring Azure's JWT.
 * Messages arrive over Redis (`realtime:group:*`, published by the provider on
 * ANY pod) and are relayed verbatim to every socket in the group, so the same
 * payloads a Web PubSub client would receive reach a native-WS client.
 *
 * Dormant unless REALTIME_TRANSPORT=self-hosted (no Redis connections opened on
 * web-pubsub deployments).
 */
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { IncomingMessage } from 'http';
import type { RawData, WebSocket } from 'ws';
import {
  REALTIME_GROUP_CHANNEL_PATTERN,
  groupFromChannel,
} from './realtime-groups';
import {
  verifyRealtimeToken,
  type RealtimeTokenPayload,
} from './realtime-transport-token';

const HEARTBEAT_INTERVAL_MS = 30_000;
const ZOMBIE_TIMEOUT_MS = 90_000;
const CLOSE_POLICY = 1008;
const CLOSE_NORMAL = 1000;

type TrackedSocket = WebSocket & {
  __userId?: string;
  __groups?: string[];
  __expiresAt?: number;
  __lastActivity?: number;
  __zombieCheck?: NodeJS.Timeout;
};

@WebSocketGateway({ path: '/ws/realtime' })
export class RealtimeGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);

  private redisSubscriber?: Redis;
  private heartbeatTimer?: NodeJS.Timeout;
  private active = false;
  private secret: string | null = null;

  /** group → sockets currently joined to it (on this pod). */
  private readonly socketsByGroup = new Map<string, Set<TrackedSocket>>();

  afterInit() {
    const transport = (process.env.REALTIME_TRANSPORT ?? '')
      .trim()
      .toLowerCase();
    if (transport !== 'self-hosted') {
      this.logger.log('dormant (REALTIME_TRANSPORT is not self-hosted)');
      return;
    }
    this.secret = process.env.REALTIME_WS_SECRET?.trim() || null;
    if (!this.secret) {
      // Fail loud: a self-hosted deployment without a secret cannot authenticate.
      throw new Error(
        'REALTIME_TRANSPORT=self-hosted requires REALTIME_WS_SECRET',
      );
    }
    this.active = true;

    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.redisSubscriber = new Redis(url, { maxRetriesPerRequest: null });
    void this.redisSubscriber.psubscribe(
      REALTIME_GROUP_CHANNEL_PATTERN,
      (err) => {
        if (err) {
          this.logger.error(`psubscribe failed: ${err.message}`);
          return;
        }
        this.logger.log(`subscribed to ${REALTIME_GROUP_CHANNEL_PATTERN}`);
      },
    );
    this.redisSubscriber.on('pmessage', (_pattern, channel, raw) => {
      const group = groupFromChannel(channel);
      const subs = this.socketsByGroup.get(group);
      if (!subs || subs.size === 0) return;
      for (const sock of subs) this.sendRaw(sock, raw);
    });

    this.heartbeatTimer = setInterval(
      () => this.sendHeartbeats(),
      HEARTBEAT_INTERVAL_MS,
    );
  }

  handleConnection(client: TrackedSocket, request: IncomingMessage) {
    if (!this.active || !this.secret) {
      this.close(client, CLOSE_POLICY, 'realtime_disabled');
      return;
    }
    const url = new URL(request.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('token');
    if (!token) {
      this.close(client, CLOSE_POLICY, 'missing_token');
      return;
    }
    const payload = verifyRealtimeToken(this.secret, token, Date.now());
    if (!payload) {
      this.close(client, CLOSE_POLICY, 'unauthorized');
      return;
    }

    client.__userId = payload.userId;
    client.__groups = payload.groups;
    client.__expiresAt = payload.exp;
    client.__lastActivity = Date.now();
    for (const group of payload.groups) this.addToGroup(group, client);

    client.__zombieCheck = setInterval(() => {
      const last = client.__lastActivity ?? 0;
      if (
        Date.now() - last > ZOMBIE_TIMEOUT_MS ||
        Date.now() >= (client.__expiresAt ?? 0)
      ) {
        this.close(client, CLOSE_NORMAL, 'expired_or_idle');
      }
    }, HEARTBEAT_INTERVAL_MS);

    client.on('pong', () => (client.__lastActivity = Date.now()));
    client.on('message', (raw) => this.handleClientFrame(client, raw));
    this.sendHeartbeat(client);
  }

  handleDisconnect(client: TrackedSocket) {
    if (client.__zombieCheck) clearInterval(client.__zombieCheck);
    for (const group of client.__groups ?? []) {
      const subs = this.socketsByGroup.get(group);
      if (!subs) continue;
      subs.delete(client);
      if (subs.size === 0) this.socketsByGroup.delete(group);
    }
  }

  async onModuleDestroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    try {
      await this.redisSubscriber?.quit();
    } catch (err) {
      this.logger.debug(
        `redis quit during shutdown: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Clients are receive-only; the only inbound frame is a keepalive ping. */
  private handleClientFrame(client: TrackedSocket, raw: RawData) {
    client.__lastActivity = Date.now();
    try {
      const frame = JSON.parse(this.rawDataToString(raw)) as {
        event?: string;
      };
      if (frame.event === 'ping') this.sendHeartbeat(client);
    } catch {
      /* ignore non-JSON keepalive noise */
    }
  }

  private addToGroup(group: string, client: TrackedSocket) {
    let set = this.socketsByGroup.get(group);
    if (!set) {
      set = new Set();
      this.socketsByGroup.set(group, set);
    }
    set.add(client);
  }

  private sendRaw(client: WebSocket, message: string) {
    if (client.readyState !== client.OPEN) return;
    client.send(message);
  }

  private sendHeartbeat(client: WebSocket) {
    if (client.readyState !== client.OPEN) return;
    client.send(
      JSON.stringify({ event: 'heartbeat', data: { serverTime: Date.now() } }),
    );
  }

  private sendHeartbeats() {
    for (const subs of this.socketsByGroup.values()) {
      for (const sock of subs) {
        if (sock.readyState !== sock.OPEN) continue;
        try {
          this.sendHeartbeat(sock);
          (sock as TrackedSocket & { ping?: () => void }).ping?.();
        } catch {
          /* dead socket; close handler will fire */
        }
      }
    }
  }

  private close(client: WebSocket, code: number, reason: string) {
    try {
      client.send(
        JSON.stringify({ event: 'terminate', data: { reason, code } }),
      );
    } catch {
      /* already closed */
    }
    try {
      client.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  private rawDataToString(raw: RawData): string {
    if (typeof raw === 'string') return raw;
    if (Buffer.isBuffer(raw)) return raw.toString('utf8');
    if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
    return Buffer.from(raw).toString('utf8');
  }
}

export type { RealtimeTokenPayload };
