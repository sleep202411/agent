/**
 * Redis key builders + UTC window helpers — single source of truth for
 * how quota counters are spelled in Redis.
 *
 * Conventions:
 *
 *   - Day window: `quota:{userId}:{dim}:day:{YYYY-MM-DD}` — TTL 36h
 *     (covers any TZ display the FE wants up to UTC+12).
 *   - Month window: `quota:{userId}:{dim}:month:{YYYY-MM}` — TTL 40d.
 *   - Minute window (chat rate limit): `quota:{userId}:chat:1m:{YYYY-MM-DDTHH:MM}` — TTL 90s.
 *   - Idempotency: `quota:idem:v2:{sha256(user, dimension, op)}` — TTL 24h.
 *
 * Day boundaries are UTC at the storage layer; the frontend converts
 * `resetAt` to user-local for display. Don't be tempted to do per-user
 * TZ at the key level — multi-pod consistency goes out the window.
 */
import { createHash } from 'crypto';
import type { QuotaDimension } from '@prisma/client';

/** Returns `YYYY-MM-DD` in UTC. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Returns `YYYY-MM` in UTC. */
export function utcMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** Returns `YYYY-MM-DDTHH:MM` in UTC (no seconds). */
export function utcMinuteKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 16);
}

/** ISO timestamp of next UTC midnight — used as `resetAt`. */
export function nextUtcMidnight(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

/** ISO timestamp of next minute boundary — for chat rate-limit reset. */
export function nextUtcMinute(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCSeconds(60, 0);
  return d.toISOString();
}

export function dayKey(userId: string, dim: QuotaDimension, day = utcDayKey()) {
  return `quota:${userId}:${dim}:day:${day}`;
}

export function monthKey(
  userId: string,
  dim: QuotaDimension,
  month = utcMonthKey(),
) {
  return `quota:${userId}:${dim}:month:${month}`;
}

export function minuteKey(userId: string, minute = utcMinuteKey()) {
  return `quota:${userId}:chat:1m:${minute}`;
}

/**
 * Redis never sees a caller-controlled idempotency key directly.
 *
 * The authenticated principal and quota dimension are part of the digest, so
 * the same client token cannot dedupe another user's charge or another paid
 * dimension. Hashing also gives Redis a fixed-size key even when an upstream
 * domain uses a long composite operation identifier.
 */
export function idempotencyKey(
  userId: string,
  dimension: QuotaDimension,
  operationKey: string,
) {
  const digest = createHash('sha256')
    .update('fizzdragon:quota-idempotency:v2\0', 'utf8')
    .update(userId, 'utf8')
    .update('\0', 'utf8')
    .update(dimension, 'utf8')
    .update('\0', 'utf8')
    .update(operationKey, 'utf8')
    .digest('hex');
  return `quota:idem:v2:${digest}`;
}

/** Counter TTLs. Day-window TTL = 36h so a user in UTC+12 (or polling
 *  past midnight) still hits a live key briefly into the next day. */
export const DAY_TTL_SEC = 36 * 60 * 60;
export const MONTH_TTL_SEC = 40 * 24 * 60 * 60;
export const MINUTE_TTL_SEC = 90;
export const IDEM_TTL_SEC = 24 * 60 * 60;
