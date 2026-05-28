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
 *   { event: "ping" }
 *
 * Outgoing frames:
 *   document_snapshot, operations_sync, document_operation,
 *   presence_update, presence_left, heartbeat, error, terminate.
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
};

type IncomingFrame =
  | { event: 'sync_request'; data?: { afterSequence?: number; limit?: number } }
  | { event: 'operation'; data?: unknown }
  | { event: 'presence'; data?: unknown }
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
      this.addSubscriber(documentId, client);

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
        afterSequence,
        operations: syncState.operations,
      });
      this.send(client, 'presence_state', {
        presences: syncState.presences,
      });
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
    const { operations } = await this.documents.listOperations(
      user,
      documentId,
      query,
    );
    this.send(client, 'operations_sync', {
      afterSequence: query.afterSequence,
      operations,
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
