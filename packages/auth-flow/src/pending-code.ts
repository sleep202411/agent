/**
 * The code session a dismissed dialog leaves behind.
 *
 * Closing the dialog wipes the machine — a half-typed phone number from
 * someone else's attempt is never what the next visitor wants. But the
 * resend cooldown is deliberately NOT wiped (see `resend-clock.ts`), and
 * that combination stranded the most ordinary first-run mistake there
 * is: the SMS arrives, the user taps away from the dialog to read it,
 * reopens, and finds the identifier step with a live countdown — unable
 * to enter the code they are holding and unable to ask for another one,
 * for up to a full minute.
 *
 * So the fact that a code is outstanding survives the close too. This
 * module stores WHICH account it went to and under WHICH mode, next to
 * the deadline that already survives, and the flow restores the code
 * step from it.
 *
 * ## How long it stays valid
 *
 * Exactly as long as the cooldown that caused the problem —
 * `readPendingCode` returns nothing once `readResendDeadline` has
 * lapsed. Three reasons, in order of weight:
 *
 *   1. That window IS the trap. While the cooldown runs there is no way
 *      back to the code screen; the moment it lapses, pressing Continue
 *      sends a fresh code and the flow is whole again. Resuming past it
 *      buys the user nothing they cannot already do.
 *   2. Java has never told us how long a code lives. A longer window
 *      would be a guess, and guessing long drops the user onto a code
 *      step holding an SMS that may already be dead — with no way to
 *      tell, because the only signal is the failed submit.
 *   3. One deadline, already persisted, already monotonic. A second
 *      expiry clock would be a second thing to keep in step.
 *
 * `sessionStorage`, like the deadline, so a reload resumes and a
 * different visitor tomorrow does not inherit a stranger's account. The
 * in-memory mirror is the source of truth so Safari private mode (which
 * throws on every storage access) degrades to per-page-load rather than
 * to nothing.
 */

import { readResendDeadline } from "./resend-clock";
import type { AuthMode, NormalizedIdentifier } from "./types";

const STORAGE_KEY = "fd.auth.pendingCode";

/** An outstanding code: where it went, and which flow issued it. */
export interface PendingCode {
  account: NormalizedIdentifier;
  mode: AuthMode;
}

let pending: PendingCode | null = null;

/**
 * The outstanding code, or `null` when there is none left to resume.
 *
 * Gated on the live cooldown rather than an expiry of its own, so the
 * record cannot outlive the window it exists to cover — and so clearing
 * the deadline clears this too.
 */
export function readPendingCode(now: number = Date.now()): PendingCode | null {
  if (!pending) pending = readStored();
  if (readResendDeadline() > now) return pending;
  clearPendingCode();
  return null;
}

/** Record the code that just went out. Replaces any earlier one. */
export function writePendingCode(next: PendingCode): void {
  pending = next;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort: the in-memory record still covers this page load.
  }
}

/** The code is spent (or void). Nothing left to resume. */
export function clearPendingCode(): void {
  pending = null;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — the in-memory record is already clear.
  }
}

function readStored(): PendingCode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw === null ? null : parse(JSON.parse(raw));
  } catch {
    // Unreadable or not ours — treat it as no pending code at all.
    return null;
  }
}

/** Anything we did not write ourselves is not a resumable code. */
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
