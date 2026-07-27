/**
 * Send-code cooldown as a wall-clock deadline that outlives auth screens.
 *
 * Mirrors `@repo/auth-flow` `resend-clock.ts`: OTP send is unauthenticated
 * and bills an SMS, so the gate must survive leaving/reopening login or
 * forgot-password. One global deadline (not per-identifier) — cycling the
 * account field must not bypass the spend control.
 */

import { deleteStoredString, getStoredString, setStoredString } from "@/lib/persistent-storage";

const STORAGE_KEY = "fizzdragon.mobile.auth.resendUntil.v1";

/** Epoch ms before which no send may go out. 0 = nothing armed. */
let deadline = 0;
let hydratePromise: Promise<void> | undefined;

export async function hydrateResendClock(): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      const raw = await getStoredString(STORAGE_KEY);
      const parsed = raw === null ? Number.NaN : Number(raw);
      if (Number.isFinite(parsed) && parsed > deadline) deadline = parsed;
    })().catch(() => {
      // Storage unavailable — keep the in-memory deadline only.
    });
  }
  await hydratePromise;
}

export function readResendDeadline(): number {
  return deadline;
}

/** Arm the cooldown. Monotonic — never shortens a live one. */
export function armResendDeadline(at: number): void {
  if (at <= deadline) return;
  deadline = at;
  void setStoredString(STORAGE_KEY, String(at)).catch(() => {
    // Best-effort: in-memory gate still covers this process.
  });
}

/** Seconds still to wait, rounded up so "1" never renders as "0". */
export function secondsUntilResend(now: number = Date.now()): number {
  return deadline > now ? Math.ceil((deadline - now) / 1000) : 0;
}

export function clearResendDeadline(): void {
  deadline = 0;
  void deleteStoredString(STORAGE_KEY).catch(() => undefined);
}

export const RESEND_COOLDOWN_SECONDS = 60;
