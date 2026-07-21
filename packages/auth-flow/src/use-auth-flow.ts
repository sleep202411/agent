"use client";

/**
 * React driver for the pure machine in `machine.ts`: owns the async calls,
 * the one-second resend timer, and the guards that keep a double-tap or a
 * stale closure from firing two logins.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { AuthClient, toAuthError } from "./client";
import { authError, type AuthError } from "./errors";
import { clearPendingCode, readPendingCode, writePendingCode } from "./pending-code";
import { armResendDeadline, readResendDeadline, secondsUntil } from "./resend-clock";
import { clearSessionCookie } from "./session";
import type { AuthTransport } from "./transport";
import type { AuthMode, AuthSession } from "./types";
import {
  addressesSentAccount,
  authFlowReducer,
  canDismiss,
  canGoBack,
  canResendCode,
  canSubmitCode,
  canSubmitIdentifier,
  canSubmitInvite,
  canSubmitNewPassword,
  canSubmitPassword,
  canSubmitProfile,
  createInitialState,
  sanitizeCode,
  CODE_LENGTH,
  MIN_PASSWORD_LENGTH,
  validateIdentifier,
  type AuthFlowEvent,
  type AuthFlowState,
  type AuthStepConfig,
} from "./machine";

/** How the session was obtained. `reset` also ends signed in. */
export type AuthMethod = "code" | "password" | "reset";

/** Emitted so each app can do its own analytics (web: PostHog + Axon). */
export type AuthFlowAnalytics =
  | { type: "code_sent"; kind: "phone" | "email" }
  | { type: "signed_in"; session: AuthSession; method: AuthMethod }
  | { type: "registered"; session: AuthSession }
  | { type: "password_reset"; session: AuthSession }
  | { type: "profile_saved" }
  | { type: "invite_bound"; code: string }
  | { type: "step_skipped"; step: "profile" | "invite" };

export interface UseAuthFlowOptions {
  transport: AuthTransport;
  onSuccess: (session: AuthSession) => void;
  steps?: Partial<AuthStepConfig>;
  /** Open straight into the reset flow — `/forgot-password` does. */
  initialMode?: AuthMode;
  resendCooldown?: number;
  initialIdentifier?: string;
  initialInviteCode?: string;
  /**
   * Optional probe that confirms the browser really carries the new
   * session (studio hits `/aurora/users/me`). When it answers false the
   * flow stays open with an actionable error instead of closing on a
   * still-signed-out user — a cookie-scope regression must not look like
   * a success.
   */
  verifySession?: () => Promise<boolean>;
  onEvent?: (event: AuthFlowAnalytics) => void;
  /** Dialog visibility: drives the countdown timer and the reset. */
  active?: boolean;
}

export interface AuthFlowActions {
  setIdentifier: (value: string) => void;
  submitIdentifier: () => void;
  setCode: (value: string) => void;
  submitCode: () => void;
  resendCode: () => void;
  usePassword: () => void;
  useCode: () => void;
  /** Enter the reset flow. Offered ONLY from the password step. */
  startReset: () => void;
  cancelReset: () => void;
  back: () => void;
  setPassword: (value: string) => void;
  submitPassword: () => void;
  setNewPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
  submitNewPassword: () => void;
  setNickname: (value: string) => void;
  uploadAvatar: (file: File) => void;
  submitProfile: () => void;
  skipProfile: () => void;
  setInviteCode: (value: string) => void;
  submitInvite: () => void;
  skipInvite: () => void;
  /**
   * The user closed the dialog. Only meaningful once a session exists —
   * see the `dismissed` case in the reducer; the host closes the dialog
   * itself when there is nothing to keep.
   */
  dismiss: () => void;
  reset: () => void;
}

export interface AuthFlowController {
  state: AuthFlowState;
  actions: AuthFlowActions;
  can: {
    submitIdentifier: boolean;
    submitCode: boolean;
    resendCode: boolean;
    submitPassword: boolean;
    submitNewPassword: boolean;
    submitProfile: boolean;
    submitInvite: boolean;
    dismiss: boolean;
    goBack: boolean;
  };
}

export function useAuthFlow(options: UseAuthFlowOptions): AuthFlowController {
  const {
    transport,
    onSuccess,
    steps,
    initialMode,
    resendCooldown,
    initialIdentifier,
    initialInviteCode,
    verifySession,
    onEvent,
    active = true,
  } = options;

  const [state, dispatch] = useReducer(
    authFlowReducer,
    {
      mode: initialMode,
      steps,
      resendCooldown,
      identifier: initialIdentifier,
      inviteCode: initialInviteCode,
      // A cooldown armed by an earlier mount of this dialog is still
      // running; inheriting it is what makes close-and-reopen useless as
      // a way to skip it.
      resendAvailableAt: readResendDeadline(),
      // And an outstanding code from that mount is still enterable, so
      // this remount opens on the code step rather than behind a
      // countdown the user cannot do anything about.
      resumeCode: readPendingCode(),
    },
    createInitialState
  );

  const client = useMemo(() => new AuthClient(transport), [transport]);

  // Latest-value refs: every async callback below runs after an await, so
  // reading `state` directly would act on a snapshot from before the call.
  const stateRef = useRef(state);
  stateRef.current = state;
  const inFlight = useRef(false);
  const notified = useRef(false);
  const modeRef = useRef(state.mode);
  modeRef.current = state.mode;
  const callbacks = useRef({ onSuccess, onEvent, verifySession });
  callbacks.current = { onSuccess, onEvent, verifySession };

  // Resend countdown. One interval for the whole flow, torn down when the
  // dialog closes so a background tab is not ticking forever. Each tick
  // carries the wall clock rather than decrementing, so a throttled
  // background tab resumes with the truth instead of a stale count.
  useEffect(() => {
    if (!active || state.resendSeconds <= 0) return;
    const timer = setInterval(
      // The clock rides along: it is the deadline that will actually be
      // enforced, and this reducer's copy can only be behind it.
      () => dispatch({ type: "tick", now: Date.now(), resendAvailableAt: readResendDeadline() }),
      1000
    );
    return () => clearInterval(timer);
  }, [active, state.resendSeconds > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Terminal state → hand the session to the host app exactly once.
  //
  // Every exit after a successful login funnels through `step === "done"`
  // — finishing the last step, skipping it, or dismissing the dialog (see
  // the `dismissed` case in the reducer) — so this is the ONE place the
  // host learns it has a session, and the `notified` latch makes it fire
  // once per open. `state.session` guards the other direction: it is null
  // until `client.login` has written the cookie, so `onSuccess` can never
  // run for a user who is not actually signed in.
  useEffect(() => {
    if (state.step !== "done" || !state.session || notified.current) return;
    notified.current = true;
    callbacks.current.onSuccess(state.session);
  }, [state.step, state.session]);

  /**
   * Wipe the flow back to its opening state.
   *
   * The `notified` latch is part of that state: leaving it armed makes a
   * reused dialog instance permanently unable to report its NEXT
   * sign-in, which looks like "the app forgot I logged in" and is
   * invisible until someone signs in twice without a reload.
   */
  const resetFlow = useCallback(() => {
    notified.current = false;
    inFlight.current = false;
    dispatch({
      type: "reset",
      now: Date.now(),
      mode: modeRef.current,
      resendAvailableAt: readResendDeadline(),
      resumeCode: readPendingCode(),
    });
  }, []);

  /**
   * A reopened dialog starts clean; a half-typed phone number from a
   * dismissed attempt is never what the next visitor wants. What
   * survives is what the same visitor is still owed: the resend deadline
   * and an outstanding code (see `machine.ts`'s `reset`).
   *
   * It runs on the CLOSING edge only. Firing on mount-while-closed threw
   * away `initialIdentifier` / `initialInviteCode` for every dialog that
   * is rendered before it is opened — which is every app-wide provider,
   * and the invite code is how referral attribution reaches the invite
   * step.
   */
  const wasActive = useRef(active);
  useEffect(() => {
    const closed = wasActive.current && !active;
    wasActive.current = active;
    if (closed) resetFlow();
  }, [active, resetFlow]);

  const run = useCallback(
    async (task: () => Promise<void>, onFailure?: (error: AuthError) => AuthFlowEvent) => {
      if (inFlight.current) return;
      inFlight.current = true;
      dispatch({ type: "request_started" });
      try {
        await task();
      } catch (thrown) {
        const error = toAuthError(thrown);
        dispatch(onFailure ? onFailure(error) : { type: "request_failed", error });
      } finally {
        inFlight.current = false;
      }
    },
    []
  );

  /**
   * The ONLY path to a code send, for both modes and every entry point.
   *
   * `getCode` is unauthenticated and bills a real SMS per call, so the
   * cooldown is enforced HERE rather than on the resend button: going
   * back, editing the identifier and pressing Continue used to walk
   * straight past a button-level guard.
   */
  const sendCode = useCallback(() => {
    const current = stateRef.current;
    const result = validateIdentifier(current.identifier);
    if (!result.ok) {
      dispatch({ type: "request_failed", error: result.error });
      return;
    }
    const now = Date.now();
    // The tab-wide clock, not this reducer's copy of it: another mount of
    // the dialog can have armed the deadline since this state was built,
    // and a snapshot that predates it would wave a billable send through.
    // The clock is monotonic, so it is never the weaker of the two.
    const deadline = Math.max(current.resendAvailableAt, readResendDeadline());
    if (secondsUntil(deadline, now) > 0) {
      // Re-submitting the identifier a live code was sent to needs no
      // send at all — that is the common "wait, let me check it again"
      // path, and it stays instant. A DIFFERENT identifier, or the same
      // one in the other mode, would need a second SMS, which is exactly
      // what the cooldown is refusing.
      dispatch(
        addressesSentAccount(current, result.value)
          ? { type: "resume_code" }
          : { type: "request_failed", error: authError("resend_cooldown") }
      );
      // Re-project the countdown so the number next to the refusal is
      // the current one, not whatever the last tick left behind.
      dispatch({ type: "tick", now, resendAvailableAt: deadline });
      return;
    }
    const mode = current.mode;
    void run(async () => {
      if (mode === "reset") await client.sendResetCode(result.value);
      else await client.sendCode(result.value);
      const at = Date.now();
      // Arm the tab-wide deadline BEFORE the state update: from here on
      // no remount, no mode switch and no reopen can produce a send.
      armResendDeadline(at + current.resendCooldown * 1000);
      // Outlives this mount, so a dialog dismissed while the SMS is in
      // the user's hand reopens on the code step instead of behind a
      // countdown with no way back to it.
      writePendingCode({ account: result.value, mode });
      dispatch({ type: "code_sent", account: result.value, at });
      callbacks.current.onEvent?.({ type: "code_sent", kind: result.value.kind });
    });
  }, [client, run]);

  const finishLogin = useCallback(async (session: AuthSession, method: AuthMethod) => {
    const verify = callbacks.current.verifySession;
    if (verify && !(await verify())) {
      // `AuthClient.login` already wrote the session cookie — it has to,
      // Java's own `Set-Cookie` is wrong off `.com` (see `session.ts`).
      // The probe just said the browser is not carrying a usable session,
      // so leaving that cookie behind would have the rest of the app
      // render a signed-in shell around a dialog telling the user they
      // are not signed in, and the next `/me` would keep re-reading a
      // token the server does not honour. Undo the write so the failure
      // and the browser tell the same story.
      clearSessionCookie(session.token.name);
      dispatch({ type: "request_failed", error: authError("session_unverified") });
      return;
    }
    // The code (if any) has been spent; nothing left to resume.
    clearPendingCode();
    dispatch({ type: "logged_in", session });
    callbacks.current.onEvent?.({ type: "signed_in", session, method });
    if (session.isNewUser) callbacks.current.onEvent?.({ type: "registered", session });
    if (method === "reset") callbacks.current.onEvent?.({ type: "password_reset", session });
  }, []);

  const submitCodeValue = useCallback(
    (code: string) => {
      const { account, mode } = stateRef.current;
      if (!account) return;
      if (code.length !== CODE_LENGTH) {
        dispatch({ type: "request_failed", error: authError("code_required") });
        return;
      }
      if (mode === "reset") {
        // Java checks this code as part of the reset call; there is no
        // endpoint that checks it alone, so this only moves the screen on.
        dispatch({ type: "code_confirmed" });
        return;
      }
      void run(async () => {
        const session = await client.loginWithCode(account, code);
        await finishLogin(session, "code");
      });
    },
    [client, finishLogin, run]
  );

  const actions = useMemo<AuthFlowActions>(
    () => ({
      setIdentifier: (value) => dispatch({ type: "identifier_changed", value }),

      submitIdentifier: sendCode,

      setCode: (value) => {
        const code = sanitizeCode(value);
        dispatch({ type: "code_changed", value: code });
        // Auto-submit on the sixth digit — typing or pasting a full code
        // and then hunting for a button is the classic OTP annoyance.
        if (code.length === CODE_LENGTH && !inFlight.current) submitCodeValue(code);
      },

      submitCode: () => submitCodeValue(stateRef.current.code),

      resendCode: () => {
        if (stateRef.current.resendSeconds > 0) return;
        sendCode();
      },

      usePassword: () => dispatch({ type: "use_password" }),
      useCode: () => dispatch({ type: "use_code" }),
      startReset: () => dispatch({ type: "start_reset" }),
      cancelReset: () => dispatch({ type: "cancel_reset" }),
      back: () => dispatch({ type: "back" }),

      setPassword: (value) => dispatch({ type: "password_changed", value }),

      submitPassword: () => {
        const result = validateIdentifier(stateRef.current.identifier);
        if (!result.ok) {
          dispatch({ type: "request_failed", error: result.error });
          return;
        }
        const password = stateRef.current.password;
        if (!password) {
          dispatch({ type: "request_failed", error: authError("password_required") });
          return;
        }
        void run(async () => {
          const session = await client.loginWithPassword(result.value, password);
          await finishLogin(session, "password");
        });
      },

      setNewPassword: (value) => dispatch({ type: "new_password_changed", value }),
      setConfirmPassword: (value) => dispatch({ type: "confirm_password_changed", value }),

      submitNewPassword: () => {
        const { account, code, newPassword, confirmPassword } = stateRef.current;
        if (!account) return;
        if (code.length !== CODE_LENGTH) {
          dispatch({ type: "request_failed", error: authError("code_required"), step: "code" });
          return;
        }
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
          dispatch({ type: "request_failed", error: authError("password_too_short") });
          return;
        }
        if (newPassword !== confirmPassword) {
          dispatch({ type: "request_failed", error: authError("password_mismatch") });
          return;
        }
        void run(
          async () => {
            const session = await client.resetPassword(account, code, newPassword);
            await finishLogin(session, "reset");
          },
          // The code is only checked now, one screen after it was typed.
          // Report that where it can be fixed.
          (error) =>
            error.code === "code_incorrect" || error.code === "code_expired"
              ? { type: "request_failed", error, step: "code" }
              : { type: "request_failed", error }
        );
      },

      setNickname: (value) => dispatch({ type: "nickname_changed", value }),

      uploadAvatar: (file) => {
        if (!file.type.startsWith("image/")) {
          dispatch({ type: "avatar_upload_failed", error: authError("avatar_not_an_image") });
          return;
        }
        dispatch({ type: "avatar_upload_started" });
        void (async () => {
          try {
            const path = await client.uploadAvatar(file);
            dispatch({ type: "avatar_uploaded", path });
          } catch (thrown) {
            dispatch({ type: "avatar_upload_failed", error: toAuthError(thrown) });
          }
        })();
      },

      submitProfile: () => {
        const nickname = stateRef.current.nickname.trim();
        if (!nickname) {
          dispatch({ type: "request_failed", error: authError("nickname_required") });
          return;
        }
        void run(async () => {
          await client.saveProfile({ nickName: nickname });
          dispatch({ type: "profile_finished" });
          callbacks.current.onEvent?.({ type: "profile_saved" });
        });
      },

      skipProfile: () => {
        dispatch({ type: "profile_finished" });
        callbacks.current.onEvent?.({ type: "step_skipped", step: "profile" });
      },

      setInviteCode: (value) => dispatch({ type: "invite_changed", value }),

      submitInvite: () => {
        const code = stateRef.current.inviteCode.trim();
        if (!code) {
          dispatch({ type: "request_failed", error: authError("invite_code_required") });
          return;
        }
        void run(async () => {
          await client.bindInviteCode(code);
          dispatch({ type: "invite_finished" });
          callbacks.current.onEvent?.({ type: "invite_bound", code });
        });
      },

      skipInvite: () => {
        dispatch({ type: "invite_finished" });
        callbacks.current.onEvent?.({ type: "step_skipped", step: "invite" });
      },

      dismiss: () => {
        const { step, session } = stateRef.current;
        if (!session) return;
        // Same analytics as the explicit "skip" button: from the product's
        // point of view closing the dialog on an onboarding step IS a skip.
        if (step === "profile" || step === "invite") {
          callbacks.current.onEvent?.({ type: "step_skipped", step });
        }
        dispatch({ type: "dismissed" });
      },

      reset: resetFlow,
    }),
    [client, finishLogin, resetFlow, run, sendCode, submitCodeValue]
  );

  return {
    state,
    actions,
    can: {
      submitIdentifier: canSubmitIdentifier(state),
      submitCode: canSubmitCode(state),
      resendCode: canResendCode(state),
      submitPassword: canSubmitPassword(state),
      submitNewPassword: canSubmitNewPassword(state),
      submitProfile: canSubmitProfile(state),
      submitInvite: canSubmitInvite(state),
      dismiss: canDismiss(state),
      goBack: canGoBack(state),
    },
  };
}
