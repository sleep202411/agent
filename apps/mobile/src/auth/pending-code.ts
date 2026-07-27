/**
 * Outstanding OTP that survives leaving the auth screen.
 *
 * Paired with `resend-clock`. While the cooldown is live, Continue on the
 * matching mode+account resumes the code step without a second SMS; a
 * different mode or account stays on the identifier step and surfaces the
 * cooldown (web `resumesSentCode` / `resend_cooldown`). Valid only while
 * `readResendDeadline()` is in the future.
 */

import { deleteStoredString, getStoredString, setStoredString } from "@/lib/persistent-storage";

import { readResendDeadline } from "./resend-clock";
import type { NormalizedIdentifier } from "./auth-service";

const STORAGE_KEY = "fizzdragon.mobile.auth.pendingCode.v1";

export type AuthCodeMode = "signin" | "reset";

export type PendingCode = {
  account: NormalizedIdentifier;
  mode: AuthCodeMode;
};

let pending: PendingCode | null = null;
let hydratePromise: Promise<void> | undefined;

export async function hydratePendingCode(): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      const raw = await getStoredString(STORAGE_KEY);
      if (!raw) return;
      try {
        pending = parse(JSON.parse(raw));
      } catch {
        pending = null;
      }
    })().catch(() => undefined);
  }
  await hydratePromise;
}

export function readPendingCode(now: number = Date.now()): PendingCode | null {
  if (readResendDeadline() > now) return pending;
  clearPendingCode();
  return null;
}

export function writePendingCode(next: PendingCode): void {
  pending = next;
  void setStoredString(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
}

export function clearPendingCode(): void {
  pending = null;
  void deleteStoredString(STORAGE_KEY).catch(() => undefined);
}

function parse(value: unknown): PendingCode | null {
  if (typeof value !== "object" || value === null) return null;
  const { account, mode } = value as { account?: unknown; mode?: unknown };
  if (mode !== "signin" && mode !== "reset") return null;
  if (typeof account !== "object" || account === null) return null;
  const { kind, account: wire } = account as { kind?: unknown; account?: unknown };
  if (kind !== "phone" && kind !== "email") return null;
  if (typeof wire !== "string" || wire.length === 0) return null;
  return { account: { kind, account: wire }, mode };
}
