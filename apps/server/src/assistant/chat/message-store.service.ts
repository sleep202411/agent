/**
 * Redis-backed per-conversation message store.
 *
 * Schema (key layout):
 *   chat:{projectId}:msgs        — LIST of messageIds, appended in order
 *   msg:{projectId}:{msgId}      — JSON-encoded AssistantMessage
 *   chat:{projectId}:meta        — HASH { agentState, lastActivity, hash }
 *
 * Events (Redis pub/sub):
 *   chat:events:{projectId}      — JSON frames consumed by ChatEventsGateway
 *     { type: "message_added",     data: { messageId } }
 *     { type: "message_updated",   data: { messageId } }
 *     { type: "message_chunk",     data: { messageId, partIndex, appendText } }
 *     { type: "message_finalize",  data: { messageId } }
 *     { type: "agent_state",       data: { state } }
 *
 * Streaming model (message_chunk / message_finalize):
 *   For supervisor token-by-token streaming we bypass Redis writes on every
 *   token — instead, each text delta is published directly to the pub/sub
 *   channel and the client appends it to its in-memory copy. Redis is
 *   checkpointed on a coarser interval and finalized once when the stream
 *   ends. This keeps reconnect resilience (Redis has a "close enough" blob)
 *   without taking a SET + publish round-trip on every LLM token.
 *
 * TTL: 7 days per conversation (touch on every write). VIP tiers can bump
 * via setConversationTtl(projectId, days) if we expose tier-aware writers.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

const DEFAULT_TTL_SECONDS = 7 * 24 * 3600;

export type ChatAgentState = 'idle' | 'running' | 'waiting' | 'failed';

type MessageLike = { id?: unknown; [k: string]: unknown };

/**
 * Minimum structural shape we care about. The value going in/out is the raw
 * AssistantMessage from the UI contract — we do NOT deserialize into a
 * typed class because the web client owns the authoritative shape.
 */
export interface StoredMessage extends MessageLike {
  id: string;
}

export type ChatEvent =
  | {
      type: 'message_added';
      data: { messageId: string; message?: StoredMessage };
    }
  | {
      type: 'message_updated';
      data: { messageId: string; message?: StoredMessage };
    }
  | {
      type: 'message_chunk';
      data: { messageId: string; partIndex: number; appendText: string };
    }
  | { type: 'message_finalize'; data: { messageId: string } }
  | { type: 'agent_state'; data: { state: ChatAgentState } };

function keyMsgs(projectId: string) {
  return `chat:${projectId}:msgs`;
}
function keyMsg(projectId: string, messageId: string) {
  return `msg:${projectId}:${messageId}`;
}
function keyMeta(projectId: string) {
  return `chat:${projectId}:meta`;
}
function channelEvents(projectId: string) {
  return `chat:events:${projectId}`;
}

@Injectable()
export class MessageStoreService implements OnModuleDestroy {
  private readonly logger = new Logger(MessageStoreService.name);
  private readonly redis: Redis | null;
  private readonly publisher: Redis | null;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn('REDIS_URL unset — MessageStoreService is a no-op');
      this.redis = null;
      this.publisher = null;
      return;
    }
    const opts = {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) =>
        times > 10 ? null : Math.min(times * 500, 5000),
      lazyConnect: true,
    };
    this.redis = new Redis(url, opts);
    this.publisher = new Redis(url, opts);
    this.redis.on('error', (err) =>
      this.logger.warn(`redis error: ${err.message}`),
    );
    this.publisher.on('error', (err) =>
      this.logger.warn(`publisher error: ${err.message}`),
    );
    void this.redis
      .connect()
      .catch((err) => this.logger.warn(`redis connect: ${err.message}`));
    void this.publisher
      .connect()
      .catch((err) => this.logger.warn(`publisher connect: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis?.quit();
    } catch {}
    try {
      await this.publisher?.quit();
    } catch {}
  }

  private ensureMessageId(message: MessageLike): string {
    const id = message.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('StoredMessage requires a string id');
    }
    return id;
  }

  private async publish(projectId: string, event: ChatEvent): Promise<void> {
    if (!this.publisher) return;
    try {
      await this.publisher.publish(
        channelEvents(projectId),
        JSON.stringify(event),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`publish failed (${projectId}): ${msg}`);
    }
  }

  private async touch(projectId: string): Promise<void> {
    if (!this.redis) return;
    const pipeline = this.redis.pipeline();
    pipeline.hset(keyMeta(projectId), 'lastActivity', Date.now());
    pipeline.expire(keyMeta(projectId), DEFAULT_TTL_SECONDS);
    pipeline.expire(keyMsgs(projectId), DEFAULT_TTL_SECONDS);
    await pipeline.exec();
  }

  /**
   * Append a brand-new message to the conversation. Both user messages (the
   * submitted prompt) and assistant messages (supervisor responses) go
   * through the same API — callers pre-generate the stable id.
   */
  async addMessage(projectId: string, message: StoredMessage): Promise<void> {
    if (!this.redis) return;
    const id = this.ensureMessageId(message);
    const pipeline = this.redis.pipeline();
    pipeline.rpush(keyMsgs(projectId), id);
    pipeline.set(
      keyMsg(projectId, id),
      JSON.stringify(message),
      'EX',
      DEFAULT_TTL_SECONDS,
    );
    await pipeline.exec();
    await this.touch(projectId);
    await this.publish(projectId, {
      type: 'message_added',
      data: { messageId: id, message },
    });
  }

  /**
   * Overwrite an existing message's content. Used when the Mastra stream
   * produces intermediate partials and we want the client to pull the
   * latest version. Clients poll via get-messages; we only notify here.
   *
   * Caller should debounce: don't republish on every token — bundle text
   * deltas into ~500ms batches so we don't spam the channel.
   */
  async updateMessage(
    projectId: string,
    message: StoredMessage,
  ): Promise<void> {
    if (!this.redis) return;
    const id = this.ensureMessageId(message);
    await this.redis.set(
      keyMsg(projectId, id),
      JSON.stringify(message),
      'EX',
      DEFAULT_TTL_SECONDS,
    );
    await this.touch(projectId);
    await this.publish(projectId, {
      type: 'message_updated',
      data: { messageId: id, message },
    });
  }

  /**
   * Publish a text-delta chunk for a streaming assistant message. Does NOT
   * touch Redis — the client appends the delta to its in-memory copy of
   * the message. Periodic `checkpointMessage` calls keep Redis "close
   * enough" for reconnect recovery, and `finalizeMessage` writes the
   * terminal blob + publishes `message_finalize`.
   */
  async publishChunk(
    projectId: string,
    messageId: string,
    partIndex: number,
    appendText: string,
  ): Promise<void> {
    if (!appendText) return;
    await this.publish(projectId, {
      type: 'message_chunk',
      data: { messageId, partIndex, appendText },
    });
  }

  /**
   * Write the current snapshot to Redis without publishing. Used inside the
   * streaming loop as a "save point" — if the client reconnects mid-stream
   * it gets a blob that's at most N ms out of date (where N is the caller's
   * checkpoint interval). No pub/sub fanout, so connected clients keep
   * consuming `message_chunk` without dedupe churn.
   */
  async checkpointMessage(
    projectId: string,
    message: StoredMessage,
  ): Promise<void> {
    if (!this.redis) return;
    const id = this.ensureMessageId(message);
    await this.redis.set(
      keyMsg(projectId, id),
      JSON.stringify(message),
      'EX',
      DEFAULT_TTL_SECONDS,
    );
    await this.touch(projectId);
  }

  /**
   * Terminal call for a streaming assistant message. Writes the final blob
   * to Redis and publishes `message_finalize` so the client can switch the
   * bubble from "streaming" to "settled" (drop the caret, unlock actions).
   */
  async finalizeMessage(
    projectId: string,
    message: StoredMessage,
  ): Promise<void> {
    if (!this.redis) return;
    const id = this.ensureMessageId(message);
    await this.redis.set(
      keyMsg(projectId, id),
      JSON.stringify(message),
      'EX',
      DEFAULT_TTL_SECONDS,
    );
    await this.touch(projectId);
    await this.publish(projectId, {
      type: 'message_finalize',
      data: { messageId: id },
    });
  }

  /** Ordered list of message ids for this conversation. */
  async getMessageIds(projectId: string): Promise<string[]> {
    if (!this.redis) return [];
    return this.redis.lrange(keyMsgs(projectId), 0, -1);
  }

  /**
   * Batch fetch messages by id. Missing ids are silently skipped — the
   * client is expected to reconcile against the id list.
   */
  async getMessages<T extends StoredMessage = StoredMessage>(
    projectId: string,
    messageIds: string[],
  ): Promise<T[]> {
    if (!this.redis || messageIds.length === 0) return [];
    const keys = messageIds.map((id) => keyMsg(projectId, id));
    const raws = await this.redis.mget(...keys);
    const out: T[] = [];
    for (const raw of raws) {
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw) as T);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`parse message failed: ${msg}`);
      }
    }
    return out;
  }

  /**
   * Compute a cheap hash used by the ChatEventsGateway heartbeat — clients
   * compare their locally-cached hash to detect dropped events and trigger
   * a full resync. Includes the id list length + agent state so any change
   * flips the string.
   */
  async getConversationHash(projectId: string): Promise<string> {
    if (!this.redis) return 'no-redis';
    const [len, state] = await Promise.all([
      this.redis.llen(keyMsgs(projectId)),
      this.redis.hget(keyMeta(projectId), 'agentState'),
    ]);
    return `${len}:${state ?? 'idle'}`;
  }

  /**
   * Wipe every key for this conversation — msgs list, each message blob,
   * meta hash. Intended for "new conversation" UX and manual resets
   * during debugging. Publishes a message_list event with the now-empty
   * id list so connected WS clients flush their local state.
   */
  async clearConversation(projectId: string): Promise<void> {
    if (!this.redis) return;
    const ids = await this.getMessageIds(projectId);
    const pipeline = this.redis.pipeline();
    pipeline.del(keyMsgs(projectId));
    pipeline.del(keyMeta(projectId));
    for (const id of ids) pipeline.del(keyMsg(projectId, id));
    await pipeline.exec();
    // Publish so live subscribers drop the stale ids. We re-use the
    // message_added-compatible event shape by emitting a fresh snapshot
    // via the gateway's connect path instead; here we just flip agent
    // state which triggers a conversationHash change on next heartbeat.
    await this.publish(projectId, {
      type: 'agent_state',
      data: { state: 'idle' },
    });
  }

  async setAgentState(projectId: string, state: ChatAgentState): Promise<void> {
    if (!this.redis) return;
    await this.redis.hset(keyMeta(projectId), 'agentState', state);
    await this.touch(projectId);
    await this.publish(projectId, { type: 'agent_state', data: { state } });
  }

  async getAgentState(projectId: string): Promise<ChatAgentState> {
    if (!this.redis) return 'idle';
    const v = await this.redis.hget(keyMeta(projectId), 'agentState');
    return (v as ChatAgentState | null) ?? 'idle';
  }
}
