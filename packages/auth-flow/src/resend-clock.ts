/**
 * The send-code cooldown, as a wall-clock deadline that outlives the
 * dialog.
 *
 * `GET /user/new/getCode` and its reset-flow twins are UNAUTHENTICATED
 * and bill a real SMS per call, so the cooldown is a spend control, not
 * a nicety. Keeping it in React state made it bypassable by anything
 * that rebuilt that state — going back and re-submitting, closing and
 * reopening the dialog, switching between the code and password entries.
 * A deadline stored outside the component tree cannot be reset by
 * re-entering the flow; the only thing that clears it is time passing.
 *
 * ONE deadline, global to the browser tab — deliberately NOT keyed by
 * identifier. A per-identifier map throttles nothing that matters: the
 * expensive abuse is spraying codes at MANY numbers, and cycling the
 * field is the cheapest possible bypass of a per-identifier gate. The
 * cost of the global choice is that a user who mistypes their number
 * waits out the countdown before correcting it, which the identifier
 * step states plainly (it shows the same countdown the resend button
 * does) — and re-submitting the SAME identifier does not need a send at
 * all, so the common correction path is unaffected.
 *
 * `sessionStorage` because a reload is otherwise a one-key bypass; the
 * in-memory mirror is the source of truth so Safari private mode (which
 * throws on every storage access) degrades to per-page-load rather than
 * to nothing. Session-scoped, not local: a cooldown is about this tab's
 * activity, and must not greet a different visitor tomorrow.
 */

const STORAGE_KEY = "fd.auth.resendUntil";

/** Epoch ms before which no send may go out. 0 = nothing armed. */
let deadline = 0;
let pendingSend: symbol | null = null;

/** Reserve the tab's send slot until the transport settles. */
export function claimCodeSend(): (() => void) | null {
  if (pendingSend) return null;
  const claim = Symbol();
  pendingSend = claim;
  return () => {
    if (pendingSend === claim) pendingSend = null;
  };
}

/** When the next send is allowed, as epoch ms. */
export function readResendDeadline(): number {
  const stored = readStored();
  if (stored > deadline) deadline = stored;
  return deadline;
}

/**
 * Arm the cooldown. Monotonic — an earlier deadline never shortens a
 * live one, so no ordering of concurrent dialogs can weaken the gate.
 */
export function armResendDeadline(at: number): void {
  if (at <= deadline) return;
  deadline = at;
  writeStored(at);
}

/** Test-only reset. Production has no reason to end a cooldown early. */
export function clearResendDeadline(): void {
  deadline = 0;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — the in-memory mirror is already clear.
  }
}

/** Seconds still to wait, rounded up so "1" never renders as "0". */
export function secondsUntil(deadlineAt: number, now: number): number {
  return deadlineAt > now ? Math.ceil((deadlineAt - now) / 1000) : 0;
}

function readStored(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeStored(at: number): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, String(at));
  } catch {
    // Best-effort: the in-memory deadline still gates this page load.
  }
}
