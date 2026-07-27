"use client";

/**
 * Tiny event-emitter for "open the upgrade dialog with this payload".
 * The API client (or any 429-aware caller) calls `emitUpgrade(...)`;
 * the QuotaProvider's <UpgradeDialogHost/> subscribes once and renders
 * the modal.
 *
 * Singleton store kept deliberately framework-free — no Zustand, no
 * Context — so 429 catchers in plain `fetch` interceptors can fire
 * the same event without lifting React state up.
 */
import { parseLimit, type QuotaDimension, type WireLimit } from "@repo/shared";

export interface UpgradePayload {
  dimension: QuotaDimension;
  used: number;
  limit: number;
  resetAt: string;
  nextTier: string | null;
  /** -1 if next tier is unlimited (display as "∞"). */
  nextTierLimit: number | null;
}

type Listener = (p: UpgradePayload | null) => void;

let current: UpgradePayload | null = null;
const listeners = new Set<Listener>();

export function emitUpgrade(payload: UpgradePayload): void {
  current = payload;
  for (const l of listeners) l(payload);
}

export function dismissUpgrade(): void {
  current = null;
  for (const l of listeners) l(null);
}

export function subscribeUpgrade(listener: Listener): () => void {
  listeners.add(listener);
  if (current) listener(current);
  return () => listeners.delete(listener);
}

/** Normalise a 429 body shape returned by QuotaGuard. */
export function payloadFromServerError(body: unknown): UpgradePayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.error !== "quota_exceeded") return null;
  const dimension = b.dimension as QuotaDimension | undefined;
  const used = typeof b.used === "number" ? b.used : 0;
  const limitRaw = b.limit as number | WireLimit | undefined;
  const limit = typeof limitRaw === "number" ? limitRaw : limitRaw ? parseLimit(limitRaw) : 0;
  const resetAt = typeof b.resetAt === "string" ? b.resetAt : "";
  if (!dimension || !resetAt) return null;
  const nextTier = (b.nextTier as string | null) ?? null;
  const nextTierLimit = typeof b.nextTierLimit === "number" ? b.nextTierLimit : null;
  return { dimension, used, limit, resetAt, nextTier, nextTierLimit };
}
