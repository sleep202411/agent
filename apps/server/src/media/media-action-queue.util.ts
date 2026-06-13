import { hostname } from 'os';
import { Prisma } from '@prisma/client';

/**
 * Shared retry/backoff/JSON helpers for the durable media moderation-action
 * workers (CDN purge, storage takedown). Each worker owns its own claim/drain
 * loop (their where-clauses and includes differ), but the failure ladder and
 * the JSON plumbing are identical and live here so they can't drift.
 */

/** Max attempts before an action is dead-lettered (deadAt set). */
export const MEDIA_ACTION_MAX_ATTEMPTS = 8;

/** Backoff before the Nth retry; clamped to the last entry past the end. */
export const MEDIA_ACTION_BACKOFFS_MS = [
  5_000,
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
];

/** Stable per-process worker identity for optimistic row locking. */
export const MEDIA_ACTION_POD_ID = `${hostname()}-${process.pid}`;

export function mediaActionBackoffMs(attempt: number): number {
  const index = Math.min(attempt, MEDIA_ACTION_BACKOFFS_MS.length - 1);
  return MEDIA_ACTION_BACKOFFS_MS[index];
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isJsonObject(
  value: Prisma.JsonValue,
): value is Prisma.JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function mergeJson(
  current: Prisma.JsonValue,
  patch: Record<string, unknown>,
): Prisma.InputJsonObject {
  return {
    ...(isJsonObject(current) ? current : {}),
    ...patch,
  } as Prisma.InputJsonObject;
}

export function positiveInt(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
