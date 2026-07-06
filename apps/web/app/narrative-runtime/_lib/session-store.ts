/**
 * In-memory session store — NO DATABASE (prototype only).
 *
 * A module-level Map survives across requests within the same Node process
 * (fine for local dev / a single instance), and dies on restart. This is exactly
 * the persistence layer Java will own for real; here it only has to make the
 * loop run. The bible lives here (server-side) so it's never sent to the client.
 */

import type { Session } from "./types";

const store = new Map<string, Session>();
const TTL_MS = 2 * 60 * 60 * 1000; // 2h idle

function prune(): void {
  const now = Date.now();
  for (const [id, s] of store) {
    if (now - s.updatedAt > TTL_MS) store.delete(id);
  }
}

export function saveSession(id: string, session: Session): void {
  prune();
  store.set(id, session);
}

export function getSession(id: string): Session | null {
  prune();
  return store.get(id) ?? null;
}

export function touchSession(id: string, session: Session): void {
  session.updatedAt = Date.now();
  store.set(id, session);
}
