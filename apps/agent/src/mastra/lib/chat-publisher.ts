/**
 * Agent-side writer into the chat message store.
 *
 * The message store is owned by the Nest server
 * (`apps/server/src/assistant/chat/message-store.service.ts`) — but for
 * workflow lifecycle events we bypass the HTTP round-trip and write
 * directly to Redis, then publish on the same pub/sub channel the Nest
 * ChatEventsGateway subscribes to. Connected clients get
 * `message_added` / `message_updated` events through the existing chat
 * WebSocket, no second channel needed.
 *
 * **Key formats + channel names below MUST stay in sync with the Nest
 * side**. They're duplicated deliberately so neither package has to pull
 * a Nest dep; if you change them there, change them here.
 */
import Redis from "ioredis";

const DEFAULT_TTL_SECONDS = 7 * 24 * 3600;

// Mirrors apps/server/src/assistant/chat/message-store.service.ts.
function keyMsgs(projectId: string): string {
  return `chat:${projectId}:msgs`;
}
function keyMsg(projectId: string, messageId: string): string {
  return `msg:${projectId}:${messageId}`;
}
function keyMeta(projectId: string): string {
  return `chat:${projectId}:meta`;
}
function channelEvents(projectId: string): string {
  return `chat:events:${projectId}`;
}

/**
 * Inline full message blobs on add/update events so connected clients
 * don't need a REST round-trip to fetch content. Reconnect / snapshot
 * paths still read Redis (via get-messages), but the steady-state is
 * pure push — no per-event HTTP hop.
 */
/**
 * Events this publisher emits. The Nest ChatEventsGateway also emits
 * `message_chunk` / `message_finalize` during supervisor streaming, but
 * they originate inside AgentStreamService (not here) — agent-side
 * publishers only ever add/update full blobs.
 */
type ChatEvent =
  | {
      type: "message_added";
      data: { messageId: string; message?: StoredMessage };
    }
  | {
      type: "message_updated";
      data: { messageId: string; message?: StoredMessage };
    };

/**
 * Minimum structural shape — matches StoredMessage in Nest's store. Parts
 * are passed through verbatim; we don't re-validate here because the
 * workflow-message publisher upstream already typed the payloads.
 */
export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  parts: unknown[];
  metadata?: Record<string, unknown>;
}

// ─── Connection pool (one pair per process) ────────────────────────────

let redisClient: Redis | null = null;
let publisherClient: Redis | null = null;

function getClients(): { redis: Redis; publisher: Redis } {
  if (redisClient && publisherClient) {
    return { redis: redisClient, publisher: publisherClient };
  }
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL unset — chat-publisher cannot write");
  }
  const opts = {
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => (times > 10 ? null : Math.min(times * 500, 5000)),
  };
  if (!redisClient) redisClient = new Redis(url, opts);
  if (!publisherClient) publisherClient = new Redis(url, opts);
  return { redis: redisClient, publisher: publisherClient };
}

async function publish(projectId: string, event: ChatEvent): Promise<void> {
  const { publisher } = getClients();
  try {
    await publisher.publish(channelEvents(projectId), JSON.stringify(event));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[chat-publisher] publish failed (${projectId}): ${msg}`);
  }
}

async function touch(projectId: string): Promise<void> {
  const { redis } = getClients();
  const pipeline = redis.pipeline();
  pipeline.hset(keyMeta(projectId), "lastActivity", Date.now());
  pipeline.expire(keyMeta(projectId), DEFAULT_TTL_SECONDS);
  pipeline.expire(keyMsgs(projectId), DEFAULT_TTL_SECONDS);
  await pipeline.exec();
}

// ─── Public helpers ────────────────────────────────────────────────────

/**
 * Append a new message to the conversation's id list + write the blob,
 * then publish `message_added` so connected WS clients refetch.
 *
 * Safe to call more than once with the same id (second rpush is a no-op
 * only if the id isn't already last; using distinct ids per emission is
 * the caller's responsibility — see workflow-messages.ts).
 */
export async function addChatMessage(projectId: string, message: StoredMessage): Promise<void> {
  const { redis } = getClients();
  const pipeline = redis.pipeline();
  pipeline.rpush(keyMsgs(projectId), message.id);
  pipeline.set(keyMsg(projectId, message.id), JSON.stringify(message), "EX", DEFAULT_TTL_SECONDS);
  await pipeline.exec();
  await touch(projectId);
  await publish(projectId, {
    type: "message_added",
    data: { messageId: message.id, message },
  });
}

/**
 * Overwrite an existing message's blob and publish `message_updated`.
 * Does NOT touch the id list — caller assumes the message already exists.
 */
export async function updateChatMessage(projectId: string, message: StoredMessage): Promise<void> {
  const { redis } = getClients();
  await redis.set(
    keyMsg(projectId, message.id),
    JSON.stringify(message),
    "EX",
    DEFAULT_TTL_SECONDS
  );
  await touch(projectId);
  await publish(projectId, {
    type: "message_updated",
    data: { messageId: message.id, message },
  });
}

/** Read a single message (used by workflow-messages to decide add vs update). */
export async function getChatMessage(
  projectId: string,
  messageId: string
): Promise<StoredMessage | null> {
  const { redis } = getClients();
  const raw = await redis.get(keyMsg(projectId, messageId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredMessage;
  } catch {
    return null;
  }
}
