/**
 * ChatEventsGateway — WS broker for per-conversation chat events.
 *
 * Complements WorkflowEventsGateway (which handles workflow-run progress):
 *   • workflow-events → runId-scoped,  workflow step/HITL/progress
 *   • chat-events     → projectId-scoped, new messages / agent state
 *
 * Client lifecycle:
 *   1. Connect ws://.../aurora/chat-events?projectId=<id>
 *   2. Server authenticates cookie, binds socket
 *   3. Server sends initial snapshot:
 *        { event: "message_list", data: { messageIds } }
 *        { event: "agent_state",  data: { state } }
 *        { event: "heartbeat",    data: { conversationHash, serverTime } }
 *   4. Server pushes live events:
 *        { event: "message_added"   | "message_updated" | "agent_state", data }
 *   5. Heartbeat every 30s + protocol-level ping (zombie fix from
 *      WorkflowEventsGateway — see that file for rationale)
 *
 * Wire: client never sends anything after connect — this is a push-only
 * channel. Content is fetched via POST /aurora/assistant/get-messages.
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
import { AuthService } from '../../auth/auth.service';
import { MessageStoreService } from './message-store.service';

const REDIS_CHANNEL_PATTERN = 'chat:events:*';
const REDIS_CHANNEL_PREFIX = 'chat:events:';

const HEARTBEAT_INTERVAL_MS = 30_000;
const ZOMBIE_TIMEOUT_MS = 90_000;

const CLOSE_POLICY = 1008;
const CLOSE_NORMAL = 1000;

type TrackedSocket = WebSocket & {
  __projectId?: string;
  __userId?: string;
  __lastActivity?: number;
  __zombieCheck?: NodeJS.Timeout;
};

type StoreEvent =
  | {
      type: 'message_added';
      data: { messageId: string; message?: Record<string, unknown> };
    }
  | {
      type: 'message_updated';
      data: { messageId: string; message?: Record<string, unknown> };
    }
  | {
      type: 'message_chunk';
      data: { messageId: string; partIndex: number; appendText: string };
    }
  | { type: 'message_finalize'; data: { messageId: string } }
  | { type: 'agent_state'; data: { state: string } };

/**
 * Inspired by oii's `subscribe_conversation` semantic but with our hyphen
 * convention (see /aurora/submit-message-to-agent etc). Accepts either
 * `conversationId` (preferred) or `projectId` (legacy-compat) as the key —
 * we only have 1 conversation per project today so they're interchangeable.
 */
@WebSocketGateway({
  path: '/aurora/chat/subscribe-conversation',
})
export class ChatEventsGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger(ChatEventsGateway.name);

  @WebSocketServer()
  private server!: Server;

  private redisSubscriber!: Redis;

  /** projectId → set of sockets watching. */
  private readonly socketsByProject = new Map<string, Set<TrackedSocket>>();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(
    private readonly authService: AuthService,
    private readonly store: MessageStoreService,
  ) {}

  afterInit(_server: Server) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.redisSubscriber = new Redis(url, { maxRetriesPerRequest: null });

    this.redisSubscriber.psubscribe(REDIS_CHANNEL_PATTERN, (err) => {
      if (err) {
        this.logger.error(
          `Failed to psubscribe(${REDIS_CHANNEL_PATTERN}): ${err.message}`,
        );
        return;
      }
      this.logger.log(
        `ChatEventsGateway subscribed to ${REDIS_CHANNEL_PATTERN}`,
      );
    });

    this.redisSubscriber.on('pmessage', (_pattern, channel, raw) => {
      const projectId = channel.slice(REDIS_CHANNEL_PREFIX.length);
      const subs = this.socketsByProject.get(projectId);
      if (!subs || subs.size === 0) return;
      let parsed: StoreEvent;
      try {
        parsed = JSON.parse(raw) as StoreEvent;
      } catch {
        this.logger.warn(`Malformed pub/sub payload on ${channel}`);
        return;
      }
      const frame = JSON.stringify({ event: parsed.type, data: parsed.data });
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
      const url = new URL(request.url ?? '/', 'http://localhost');
      // Accept conversationId (oii-aligned) or projectId (legacy) — they
      // map to the same key in our Redis layout.
      const projectId =
        url.searchParams.get('conversationId') ??
        url.searchParams.get('projectId');
      if (!projectId) {
        this.close(client, CLOSE_POLICY, 'missing_conversationId');
        return;
      }
      // Query satoken takes precedence over cookie — see
      // entity-events.gateway.ts for the full rationale (stale
      // host-only satoken from the iframe-era flow can shadow the
      // fresh token the frontend ships in the query).
      let cookie = request.headers.cookie ?? '';
      const querySatoken = url.searchParams.get('satoken');
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
      this.logger.log(
        `ws handshake projectId=${projectId} token=${tokenHint} src=${tokenSource}`,
      );
      const user = await this.authenticateFromCookie(cookie);
      if (!user) {
        this.logger.warn(
          `ws unauthorized projectId=${projectId} token=${tokenHint}`,
        );
        this.close(client, CLOSE_POLICY, 'unauthorized');
        return;
      }

      client.__projectId = projectId;
      client.__userId = user.userId;
      client.__lastActivity = Date.now();
      this.addSubscriber(projectId, client);

      // Zombie watchdog — mirrors WorkflowEventsGateway.
      client.__zombieCheck = setInterval(() => {
        const last = client.__lastActivity ?? 0;
        if (Date.now() - last > ZOMBIE_TIMEOUT_MS) {
          this.close(client, CLOSE_NORMAL, 'zombie_timeout');
        }
      }, HEARTBEAT_INTERVAL_MS);

      client.on('pong', () => (client.__lastActivity = Date.now()));
      client.on('message', () => (client.__lastActivity = Date.now()));

      // Snapshot + first heartbeat so the client has a baseline immediately.
      const [messageIds, agentState, conversationHash] = await Promise.all([
        this.store.getMessageIds(projectId),
        this.store.getAgentState(projectId),
        this.store.getConversationHash(projectId),
      ]);

      client.send(
        JSON.stringify({ event: 'message_list', data: { messageIds } }),
      );
      client.send(
        JSON.stringify({ event: 'agent_state', data: { state: agentState } }),
      );
      client.send(
        JSON.stringify({
          event: 'heartbeat',
          data: { conversationHash, serverTime: Date.now() },
        }),
      );

      this.logger.log(
        `ws connected projectId=${projectId} userId=${user.userId} messages=${messageIds.length}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`handleConnection failed: ${msg}`);
      this.close(client, CLOSE_POLICY, 'handshake_error');
    }
  }

  handleDisconnect(client: TrackedSocket) {
    if (client.__zombieCheck) clearInterval(client.__zombieCheck);
    const projectId = client.__projectId;
    if (!projectId) return;
    const subs = this.socketsByProject.get(projectId);
    if (subs) {
      subs.delete(client);
      if (subs.size === 0) this.socketsByProject.delete(projectId);
    }
    this.logger.log(`ws disconnected projectId=${projectId}`);
  }

  async onModuleDestroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    try {
      await this.redisSubscriber?.quit();
    } catch {}
  }

  // ─── Helpers ─────────────────────────────────────────────

  private addSubscriber(projectId: string, sock: TrackedSocket) {
    let set = this.socketsByProject.get(projectId);
    if (!set) {
      set = new Set();
      this.socketsByProject.set(projectId, set);
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
    const projectIds = [...this.socketsByProject.keys()];
    if (projectIds.length === 0) return;
    const serverTime = Date.now();
    const hashes = await Promise.all(
      projectIds.map((id) => this.store.getConversationHash(id)),
    );
    for (let i = 0; i < projectIds.length; i++) {
      const projectId = projectIds[i];
      const conversationHash = hashes[i];
      const subs = this.socketsByProject.get(projectId);
      if (!subs) continue;
      const frame = JSON.stringify({
        event: 'heartbeat',
        data: { conversationHash, serverTime },
      });
      for (const sock of subs) {
        if (sock.readyState !== sock.OPEN) continue;
        sock.send(frame);
        // Protocol-level ping — see WorkflowEventsGateway.sendHeartbeats
        // for why this is mandatory (browser auto-pongs, resets
        // lastActivity, prevents zombie_timeout false positives).
        try {
          sock.ping();
        } catch {
          /* socket dying, zombie watchdog will catch it */
        }
      }
    }
  }
}
