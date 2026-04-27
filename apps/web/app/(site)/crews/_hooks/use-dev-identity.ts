/**
 * Dev-only identity store for testing mock crew flows before auth.
 *
 * Identity is a flat string so it survives a `localStorage` round-trip:
 *   - "visitor"            — not part of the crew
 *   - "owner"              — the crew owner / producer
 *   - "member:<name>"      — impersonating a specific crew member
 *
 * Use the helper `parseIdentity()` to branch on it cleanly. When real
 * auth lands, derive the identity from `authUser` + crew membership
 * and remove the floating switcher.
 */

"use client";

import { useSyncExternalStore } from "react";

export type Identity = { kind: "visitor" } | { kind: "owner" } | { kind: "member"; name: string };

const KEY = "__crews_dev_identity";
const listeners = new Set<() => void>();

function readRaw(): string {
  if (typeof localStorage === "undefined") return "owner";
  return localStorage.getItem(KEY) || "owner";
}

function emit() {
  listeners.forEach((l) => l());
}

export function setDevIdentity(raw: string) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, raw);
  emit();
}

export function parseIdentity(raw: string): Identity {
  if (raw === "visitor") return { kind: "visitor" };
  if (raw === "owner") return { kind: "owner" };
  if (raw.startsWith("member:")) return { kind: "member", name: raw.slice(7) };
  return { kind: "owner" };
}

export function serializeIdentity(id: Identity): string {
  if (id.kind === "member") return `member:${id.name}`;
  return id.kind;
}

/** Subscribe to the raw identity string. Use `parseIdentity()` to branch. */
export function useDevIdentityRaw(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readRaw,
    () => "owner"
  );
}

/** Convenience: subscribe and parse in one call. */
export function useDevIdentity(): Identity {
  return parseIdentity(useDevIdentityRaw());
}
