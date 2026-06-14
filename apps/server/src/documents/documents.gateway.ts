/**
 * DocumentsGateway — realtime collaboration channel for PlatformDocument.
 *
 * This is a product-level transport, not the raw y-websocket protocol.
 * Clients can still use Yjs locally: encode Yjs updates as base64 and
 * send them in `operation.yjsUpdateBase64`. The server owns auth,
 * sequence/idempotency, durable operation logs, presence, and fan-out.
 *
 * Connect:
 *   ws(s)://<host>/aurora/ws/documents?documentId=<uuid>&afterSequence=0
 *
 * Incoming frames:
 *   { event: "sync_request", data: { afterSequence?: number, limit?: number } }
 *   { event: "operation", data: AppendDocumentOperationInput }
 *   { event: "presence", data: UpsertDocumentPresenceInput }
 *   { event: "awareness", data: { update: base64 } }  // y-protocols awareness
 *   { event: "ping" }
 *
 * Outgoing frames:
 *   document_snapshot, operations_sync, document_operation,
 *   presence_update, presence_left, awareness, awareness_state,
 *   awareness_request, heartbeat, error, terminate.
 *
 * Awareness (ephemeral): live cursors + the active-user set behind the avatar
 * group. Clients send a y-protocols awareness update; the server relays it to
 * peers (Redis fan-out), bootstraps new clients via `awareness_state`, asks
 * peers to re-announce via `awareness_request`, and drops a socket's cursors
 * instantly on disconnect. Never persisted.
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
import type { RawData, Server, WebSocket } from 'ws';
import type { AuthUser } from '../auth';
import { AuthService } from '../auth/auth.service';
import { newShortId } from '../common/id';
import {
  AppendDocumentOperationSchema,
  ListDocumentOperationsQuerySchema,
  UpsertDocumentPresenceSchema,
} from './dto';
import { DocumentsService } from './documents.service';
import { DocumentAwarenessRegistry, REMOTE_ORIGIN } from './document-awareness';

const REDIS_CHANNEL_PATTERN = 'document:events:*';
const REDIS_CHANNEL_PREFIX = 'document:events:';
const HEARTBEAT_INTERVAL_MS = 30_000;
const ZOMBIE_TIMEOUT_MS = 90_000;
const CLOSE_POLICY = 1008;
const CLOSE_NORMAL = 1000;
const DEFAULT_PRESENCE_TTL_SECONDS = 45;

type TrackedSocket = WebSocket & {
  __socketId?: string;
  __documentId?: string;
  __user?: AuthUser;
  __lastActivity?: number;
  __zombieCheck?: NodeJS.Timeout;
  /** Awareness client-ids introduced over this socket (cleared on disconnect). */
  __controlledIds?: Set<number>;
};

type AwarenessFrameData = { update?: unknown };

type IncomingFrame =
  | { event: 'sync_request'; data?: { afterSequence?: number; limit?: number } }
  | { event: 'operation'; data?: unknown }
  | { event: 'presence'; data?: unknown }
  | { event: 'awareness'; data?: AwarenessFrameData }
  | { event: 'app_event'; data?: unknown }
  | { event: 'ping'; data?: unknown };

type RedisDocumentEvent =
  | {
      event: 'document_operation';
      originSocketId?: string;
      data: unknown;
    }
  | {
      event: 'presence_update';
      originSocketId?: string;
      data: unknown;
    }
  | {
      event: 'presence_left';
      originSocketId?: string;
      data: unknown;
    }
  | {
      // Ephemeral cursor/selection/identity relayed to peers; data carries a
      // base64 y-protocols awareness update.
      event: 'awareness';
      originSocketId?: string;
      data: { update: string };
    }
  | {
      // Asks already-connected peers to re-broadcast their awareness so a newly
      // joined client (possibly on another pod) sees existing cursors at once.
      event: 'awareness_request';
      originSocketId?: string;
      data: Record<string, never>;
    }
  | {
      // Generic ephemeral app-level signal relayed to peers (e.g. a
      // "comments changed → refetch" nudge). The server does not interpret it.
      event: 'app_event';
      originSocketId?: string;
      data: unknown;
    };

@WebSocketGateway({ path: '/ws/documents' })
export class DocumentsGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger(DocumentsGateway.name);

  @WebSocketServer()
  private server!: Server;

  private redisPublisher!: Redis;
  private redisSubscriber!: Redis;
  private heartbeatTimer?: NodeJS.Timeout;

  private readonly socketsByDocument = new Map<string, Set<TrackedSocket>>();
  private readonly awareness = new DocumentAwarenessRegistry();

  constructor(
    private readonly authService: AuthService,
    private readonly documents: DocumentsService,
  ) {}

  afterInit() {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.redisPublisher = new Redis(url, { maxRetriesPerRequest: null });
    this.redisSubscriber = new Redis(url, { maxRetriesPerRequest: null });

    void this.redisSubscriber.psubscribe(REDIS_CHANNEL_PATTERN, (err) => {
      if (err) {
        this.logger.error(`psubscribe failed: ${err.message}`);
        return;
      }
      this.logger.log(`subscribed to ${REDIS_CHANNEL_PATTERN}`);
    });

    this.redisSubscriber.on('pmessage', (_pattern, channel, raw) => {
      const documentId = channel.slice(REDIS_CHANNEL_PREFIX.length);
      const subs = this.socketsByDocument.get(documentId);
      if (!subs || subs.size === 0) return;

      let parsed: RedisDocumentEvent;
      try {
        parsed = JSON.parse(raw) as RedisDocumentEvent;
      } catch {
        this.logger.warn(`malformed payload on ${channel}`);
        return;
      }

      // Keep this pod's awareness cache current with peers on other pods so a
      // newly connecting local client can be bootstrapped with their cursors.
      if (parsed.event === 'awareness') {
        const update = this.decodeBase64(parsed.data.update);
        if (update) this.awareness.apply(documentId, update, REMOTE_ORIGIN);
      }

      this.broadcastFrame(documentId, parsed.event, parsed.data, {
        exceptSocketId: parsed.originSocketId,
      });
    });

    this.heartbeatTimer = setInterval(
      () => this.sendHeartbeats(),
      HEARTBEAT_INTERVAL_MS,
    );
  }

  async handleConnection(client: TrackedSocket, request: IncomingMessage) {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const documentId = url.searchParams.get('documentId');
      if (!documentId) {
        this.close(client, CLOSE_POLICY, 'missing_documentId');
        return;
      }

      const user = await this.authenticateRequest(url, request);
      if (!user) {
        this.close(client, CLOSE_POLICY, 'unauthorized');
        return;
      }

      const afterSequence = this.numberParam(
        url.searchParams.get('afterSequence'),
        0,
      );
      const limit = this.numberParam(url.searchParams.get('limit'), 500);
      const syncState = await this.documents.getSyncState(
        user,
        documentId,
        afterSequence,
        limit,
      );

      const socketId = newShortId();
      client.__socketId = socketId;
      client.__documentId = documentId;
      client.__user = user;
      client.__lastActivity = Date.now();
      client.__controlledIds = new Set<number>();
      this.addSubscriber(documentId, client);
      this.awareness.acquire(documentId);

      client.__zombieCheck = setInterval(() => {
        const last = client.__lastActivity ?? 0;
        if (Date.now() - last > ZOMBIE_TIMEOUT_MS) {
          this.close(client, CLOSE_NORMAL, 'zombie_timeout');
        }
      }, HEARTBEAT_INTERVAL_MS);

      client.on('pong', () => (client.__lastActivity = Date.now()));
      client.on('message', (raw) => {
        client.__lastActivity = Date.now();
        void this.handleClientFrame(client, raw);
      });

      this.send(client, 'document_snapshot', {
        socketId,
        document: syncState.document,
      });
      this.send(client, 'operations_sync', {
        // The replay floor may be lifted to the compaction horizon; when
        // resync is required the client rebuilds from the snapshot's crdtState
        // (carried in document_snapshot) before applying these operations.
        afterSequence: syncState.resync.fromSequence,
        operations: syncState.operations,
        resync: syncState.resync.required,
      });
      this.send(client, 'presence_state', {
        presences: syncState.presences,
      });
      // Bootstrap the new client with current cursors/avatars known to this pod,
      // then ask all peers (any pod) to re-announce so cross-pod state fills in.
      const awarenessSnapshot = this.awareness.encodeStates(documentId);
      if (awarenessSnapshot) {
        this.send(client, 'awareness_state', {
          update: this.encodeBase64(awarenessSnapshot),
        });
      }
      this.sendHeartbeat(client);

      const presence = await this.documents.upsertPresence(user, documentId, {
        connectionId: socketId,
        ttlSeconds: DEFAULT_PRESENCE_TTL_SECONDS,
        metadata: {},
      });
      await this.publish(documentId, {
        event: 'presence_update',
        originSocketId: socketId,
        data: presence.presence,
      });
      await this.publish(documentId, {
        event: 'awareness_request',
        originSocketId: socketId,
        data: {},
      });

      this.logger.log(
        `ws connected documentId=${documentId} userId=${user.userId}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`handleConnection failed: ${msg}`);
      this.send(client, 'error', {
        code: 'DOCUMENT_WS_HANDSHAKE_FAILED',
        message: msg,
      });
      this.close(client, CLOSE_POLICY, 'handshake_error');
    }
  }

  handleDisconnect(client: TrackedSocket) {
    if (client.__zombieCheck) clearInterval(client.__zombieCheck);
    const documentId = client.__documentId;
    const socketId = client.__socketId;
    const user = client.__user;
    if (documentId) {
      const subs = this.socketsByDocument.get(documentId);
      if (subs) {
        subs.delete(client);
        if (subs.size === 0) this.socketsByDocument.delete(documentId);
      }

      // Drop this socket's cursors immediately (don't wait for the client-side
      // awareness timeout) and fan the removal to peers, then release the room.
      const controlled = client.__controlledIds;
      if (controlled && controlled.size > 0) {
        const removal = this.awareness.removeClients(documentId, [
          ...controlled,
        ]);
        if (removal) {
          void this.publish(documentId, {
            event: 'awareness',
            data: { update: this.encodeBase64(removal) },
          });
        }
      }
      this.awareness.release(documentId);
    }

    if (documentId && socketId && user) {
      void this.documents
        .removePresence(user, documentId, socketId)
        .then((left) =>
          this.publish(documentId, {
            event: 'presence_left',
            originSocketId: socketId,
            data: left.presence,
          }),
        )
        .catch((err) =>
          this.logger.warn(
            `presence cleanup failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
    }

    if (documentId && user) {
      this.logger.log(
        `ws disconnected documentId=${documentId} userId=${user.userId}`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.awareness.destroyAll();
    try {
      await this.redisSubscriber?.quit();
      await this.redisPublisher?.quit();
    } catch (err) {
      this.logger.debug(
        `redis quit during shutdown: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async handleClientFrame(client: TrackedSocket, raw: RawData) {
    const documentId = client.__documentId;
    const socketId = client.__socketId;
    const user = client.__user;
    if (!documentId || !socketId || !user) return;

    let frame: IncomingFrame;
    try {
      frame = JSON.parse(this.rawDataToString(raw)) as IncomingFrame;
    } catch {
      this.send(client, 'error', {
        code: 'INVALID_FRAME',
        message: 'Frame must be JSON.',
      });
      return;
    }

    try {
      if (frame.event === 'ping') {
        this.sendHeartbeat(client);
        return;
      }

      if (frame.event === 'sync_request') {
        await this.handleSyncRequest(client, user, documentId, frame.data);
        return;
      }

      if (frame.event === 'presence') {
        await this.handlePresence(
          client,
          user,
          documentId,
          socketId,
          frame.data,
        );
        return;
      }

      if (frame.event === 'operation') {
        await this.handleOperation(
          client,
          user,
          documentId,
          socketId,
          frame.data,
        );
        return;
      }

      if (frame.event === 'awareness') {
        await this.handleAwareness(client, documentId, socketId, frame.data);
        return;
      }

      if (frame.event === 'app_event') {
        // Opaque ephemeral signal — relay to peers (echo-suppressed), no persist.
        await this.publish(documentId, {
          event: 'app_event',
          originSocketId: socketId,
          data: frame.data,
        });
        return;
      }

      this.send(client, 'error', {
        code: 'UNKNOWN_EVENT',
        message: `Unsupported event: ${(frame as { event?: string }).event}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const response = (
        err as {
          getResponse?: () => unknown;
        }
      ).getResponse?.();
      this.send(client, 'error', {
        code: 'DOCUMENT_WS_ERROR',
        message,
        detail: response,
      });
    }
  }

  private async handleSyncRequest(
    client: TrackedSocket,
    user: AuthUser,
    documentId: string,
    data: IncomingFrame['data'],
  ) {
    const query = ListDocumentOperationsQuerySchema.parse(data ?? {});
    const { operations, resync } = await this.documents.getOperationSyncWindow(
      user,
      documentId,
      query.afterSequence,
      query.limit,
    );
    this.send(client, 'operations_sync', {
      afterSequence: resync.fromSequence,
      operations,
      resync: resync.required,
    });
  }

  private async handleOperation(
    client: TrackedSocket,
    user: AuthUser,
    documentId: string,
    socketId: string,
    data: unknown,
  ) {
    const input = AppendDocumentOperationSchema.parse(data);
    const { operation } = await this.documents.appendOperation(
      user,
      documentId,
      input,
    );
    this.send(client, 'operation_ack', { operation });
    await this.publish(documentId, {
      event: 'document_operation',
      originSocketId: socketId,
      data: operation,
    });
  }

  private async handlePresence(
    client: TrackedSocket,
    user: AuthUser,
    documentId: string,
    socketId: string,
    data: unknown,
  ) {
    const input = UpsertDocumentPresenceSchema.parse({
      ...(typeof data === 'object' && data ? data : {}),
      connectionId: socketId,
      ttlSeconds: DEFAULT_PRESENCE_TTL_SECONDS,
    });
    const { presence } = await this.documents.upsertPresence(
      user,
      documentId,
      input,
    );
    await this.publish(documentId, {
      event: 'presence_update',
      originSocketId: socketId,
      data: presence,
    });
  }

  private async handleAwareness(
    client: TrackedSocket,
    documentId: string,
    socketId: string,
    data: AwarenessFrameData | undefined,
  ) {
    const update = this.decodeBase64(data?.update);
    if (!update) {
      this.send(client, 'error', {
        code: 'INVALID_AWARENESS',
        message: 'awareness frame requires a base64 `update`.',
      });
      return;
    }
    // Apply locally first (origin = socket) so the controlled-id bookkeeping is
    // recorded synchronously, then fan the raw update out. Peers (incl. this pod
    // via Redis) apply it; the sender is echo-suppressed by originSocketId.
    this.awareness.apply(documentId, update, client);
    await this.publish(documentId, {
      event: 'awareness',
      originSocketId: socketId,
      data: { update: this.encodeBase64(update) },
    });
  }

  private addSubscriber(documentId: string, sock: TrackedSocket) {
    let set = this.socketsByDocument.get(documentId);
    if (!set) {
      set = new Set();
      this.socketsByDocument.set(documentId, set);
    }
    set.add(sock);
  }

  private async publish(documentId: string, event: RedisDocumentEvent) {
    const payload = JSON.stringify(event);
    try {
      await this.redisPublisher.publish(
        `${REDIS_CHANNEL_PREFIX}${documentId}`,
        payload,
      );
    } catch (err) {
      this.logger.warn(
        `redis publish failed for document ${documentId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.broadcastFrame(documentId, event.event, event.data, {
        exceptSocketId: event.originSocketId,
      });
    }
  }

  private broadcastFrame(
    documentId: string,
    event: string,
    data: unknown,
    opts: { exceptSocketId?: string } = {},
  ) {
    const subs = this.socketsByDocument.get(documentId);
    if (!subs || subs.size === 0) return;
    for (const sock of subs) {
      if (sock.__socketId === opts.exceptSocketId) continue;
      this.send(sock, event, data);
    }
  }

  private send(client: WebSocket, event: string, data: unknown) {
    if (client.readyState !== client.OPEN) return;
    client.send(JSON.stringify({ event, data }));
  }

  private sendHeartbeat(client: WebSocket) {
    this.send(client, 'heartbeat', { serverTime: Date.now() });
  }

  private sendHeartbeats() {
    for (const subs of this.socketsByDocument.values()) {
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

  private async authenticateRequest(
    url: URL,
    request: IncomingMessage,
  ): Promise<AuthUser | null> {
    let cookie = request.headers.cookie ?? '';
    const querySatoken = url.searchParams.get('satoken');
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
    return this.authenticateFromCookie(cookie);
  }

  private async authenticateFromCookie(cookie: string | undefined) {
    if (process.env.AUTH_DISABLED === 'true') {
      return {
        userId: 'dev',
        userName: 'dev',
        nickName: 'Developer',
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
      this.send(client, 'terminate', { reason, code });
    } catch {
      /* socket already closed */
    }
    try {
      client.close(code, reason);
    } catch {
      /* socket already closed */
    }
  }

  private encodeBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
  }

  private decodeBase64(value: unknown): Uint8Array | null {
    if (typeof value !== 'string' || value.length === 0) return null;
    try {
      const buf = Buffer.from(value, 'base64');
      return buf.byteLength > 0 ? new Uint8Array(buf) : null;
    } catch {
      return null;
    }
  }

  private rawDataToString(raw: RawData): string {
    if (typeof raw === 'string') return raw;
    if (Buffer.isBuffer(raw)) return raw.toString('utf8');
    if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
    return Buffer.from(raw).toString('utf8');
  }

  private numberParam(value: string | null, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.trunc(parsed);
  }
}
