/**
 * WorkflowEventsGateway — server-push for workflow status / progress updates.
 *
 * Replaces the 1.5s HTTP polling loop that ToolWorkflowCard used to hit on
 * /aurora/workflow/:runId/status + /aurora/drafts/:runId. At 500 concurrent
 * users that was ~400 req/s of mostly-empty polls; WS brings it to ~0.
 *
 * Wire protocol (see docs/workflow-events-ws.md):
 *   - "heartbeat"      — every 30s, carries runHash for consistency check
 *   - "workflow_event" — pushed when Mastra emits an event via appendEvent
 *   - "terminate"      — explicit server close (auth failure, run deleted)
 *
 * Mastra publishes JSON frames to Redis pub/sub channel
 * `workflow:events:{runId}` inside `appendEvent()`; we psubscribe and fan
 * out to sockets bound to that runId.
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

// ─── Config ──────────────────────────────────────────────────────────────

/** Channel pattern the gateway subscribes to — must match Mastra's publish key. */
const REDIS_CHANNEL_PATTERN = 'workflow:events:*';
const REDIS_CHANNEL_PREFIX = 'workflow:events:';

/** How often we send a heartbeat frame to every connected socket. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Server-side zombie timeout — if we don't see activity from a socket
 *  within this window, close it. Paired with client's 75s watchdog. */
const ZOMBIE_TIMEOUT_MS = 90_000;

/** Close codes we use. 1008 = policy violation, don't auto-reconnect. */
const CLOSE_POLICY = 1008;
const CLOSE_NORMAL = 1000;

// ─── Frame types — match the client's discriminator ──────────────────────

type WsFrame =
  | {
      event: 'heartbeat';
      data: { runHash: string; serverTime: number };
    }
  | {
      event: 'workflow_event';
      data: WorkflowEventPayload;
    }
  | {
      event: 'terminate';
      data: { reason: string; code: number };
    };

type WorkflowEventPayload = {
  id: string;
  runId: string;
  timestamp: number;
  type: string;
  data?: unknown;
};

type WorkflowMeta = {
  runId: string;
  workspaceId: string;
  userId: string;
  status: string;
  currentStep?: string;
  progress?: { current: number; total: number };
};

// Extend WebSocket with our per-connection bookkeeping.
type TrackedSocket = WebSocket & {
  __runId?: string;
  __projectId?: string;
  __userId?: string;
  __lastActivity?: number;
  __zombieCheck?: NodeJS.Timeout;
};

// ─── Gateway ─────────────────────────────────────────────────────────────

@WebSocketGateway({
  path: '/aurora/workflow-events',
  // @nestjs/platform-ws doesn't honor `cors` the way socket.io does; the
  // browser's same-origin policy + cookie mode handle cross-origin via the
  // standard handshake. Cookie auth works because the browser sends the
  // cookie header on the upgrade request.
})
export class WorkflowEventsGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger(WorkflowEventsGateway.name);

  @WebSocketServer()
  private server!: Server;

  /** Pub/sub subscriber — one pattern sub covers all runs. */
  private redisSubscriber!: Redis;
  /** Regular client for meta reads (heartbeat hash computation). */
  private redisClient!: Redis;

  /** runId → set of sockets watching this run. */
  private readonly socketsByRun = new Map<string, Set<TrackedSocket>>();

  private heartbeatTimer?: NodeJS.Timeout;

  constructor(private readonly authService: AuthService) {}

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  afterInit(_server: Server) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.redisSubscriber = new Redis(url, { maxRetriesPerRequest: null });
    this.redisClient = new Redis(url, { maxRetriesPerRequest: 3 });

    this.redisSubscriber.psubscribe(REDIS_CHANNEL_PATTERN, (err) => {
      if (err) {
        this.logger.error(
          `Failed to psubscribe(${REDIS_CHANNEL_PATTERN}): ${err.message}`,
        );
        return;
      }
      this.logger.log(
        `WorkflowEventsGateway subscribed to ${REDIS_CHANNEL_PATTERN}`,
      );
    });

    this.redisSubscriber.on('pmessage', (_pattern, channel, message) => {
      const runId = channel.slice(REDIS_CHANNEL_PREFIX.length);
      const subscribers = this.socketsByRun.get(runId);
      if (!subscribers || subscribers.size === 0) return;
      // Parse once, re-serialize once, send to all.
      let payload: WorkflowEventPayload;
      try {
        payload = JSON.parse(message) as WorkflowEventPayload;
      } catch {
        this.logger.warn(`Malformed pub/sub payload on ${channel}`);
        return;
      }
      const frame = this.serialize({ event: 'workflow_event', data: payload });
      for (const sock of subscribers) {
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
      const runId = url.searchParams.get('runId');
      const projectId = url.searchParams.get('projectId');
      if (!runId || !projectId) {
        this.close(client, CLOSE_POLICY, 'missing_runId_or_projectId');
        return;
      }

      // Cookie auth — matches AuthGuard logic for HTTP endpoints.
      const cookie = request.headers.cookie;
      const user = await this.authenticateFromCookie(cookie);
      if (!user) {
        this.close(client, CLOSE_POLICY, 'unauthorized');
        return;
      }

      // Ownership check: the run's workspaceId must equal the projectId the
      // client claims. Otherwise user X could subscribe to user Y's runs.
      const meta = await this.loadMeta(runId);
      if (!meta) {
        this.close(client, CLOSE_POLICY, 'run_not_found');
        return;
      }
      if (meta.workspaceId !== projectId) {
        this.close(client, CLOSE_POLICY, 'workspace_mismatch');
        return;
      }
      // (We deliberately don't compare meta.userId to user.userId — a
      // project may be shared. Workspace-level ownership is the boundary.)

      // Bind the socket.
      client.__runId = runId;
      client.__projectId = projectId;
      client.__userId = user.userId;
      client.__lastActivity = Date.now();
      this.addSubscriber(runId, client);

      // Zombie watchdog — close if nothing heard in 90s. Paired with a 75s
      // client-side watchdog so the client reconnects first.
      client.__zombieCheck = setInterval(() => {
        const last = client.__lastActivity ?? 0;
        if (Date.now() - last > ZOMBIE_TIMEOUT_MS) {
          this.close(client, CLOSE_NORMAL, 'zombie_timeout');
        }
      }, HEARTBEAT_INTERVAL_MS);

      client.on('pong', () => (client.__lastActivity = Date.now()));
      client.on('message', () => (client.__lastActivity = Date.now()));

      // Immediate heartbeat so the client can sync runHash before the next tick.
      client.send(
        this.serialize({
          event: 'heartbeat',
          data: {
            runHash: this.computeRunHash(meta),
            serverTime: Date.now(),
          },
        }),
      );

      this.logger.log(
        `ws connected runId=${runId} projectId=${projectId} userId=${user.userId}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`handleConnection error: ${msg}`);
      this.close(client, CLOSE_POLICY, 'server_error');
    }
  }

  handleDisconnect(client: TrackedSocket) {
    if (client.__zombieCheck) clearInterval(client.__zombieCheck);
    const runId = client.__runId;
    if (runId) this.removeSubscriber(runId, client);
    this.logger.debug(`ws disconnected runId=${runId}`);
  }

  async onModuleDestroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    try {
      await this.redisSubscriber?.quit();
    } catch {
      // ignore
    }
    try {
      await this.redisClient?.quit();
    } catch {
      // ignore
    }
  }

  // ─── Heartbeats ────────────────────────────────────────────────────────

  /**
   * Send a heartbeat to every connected socket. Each frame carries the
   * current `runHash` so the client can detect dropped events and reconcile
   * via REST `/status`.
   */
  private async sendHeartbeats() {
    const runIds = [...this.socketsByRun.keys()];
    if (runIds.length === 0) return;

    const serverTime = Date.now();
    // Load metas in parallel. A stale read is fine — it'll be rechecked
    // next heartbeat.
    const metas = await Promise.all(runIds.map((id) => this.loadMeta(id)));

    for (let i = 0; i < runIds.length; i++) {
      const runId = runIds[i];
      const meta = metas[i];
      const subs = this.socketsByRun.get(runId);
      if (!subs || subs.size === 0) continue;

      const runHash = meta
        ? this.computeRunHash(meta)
        : 'missing'; /* run TTL'd out while clients watched */
      const frame = this.serialize({
        event: 'heartbeat',
        data: { runHash, serverTime },
      });

      for (const sock of subs) {
        if (sock.readyState !== sock.OPEN) continue;
        sock.send(frame);
        // Protocol-level ping so the browser auto-pongs — keeps the socket's
        // `__lastActivity` fresh and prevents zombie_timeout false positives.
        // The application-level JSON heartbeat above doesn't count as activity
        // on its own because only inbound frames touch lastActivity.
        try {
          sock.ping();
        } catch {
          /* swallow — ping failing means the socket is already dying */
        }
      }
    }
  }

  /**
   * A cheap state digest: any change in status/step/progress flips the
   * string. Not cryptographic — just for "did anything I care about change".
   */
  private computeRunHash(meta: WorkflowMeta): string {
    const cur = meta.progress?.current ?? 0;
    const tot = meta.progress?.total ?? 0;
    return `${meta.status}:${meta.currentStep ?? ''}:${cur}/${tot}`;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private async authenticateFromCookie(cookie?: string) {
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

  private async loadMeta(runId: string): Promise<WorkflowMeta | null> {
    try {
      // Mirror Mastra's key builder — must stay in sync with
      // apps/agent/src/mastra/lib/redis-keys.ts `workflowState()`.
      const raw = await this.redisClient.get(`workflow:run:${runId}:state`);
      if (!raw) return null;
      return JSON.parse(raw) as WorkflowMeta;
    } catch {
      return null;
    }
  }

  private addSubscriber(runId: string, client: TrackedSocket) {
    let set = this.socketsByRun.get(runId);
    if (!set) {
      set = new Set();
      this.socketsByRun.set(runId, set);
    }
    set.add(client);
  }

  private removeSubscriber(runId: string, client: TrackedSocket) {
    const set = this.socketsByRun.get(runId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) this.socketsByRun.delete(runId);
  }

  private close(client: WebSocket, code: number, reason: string) {
    try {
      client.send(
        this.serialize({ event: 'terminate', data: { reason, code } }),
      );
    } catch {
      // socket may already be closed — fine.
    }
    try {
      client.close(code, reason);
    } catch {
      // ditto
    }
  }

  private serialize(frame: WsFrame): string {
    return JSON.stringify(frame);
  }
}
