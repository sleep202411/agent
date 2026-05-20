/**
 * Per-user quota — shared wire types between Nest server and web.
 *
 * Server publishes a single event type on consume / refund / refresh.
 * The web QuotaProvider keeps an in-memory mirror seeded by GET
 * /aurora/quota and patched by WS deltas.
 *
 * `Infinity` doesn't survive JSON, so the wire encodes it as the
 * literal string `"Infinity"`. Use `parseLimit()` on the client to
 * recover the number — `Number.POSITIVE_INFINITY` if unlimited,
 * otherwise the integer cap.
 */

export const QUOTA_DIMENSIONS = ["image", "chat", "workflow", "upload"] as const;
export type QuotaDimension = (typeof QUOTA_DIMENSIONS)[number];

export type Tier = "Free" | "VIP1" | "VIP2" | "VIP3";

/** JSON-friendly limit: integer or the literal string "Infinity". */
export type WireLimit = number | "Infinity";

export function parseLimit(value: WireLimit): number {
  return value === "Infinity" ? Number.POSITIVE_INFINITY : value;
}

export interface QuotaSnapshotWire {
  dimension: QuotaDimension;
  used: number;
  limit: WireLimit;
  remaining: WireLimit;
  /** 0..100. Always 0 for unlimited dimensions (renders ∞ badge instead). */
  percent: number;
  /** ISO timestamp of next reset (UTC midnight for daily). */
  resetAt: string;
}

export interface QuotaPeekWire {
  tier: Tier;
  dimensions: Record<QuotaDimension, QuotaSnapshotWire>;
  chatPerMinute: { limit: number; remaining: number; resetAt: string };
}

/**
 * Single WS event frame on the quota channel. The server pushes:
 *
 *   - `quota_updated` after every successful consume / refund. The
 *     `dimension` payload is the snapshot for the dimension that
 *     changed (other dimensions stay client-cached).
 *   - `heartbeat` every 30s so the client can detect dead sockets
 *     (mirrors the chat / entity-events convention).
 *   - `terminate` on auth failure (1008 close imminent). The client
 *     stops auto-reconnecting on this code.
 */
export type QuotaEventFrame =
  | { event: "quota_updated"; data: QuotaSnapshotWire }
  | { event: "heartbeat"; data: { serverTime: number } }
  | { event: "terminate"; data: { reason: string; code: number } };

/** Redis pub/sub channel prefix — one channel per user. */
export const QUOTA_CHANNEL_PREFIX = "quota:events:";
export const QUOTA_CHANNEL_PATTERN = "quota:events:*";

export function quotaChannel(userId: string): string {
  return `${QUOTA_CHANNEL_PREFIX}${userId}`;
}
