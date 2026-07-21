/**
 * The sign-in state machine — pure, framework-free, fully unit-tested.
 *
 * One "Continue" button, no register/login split. `apps/web` and
 * `apps/studio` run this exact machine; only the transport and the copy
 * differ. The reducer owns step transitions, pending, errors, the resend
 * countdown, and back navigation so neither app can invent its own.
 *
 * Two modes share those steps:
 *   - `signin` — identifier → code (auto-registers) → profile → invite,
 *     with the password entry as the legacy side door.
 *   - `reset`  — identifier → code → NEW password → signed in. Reached
 *     only from the password entry (there is no password to forget in
 *     the code flow) or by opening the dialog on `/forgot-password`.
 */

import { authError, type AuthError } from "./errors";
import { normalizeIdentifier } from "./identifier";
import type { PendingCode } from "./pending-code";
import { secondsUntil } from "./resend-clock";
import type { AuthMode, AuthSession, NormalizedIdentifier } from "./types";

export type AuthStep =
  | "identifier"
  | "code"
  | "password"
  | "reset_password"
  | "profile"
  | "invite"
  | "done";

export type { AuthMode };

export interface AuthStepConfig {
  /** Offer avatar + nickname to brand-new accounts. */
  profile: boolean;
  /** Offer the optional invite code to brand-new accounts. */
  invite: boolean;
}

export const DEFAULT_STEP_CONFIG: AuthStepConfig = { profile: true, invite: true };

/** Matches the legacy send-code cooldown both apps already shipped. */
export const DEFAULT_RESEND_SECONDS = 60;

export const CODE_LENGTH = 6;

/** What the deleted `/forgot-password` page enforced; unchanged. */
export const MIN_PASSWORD_LENGTH = 6;

export interface AuthFlowState {
  mode: AuthMode;
  step: AuthStep;
  steps: AuthStepConfig;
  /** Raw text in the identifier field, exactly as typed. */
  identifier: string;
  /** Set once a code has been sent; the value actually on the wire. */
  account: NormalizedIdentifier | null;
  code: string;
  password: string;
  /** Reset flow only — the password the user is choosing now. */
  newPassword: string;
  confirmPassword: string;
  nickname: string;
  /** Path returned by the avatar upload; the upload already committed it. */
  avatarPath: string | null;
  inviteCode: string;
  /** A request is in flight — every control is disabled and non-closable. */
  pending: boolean;
  /** Set while the avatar upload is in flight (a sub-request of `profile`). */
  uploadingAvatar: boolean;
  error: AuthError | null;
  /**
   * Epoch ms before which no send may go out — the SINGLE source of
   * truth for the cooldown, seeded from `resend-clock`'s tab-wide
   * deadline so re-entering the flow cannot restart it.
   */
  resendAvailableAt: number;
  /** Seconds until "resend" is tappable again. Derived from the above. */
  resendSeconds: number;
  /** True once a code has been sent at least once for `account`. */
  codeSent: boolean;
  /**
   * The mode the live code was issued under, or null when none is
   * outstanding.
   *
   * `account` alone does not identify a code: the two modes ask
   * DIFFERENT Java endpoints for it and Java scopes each one to the call
   * that spends it, so a sign-in code cannot complete a reset. Without
   * this, `start_reset` (which keeps `account` and `codeSent` while
   * flipping `mode`) let the cooldown gate resume a sign-in code into
   * the reset flow: the user typed the SMS they really had received,
   * reached the new-password step, and Java refused it — with resend
   * still on cooldown and no code ever sent for the reset.
   */
  sentMode: AuthMode | null;
  session: AuthSession | null;
  resendCooldown: number;
}

export type AuthFlowEvent =
  | { type: "identifier_changed"; value: string }
  | { type: "code_changed"; value: string }
  | { type: "password_changed"; value: string }
  | { type: "new_password_changed"; value: string }
  | { type: "confirm_password_changed"; value: string }
  | { type: "nickname_changed"; value: string }
  | { type: "invite_changed"; value: string }
  | { type: "request_started" }
  /** `step` moves the user to where the failure is actionable. */
  | { type: "request_failed"; error: AuthError; step?: AuthStep }
  | { type: "code_sent"; account: NormalizedIdentifier; at: number }
  /** Cooldown is live and the identifier is unchanged: no send needed. */
  | { type: "resume_code" }
  /** Reset flow: the typed code moves on to the new-password step. */
  | { type: "code_confirmed" }
  | { type: "logged_in"; session: AuthSession }
  | { type: "avatar_upload_started" }
  | { type: "avatar_uploaded"; path: string }
  | { type: "avatar_upload_failed"; error: AuthError }
  | { type: "profile_finished" }
  | { type: "invite_finished" }
  | { type: "dismissed" }
  | { type: "use_password" }
  | { type: "use_code" }
  | { type: "start_reset" }
  | { type: "cancel_reset" }
  | { type: "back" }
  /** `resendAvailableAt` folds in the tab-wide clock; omitted = keep ours. */
  | { type: "tick"; now: number; resendAvailableAt?: number }
  /** `resendAvailableAt` re-seeds from the clock; omitted = keep ours. */
  | {
      type: "reset";
      now: number;
      mode?: AuthMode;
      resendAvailableAt?: number;
      resumeCode?: PendingCode | null;
    };

export function createInitialState(options?: {
  mode?: AuthMode;
  steps?: Partial<AuthStepConfig>;
  resendCooldown?: number;
  identifier?: string;
  inviteCode?: string;
  /** Live deadline from `resend-clock`, so a remount inherits it. */
  resendAvailableAt?: number;
  /**
   * An outstanding code from an earlier mount (`pending-code`). When it
   * belongs to this flow the machine opens ON the code step instead of
   * the identifier field — see `resumableCode` for when it does not.
   */
  resumeCode?: PendingCode | null;
  now?: number;
}): AuthFlowState {
  const resendAvailableAt = options?.resendAvailableAt ?? 0;
  const identifier = options?.identifier ?? "";
  // An unspent code decides the mode when the host did not ask for one.
  // Reopening always mounts as "signin", so without this a reset code the
  // user dismissed to go read is unreachable: every entry point rebuilds a
  // sign-in flow that refuses to resume it, and the only way out is to wait
  // out the cooldown and buy a second SMS.
  const mode = options?.mode ?? options?.resumeCode?.mode ?? "signin";
  const resume = resumableCode(options?.resumeCode, mode, identifier);
  return {
    mode,
    step: resume ? "code" : "identifier",
    steps: { ...DEFAULT_STEP_CONFIG, ...options?.steps },
    // The resumed account is the identifier, verbatim on the wire: going
    // back from the restored code step must show what the code was sent
    // to, not an empty field.
    identifier: resume ? resume.account.account : identifier,
    account: resume?.account ?? null,
    code: "",
    password: "",
    newPassword: "",
    confirmPassword: "",
    nickname: "",
    avatarPath: null,
    // Pre-filled from a referral link (`?recommendationCode=`) so the
    // invite step is a one-tap confirm instead of a retype.
    inviteCode: options?.inviteCode ?? "",
    pending: false,
    uploadingAvatar: false,
    error: null,
    resendAvailableAt,
    resendSeconds: secondsUntil(resendAvailableAt, options?.now ?? Date.now()),
    codeSent: resume !== null,
    sentMode: resume ? resume.mode : null,
    session: null,
    resendCooldown: options?.resendCooldown ?? DEFAULT_RESEND_SECONDS,
  };
}

/**
 * Whether an outstanding code may open THIS flow on the code step.
 *
 * Two refusals, both about not putting the user in front of a code that
 * cannot work:
 *   - a different mode — a sign-in code will not complete a reset, so
 *     restoring it would rebuild exactly the dead end `sentMode` exists
 *     to close;
 *   - a prefilled identifier that addresses someone else — the host is
 *     asking for a specific account, and it outranks whatever the last
 *     visitor left behind.
 */
function resumableCode(
  pending: PendingCode | null | undefined,
  mode: AuthMode,
  identifier: string
): PendingCode | null {
  if (!pending || pending.mode !== mode) return null;
  if (!identifier.trim()) return pending;
  const typed = normalizeIdentifier(identifier);
  return typed && sameAccount(typed, pending.account) ? pending : null;
}

function sameAccount(a: NormalizedIdentifier, b: NormalizedIdentifier): boolean {
  return a.kind === b.kind && a.account === b.account;
}

export function authFlowReducer(state: AuthFlowState, event: AuthFlowEvent): AuthFlowState {
  switch (event.type) {
    case "identifier_changed":
      // Typing is the user's answer to whatever the last error said.
      return { ...state, identifier: event.value, error: null };

    case "code_changed":
      return { ...state, code: sanitizeCode(event.value), error: null };

    case "password_changed":
      return { ...state, password: event.value, error: null };

    case "new_password_changed":
      return { ...state, newPassword: event.value, error: null };

    case "confirm_password_changed":
      return { ...state, confirmPassword: event.value, error: null };

    case "nickname_changed":
      return { ...state, nickname: event.value, error: null };

    case "invite_changed":
      return { ...state, inviteCode: event.value, error: null };

    case "request_started":
      return { ...state, pending: true, error: null };

    case "request_failed":
      return {
        ...state,
        pending: false,
        error: event.error,
        step: event.step ?? state.step,
      };

    case "code_sent":
      return {
        ...state,
        step: "code",
        account: event.account,
        // Clear on every send: a resend invalidates the previous code, and
        // leaving stale digits in the cells auto-submits a dead code.
        code: "",
        pending: false,
        error: null,
        codeSent: true,
        // Which endpoint issued it, so nothing downstream can offer this
        // code to the other mode's call.
        sentMode: state.mode,
        ...armCooldown(state, event.at),
      };

    case "resume_code":
      // The cooldown is still running for an identifier we already sent
      // to, in this same mode. Show the code step rather than burning a
      // second SMS or stranding the user on a field they cannot submit.
      // A code from the OTHER mode is not resumable — `sendCode` refuses
      // with the cooldown instead, and this guard is the backstop.
      return state.account && state.sentMode === state.mode
        ? { ...state, step: "code", error: null }
        : state;

    case "code_confirmed":
      // Reset only. Java verifies the code as part of the reset call
      // itself, so this is a screen change, not a round trip — nothing
      // here claims the code is valid.
      return state.mode === "reset" && state.account
        ? { ...state, step: "reset_password", error: null }
        : state;

    case "logged_in":
      return {
        ...state,
        pending: false,
        error: null,
        session: event.session,
        password: "",
        newPassword: "",
        confirmPassword: "",
        step: stepAfterLogin(event.session, state.steps, state.mode),
      };

    case "avatar_upload_started":
      return { ...state, uploadingAvatar: true, error: null };

    case "avatar_uploaded":
      return { ...state, uploadingAvatar: false, avatarPath: event.path };

    case "avatar_upload_failed":
      return { ...state, uploadingAvatar: false, error: event.error };

    case "profile_finished":
      return {
        ...state,
        pending: false,
        error: null,
        step: state.steps.invite ? "invite" : "done",
      };

    case "invite_finished":
      return { ...state, pending: false, error: null, step: "done" };

    case "dismissed":
      // Closing the dialog on `profile` / `invite` happens AFTER the login
      // call has already seated the satoken: the user is signed in whether
      // or not they finish onboarding. So a dismiss there means "skip the
      // rest", and it must land on the terminal step like every other exit
      // — an app that does not know it just signed someone in is a far
      // worse bug than a skipped nickname. Before a session exists there is
      // nothing to keep, so the host simply closes the dialog.
      return state.session ? { ...state, step: "done", error: null } : state;

    case "use_password":
      return { ...state, mode: "signin", step: "password", code: "", error: null };

    case "use_code":
      // Back to the single field: the password path may have been opened
      // for an account that does not exist yet, and only the code path
      // auto-registers.
      return { ...state, mode: "signin", step: "identifier", password: "", error: null };

    case "start_reset":
      // Entered from the password step only, so the identifier the user
      // already typed there carries over — they are resetting THAT
      // account. The cooldown is untouched: a reset code costs the same
      // SMS as a sign-in code.
      return {
        ...state,
        mode: "reset",
        step: "identifier",
        password: "",
        newPassword: "",
        confirmPassword: "",
        code: "",
        error: null,
      };

    case "cancel_reset":
      return {
        ...state,
        mode: "signin",
        step: "password",
        newPassword: "",
        confirmPassword: "",
        code: "",
        error: null,
      };

    case "back":
      if (state.step === "reset_password") {
        // Keep the code: they came back to re-read it, not to retype it.
        return { ...state, step: "code", newPassword: "", confirmPassword: "", error: null };
      }
      if (state.step === "code") {
        // `resendAvailableAt` is untouched here and everywhere else on the
        // way back to the identifier field: editing the identifier must
        // not reset the cooldown, or it becomes a free SMS-spam loop.
        return { ...state, step: "identifier", code: "", error: null };
      }
      if (state.step === "password") {
        return { ...state, step: "identifier", password: "", error: null };
      }
      if (state.step === "identifier" && state.mode === "reset") {
        return authFlowReducer(state, { type: "cancel_reset" });
      }
      return state;

    case "tick":
      return refreshCooldown(state, event.now, event.resendAvailableAt);

    case "reset":
      return createInitialState({
        // `undefined` — not "signin" — so an unspent code can still choose
        // the mode, the same way it does on a fresh mount.
        mode: event.mode,
        steps: state.steps,
        resendCooldown: state.resendCooldown,
        // Survives the wipe by design — a reopened dialog is exactly the
        // bypass this cooldown exists to close. The host re-seeds from
        // the tab-wide clock when it has one.
        resendAvailableAt: event.resendAvailableAt ?? state.resendAvailableAt,
        // So does an outstanding code: the wipe is there to keep one
        // visitor's half-typed number away from the next one, not to
        // strand the visitor who is still holding an SMS.
        resumeCode: event.resumeCode,
        now: event.now,
      });

    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/** A send just went out: the deadline moves out by the configured cooldown. */
function armCooldown(
  state: AuthFlowState,
  at: number
): Pick<AuthFlowState, "resendAvailableAt" | "resendSeconds"> {
  // `Math.max` so a shorter per-app cooldown can never cut a longer one
  // that is already running.
  const resendAvailableAt = Math.max(state.resendAvailableAt, at + state.resendCooldown * 1000);
  return { resendAvailableAt, resendSeconds: secondsUntil(resendAvailableAt, at) };
}

/**
 * Re-project the countdown, optionally folding in a deadline read from
 * the tab-wide clock — another dialog instance in this tab can have
 * armed a longer one since this reducer last saw it, and the number the
 * user reads has to be the one that will actually be enforced. Monotonic
 * like the clock itself, and identity-stable so idle ticks cost no
 * render.
 */
function refreshCooldown(state: AuthFlowState, now: number, deadline = 0): AuthFlowState {
  const resendAvailableAt = Math.max(state.resendAvailableAt, deadline);
  const resendSeconds = secondsUntil(resendAvailableAt, now);
  return resendSeconds === state.resendSeconds && resendAvailableAt === state.resendAvailableAt
    ? state
    : { ...state, resendAvailableAt, resendSeconds };
}

/**
 * Where a successful login lands. Existing users are done immediately —
 * onboarding is only ever shown to accounts Java just created.
 *
 * A reset is never one of those: you cannot forget the password of an
 * account that did not exist a moment ago. So the mode overrides
 * `isNewUser` outright rather than trusting a field the reset endpoint
 * has no reason to set correctly.
 */
export function stepAfterLogin(
  session: AuthSession,
  steps: AuthStepConfig,
  mode: AuthMode = "signin"
): AuthStep {
  if (mode === "reset" || !session.isNewUser) return "done";
  if (steps.profile) return "profile";
  if (steps.invite) return "invite";
  return "done";
}

/** Digits only, capped — paste of "  123 456 " must land as "123456". */
export function sanitizeCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

/**
 * Validate the identifier field on submit. Returns the wire value or the
 * error code to show; never throws.
 */
export function validateIdentifier(
  raw: string
): { ok: true; value: NormalizedIdentifier } | { ok: false; error: AuthError } {
  if (!raw.trim()) return { ok: false, error: authError("identifier_required") };
  const value = normalizeIdentifier(raw);
  return value ? { ok: true, value } : { ok: false, error: authError("identifier_invalid") };
}

/**
 * Whether a validated identifier addresses the live code — the same
 * account AND the same mode that issued it. The cooldown gate uses this
 * to tell "let me back onto the code screen" apart from "send a code
 * somewhere else".
 *
 * The mode half is not a detail. `start_reset` carries the identifier
 * over from the password step and keeps `codeSent`, so on account alone
 * a sign-in code answered the reset flow's Continue: the user was put on
 * the code step with no reset code ever sent, typed the SMS they did
 * have, and Java rejected it a screen later — with the resend still on
 * cooldown. A mismatch is a genuine second send, and is refused as one.
 */
export function addressesSentAccount(state: AuthFlowState, value: NormalizedIdentifier): boolean {
  return (
    state.codeSent &&
    state.sentMode === state.mode &&
    state.account !== null &&
    sameAccount(state.account, value)
  );
}

/**
 * Whether pressing Continue on the identifier step right now resumes the
 * live code instead of spending a send.
 *
 * The identifier step shows the cooldown, because Continue is a send and
 * the user deserves to know before they press it. But re-submitting the
 * identifier the live code went to costs nothing — so showing a
 * countdown there tells the user to wait for something they do not have
 * to wait for, which is the one thing a countdown must never do.
 */
export function resumesSentCode(state: AuthFlowState): boolean {
  const result = validateIdentifier(state.identifier);
  return result.ok && addressesSentAccount(state, result.value);
}

// ── Selectors ───────────────────────────────────────────────────────────
// Every disabled/enabled decision in the UI reads one of these, so the two
// apps cannot drift on when a button is live.

export function canSubmitIdentifier(state: AuthFlowState): boolean {
  return !state.pending && state.identifier.trim().length > 0;
}

export function canSubmitCode(state: AuthFlowState): boolean {
  return !state.pending && state.code.length === CODE_LENGTH;
}

export function canResendCode(state: AuthFlowState): boolean {
  return !state.pending && state.resendSeconds === 0 && state.account !== null;
}

export function canSubmitPassword(state: AuthFlowState): boolean {
  return !state.pending && state.identifier.trim().length > 0 && state.password.length > 0;
}

/** The reset flow's final step: two matching passwords, long enough. */
export function canSubmitNewPassword(state: AuthFlowState): boolean {
  return (
    !state.pending &&
    state.account !== null &&
    state.code.length === CODE_LENGTH &&
    state.newPassword.length >= MIN_PASSWORD_LENGTH &&
    state.newPassword === state.confirmPassword
  );
}

export function canSubmitProfile(state: AuthFlowState): boolean {
  return !state.pending && !state.uploadingAvatar && state.nickname.trim().length > 0;
}

export function canSubmitInvite(state: AuthFlowState): boolean {
  return !state.pending && state.inviteCode.trim().length > 0;
}

/**
 * Whether the dialog may be dismissed. Closing mid-request would leave a
 * half-applied session; closing during onboarding is fine — the account
 * already exists and both remaining steps are skippable. What that
 * dismiss MEANS depends on `isSessionEstablished`.
 */
export function canDismiss(state: AuthFlowState): boolean {
  return !state.pending && !state.uploadingAvatar;
}

/**
 * True once `login` has returned and the satoken cookie is written — i.e.
 * from `profile` onward. The host app must be told about that session on
 * EVERY exit from here, including a dismiss, which is why the dialog
 * routes a dismiss through the `dismissed` event instead of just closing.
 */
export function isSessionEstablished(state: AuthFlowState): boolean {
  return state.session !== null;
}

/** Every step the back arrow can undo. */
export function canGoBack(state: AuthFlowState): boolean {
  if (state.pending) return false;
  if (state.step === "code" || state.step === "password" || state.step === "reset_password") {
    return true;
  }
  // In reset mode the identifier step has somewhere to go back TO: the
  // password entry it was opened from.
  return state.mode === "reset" && state.step === "identifier";
}
