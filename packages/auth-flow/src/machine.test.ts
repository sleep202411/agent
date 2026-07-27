import { describe, expect, it } from "vitest";

import { authError } from "./errors";
import {
  addressesSentAccount,
  authFlowReducer,
  canDismiss,
  canGoBack,
  canResendCode,
  canSubmitCode,
  canSubmitIdentifier,
  canSubmitNewPassword,
  createInitialState,
  isSessionEstablished,
  resumesSentCode,
  sanitizeCode,
  stepAfterLogin,
  validateIdentifier,
  type AuthFlowEvent,
  type AuthFlowState,
} from "./machine";
import type { AuthSession, NormalizedIdentifier } from "./types";

const ACCOUNT: NormalizedIdentifier = { kind: "phone", account: "13800138000" };
const OTHER: NormalizedIdentifier = { kind: "email", account: "someone@example.com" };

/** A fixed wall clock: every event that reads time now carries it. */
const T0 = 1_700_000_000_000;
const at = (seconds: number) => T0 + seconds * 1000;

function session(isNewUser: boolean): AuthSession {
  return {
    token: { name: "satoken", value: "abc" },
    isNewUser,
    userId: "1",
    identifier: ACCOUNT,
  };
}

function reduce(state: AuthFlowState, ...events: AuthFlowEvent[]): AuthFlowState {
  return events.reduce(authFlowReducer, state);
}

function initial(options?: Parameters<typeof createInitialState>[0]): AuthFlowState {
  return createInitialState({ now: T0, ...options });
}

const codeSent = (when = T0): AuthFlowEvent => ({ type: "code_sent", account: ACCOUNT, at: when });

describe("step transitions", () => {
  it("sends a code and lands on the code step with the cooldown armed", () => {
    const state = reduce(
      initial(),
      { type: "identifier_changed", value: "138 0013 8000" },
      { type: "request_started" },
      codeSent()
    );
    expect(state.step).toBe("code");
    expect(state.account).toEqual(ACCOUNT);
    expect(state.pending).toBe(false);
    expect(state.codeSent).toBe(true);
    expect(state.resendSeconds).toBe(60);
    expect(state.resendAvailableAt).toBe(at(60));
  });

  it("clears stale digits on every send so a dead code cannot auto-submit", () => {
    const state = reduce(
      initial(),
      codeSent(),
      { type: "code_changed", value: "123456" },
      codeSent(at(60))
    );
    expect(state.code).toBe("");
  });

  it("routes an existing user straight out of the flow", () => {
    const state = reduce(initial(), { type: "logged_in", session: session(false) });
    expect(state.step).toBe("done");
  });

  it("routes a brand-new user through profile then invite", () => {
    const afterLogin = reduce(initial(), { type: "logged_in", session: session(true) });
    expect(afterLogin.step).toBe("profile");
    expect(reduce(afterLogin, { type: "profile_finished" }).step).toBe("invite");
    expect(reduce(afterLogin, { type: "profile_finished" }, { type: "invite_finished" }).step).toBe(
      "done"
    );
  });

  it("honours a per-app step opt-out", () => {
    const noProfile = initial({ steps: { profile: false } });
    expect(reduce(noProfile, { type: "logged_in", session: session(true) }).step).toBe("invite");

    const neither = initial({ steps: { profile: false, invite: false } });
    expect(reduce(neither, { type: "logged_in", session: session(true) }).step).toBe("done");

    const noInvite = initial({ steps: { invite: false } });
    expect(
      reduce(noInvite, { type: "logged_in", session: session(true) }, { type: "profile_finished" })
        .step
    ).toBe("done");
  });

  it("stepAfterLogin is the single source of that routing", () => {
    expect(stepAfterLogin(session(false), { profile: true, invite: true })).toBe("done");
    expect(stepAfterLogin(session(true), { profile: true, invite: true })).toBe("profile");
    expect(stepAfterLogin(session(true), { profile: false, invite: true })).toBe("invite");
    expect(stepAfterLogin(session(true), { profile: false, invite: false })).toBe("done");
  });

  it("moves a failure to the step where it can be fixed, when asked", () => {
    const onReset = reduce(
      initial({ mode: "reset" }),
      codeSent(),
      { type: "code_changed", value: "123456" },
      { type: "code_confirmed" }
    );
    expect(onReset.step).toBe("reset_password");
    const bounced = reduce(onReset, {
      type: "request_failed",
      error: authError("code_expired", "验证码已过期"),
      step: "code",
    });
    expect(bounced.step).toBe("code");
    expect(bounced.error?.code).toBe("code_expired");
  });
});

describe("dismissing a live session", () => {
  const onboarding = reduce(initial(), { type: "logged_in", session: session(true) });

  it("treats a dismiss on profile as skipping the rest of onboarding", () => {
    const state = reduce(onboarding, { type: "dismissed" });
    expect(state.step).toBe("done");
    // The whole point: the session survives to the terminal step, which is
    // what the host app reads to learn it has a signed-in user.
    expect(state.session).toEqual(session(true));
  });

  it("skips straight past the invite step, not into it", () => {
    expect(reduce(onboarding, { type: "profile_finished" }).step).toBe("invite");
    expect(reduce(onboarding, { type: "dismissed" }).step).toBe("done");
  });

  it("also terminates a dismiss on the invite step", () => {
    const onInvite = reduce(onboarding, { type: "profile_finished" });
    expect(onInvite.step).toBe("invite");
    expect(reduce(onInvite, { type: "dismissed" }).step).toBe("done");
  });

  it("is a no-op before a session exists, on every pre-login step", () => {
    const beforeLogin = [
      initial(),
      reduce(initial(), codeSent()),
      reduce(initial(), { type: "use_password" }),
    ];
    for (const state of beforeLogin) {
      expect(isSessionEstablished(state)).toBe(false);
      // Same object back: nothing to hand the host, so the dialog just closes.
      expect(authFlowReducer(state, { type: "dismissed" })).toBe(state);
    }
  });

  it("marks the session as established exactly from the login onward", () => {
    expect(isSessionEstablished(initial())).toBe(false);
    expect(isSessionEstablished(onboarding)).toBe(true);
    expect(
      isSessionEstablished(reduce(initial(), { type: "logged_in", session: session(false) }))
    ).toBe(true);
  });
});

describe("back navigation", () => {
  it("returns from code to identifier, dropping the typed code", () => {
    const state = reduce(
      initial(),
      codeSent(),
      { type: "code_changed", value: "1234" },
      { type: "back" }
    );
    expect(state.step).toBe("identifier");
    expect(state.code).toBe("");
  });

  it("is a no-op on the onboarding steps", () => {
    const profile = reduce(initial(), { type: "logged_in", session: session(true) });
    expect(reduce(profile, { type: "back" }).step).toBe("profile");
  });

  it("switches between the code path and the password path", () => {
    const password = reduce(initial(), { type: "use_password" });
    expect(password.step).toBe("password");
    const backToCode = reduce(
      password,
      { type: "password_changed", value: "x" },
      { type: "use_code" }
    );
    expect(backToCode.step).toBe("identifier");
    expect(backToCode.password).toBe("");
  });

  it("walks the reset flow backwards one screen at a time", () => {
    const onNewPassword = reduce(
      initial(),
      { type: "use_password" },
      { type: "start_reset" },
      codeSent(),
      { type: "code_changed", value: "123456" },
      { type: "code_confirmed" }
    );
    expect(onNewPassword.step).toBe("reset_password");

    const onCode = reduce(
      onNewPassword,
      { type: "new_password_changed", value: "x" },
      {
        type: "back",
      }
    );
    // The code survives — they came back to re-read it, not to retype it.
    expect(onCode).toMatchObject({ step: "code", code: "123456", newPassword: "" });

    const onIdentifier = reduce(onCode, { type: "back" });
    expect(onIdentifier).toMatchObject({ step: "identifier", mode: "reset" });

    // One more lands back where the reset was entered from.
    expect(reduce(onIdentifier, { type: "back" })).toMatchObject({
      step: "password",
      mode: "signin",
    });
  });

  it("offers back on every step that has somewhere to go", () => {
    expect(canGoBack(initial())).toBe(false);
    expect(canGoBack(reduce(initial(), codeSent()))).toBe(true);
    expect(canGoBack(reduce(initial(), { type: "use_password" }))).toBe(true);
    // Reset mode's identifier step goes back to the password entry.
    expect(canGoBack(initial({ mode: "reset" }))).toBe(true);
    expect(canGoBack({ ...initial(), pending: true, step: "code" })).toBe(false);
  });
});

describe("resend cooldown", () => {
  it("ticks down from the deadline, not by decrementing", () => {
    let state = reduce(initial({ resendCooldown: 3 }), codeSent());
    expect(state.resendSeconds).toBe(3);
    state = reduce(state, { type: "tick", now: at(1) });
    expect(state.resendSeconds).toBe(2);
    // A throttled background tab that misses ticks still resumes truthful.
    state = reduce(state, { type: "tick", now: at(3) });
    expect(state.resendSeconds).toBe(0);
    expect(reduce(state, { type: "tick", now: at(9) }).resendSeconds).toBe(0);
  });

  it("returns the same object once it has bottomed out (no wasted renders)", () => {
    const state = initial();
    expect(authFlowReducer(state, { type: "tick", now: at(5) })).toBe(state);
  });

  it("re-arms on resend", () => {
    const state = reduce(
      initial({ resendCooldown: 2 }),
      codeSent(),
      { type: "tick", now: at(2) },
      codeSent(at(2))
    );
    expect(state.resendSeconds).toBe(2);
    expect(state.resendAvailableAt).toBe(at(4));
  });

  it("never shortens a longer deadline it inherited", () => {
    // Seeded from a clock that is still 120s out; this app's own cooldown
    // is 60s, and a send must not pull the deadline back in.
    const state = reduce(initial({ resendCooldown: 60, resendAvailableAt: at(120) }), codeSent());
    expect(state.resendAvailableAt).toBe(at(120));
    expect(state.resendSeconds).toBe(120);
  });

  // ── The bypasses. Each of these used to produce a fresh, billable SMS.
  it("survives going back to edit the identifier", () => {
    const state = reduce(initial(), codeSent(), { type: "tick", now: at(1) }, { type: "back" });
    expect(state.step).toBe("identifier");
    expect(state.resendSeconds).toBe(59);
    expect(state.resendAvailableAt).toBe(at(60));
  });

  it("survives switching to the password entry and back to the code entry", () => {
    const state = reduce(
      initial(),
      codeSent(),
      { type: "back" },
      { type: "use_password" },
      { type: "use_code" },
      { type: "tick", now: at(10) }
    );
    expect(state.step).toBe("identifier");
    expect(state.resendSeconds).toBe(50);
  });

  it("survives entering the reset flow — a reset code costs the same SMS", () => {
    const state = reduce(
      initial(),
      codeSent(),
      { type: "back" },
      { type: "use_password" },
      { type: "start_reset" },
      { type: "tick", now: at(10) }
    );
    expect(state.mode).toBe("reset");
    expect(state.resendSeconds).toBe(50);
  });

  it("survives closing and reopening the dialog inside the window", () => {
    const dirty = reduce(initial(), { type: "identifier_changed", value: "x" }, codeSent());
    const reopened = authFlowReducer(dirty, { type: "reset", now: at(15) });
    expect(reopened.identifier).toBe("");
    expect(reopened.account).toBeNull();
    expect(reopened.resendAvailableAt).toBe(at(60));
    expect(reopened.resendSeconds).toBe(45);
  });

  it("seeds a fresh machine from a deadline an earlier mount armed", () => {
    const state = createInitialState({ resendAvailableAt: at(60), now: at(20) });
    expect(state.resendSeconds).toBe(40);
    expect(canResendCode({ ...state, account: ACCOUNT })).toBe(false);
  });

  it("tells a re-submitted identifier apart from a new one", () => {
    const onCode = reduce(initial(), codeSent());
    expect(addressesSentAccount(onCode, ACCOUNT)).toBe(true);
    expect(addressesSentAccount(onCode, OTHER)).toBe(false);
    // Nothing sent yet: every identifier is "new", so every send is real.
    expect(addressesSentAccount(initial(), ACCOUNT)).toBe(false);
  });

  it("puts the user back on the code step without a send", () => {
    const state = reduce(initial(), codeSent(), { type: "back" }, { type: "resume_code" });
    expect(state.step).toBe("code");
    expect(state.resendAvailableAt).toBe(at(60));
  });

  it("refuses to resume when nothing was ever sent", () => {
    const state = initial();
    expect(authFlowReducer(state, { type: "resume_code" })).toBe(state);
  });

  it("folds in a longer deadline another instance armed, on tick", () => {
    // The tab-wide clock is monotonic; this reducer's copy can only lag
    // it, and the countdown the user reads has to be the enforced one.
    const state = reduce(initial(), codeSent());
    const synced = authFlowReducer(state, { type: "tick", now: T0, resendAvailableAt: at(120) });
    expect(synced.resendAvailableAt).toBe(at(120));
    expect(synced.resendSeconds).toBe(120);
    // And never the other way round.
    expect(
      authFlowReducer(synced, { type: "tick", now: T0, resendAvailableAt: at(5) }).resendAvailableAt
    ).toBe(at(120));
  });
});

describe("a code is bound to the mode that issued it", () => {
  it("records which flow sent it", () => {
    expect(initial().sentMode).toBeNull();
    expect(reduce(initial(), codeSent()).sentMode).toBe("signin");
    expect(reduce(initial({ mode: "reset" }), codeSent()).sentMode).toBe("reset");
  });

  it("refuses to answer the reset flow with a sign-in code", () => {
    // The reachable path: Continue on the code flow, back, "use
    // password", "forgot password?" — which keeps the identifier AND the
    // sent code while flipping the mode.
    const inReset = reduce(
      initial(),
      { type: "identifier_changed", value: "13800138000" },
      codeSent(),
      { type: "back" },
      { type: "use_password" },
      { type: "start_reset" }
    );
    expect(inReset).toMatchObject({ mode: "reset", sentMode: "signin", codeSent: true });
    // Java scopes a reset code to the reset call, so this identifier does
    // NOT address a code the reset flow can spend — it needs its own.
    expect(addressesSentAccount(inReset, ACCOUNT)).toBe(false);
    expect(resumesSentCode(inReset)).toBe(false);
    // And the reducer will not be talked onto the code step either.
    expect(authFlowReducer(inReset, { type: "resume_code" })).toBe(inReset);
  });

  it("refuses the mirror case too", () => {
    const inSignin = reduce(
      initial({ mode: "reset" }),
      { type: "identifier_changed", value: "13800138000" },
      codeSent(),
      { type: "back" },
      { type: "back" },
      { type: "use_code" }
    );
    expect(inSignin).toMatchObject({ mode: "signin", sentMode: "reset" });
    expect(addressesSentAccount(inSignin, ACCOUNT)).toBe(false);
  });

  it("still resumes within one mode", () => {
    const inReset = reduce(
      initial({ mode: "reset" }),
      { type: "identifier_changed", value: "13800138000" },
      codeSent(),
      { type: "back" }
    );
    expect(addressesSentAccount(inReset, ACCOUNT)).toBe(true);
    expect(authFlowReducer(inReset, { type: "resume_code" }).step).toBe("code");
  });
});

describe("the identifier step's countdown", () => {
  const onIdentifier = reduce(
    initial(),
    { type: "identifier_changed", value: "13800138000" },
    codeSent(),
    { type: "back" }
  );

  it("stays quiet when Continue would resume instead of send", () => {
    expect(onIdentifier.resendSeconds).toBe(60);
    expect(resumesSentCode(onIdentifier)).toBe(true);
  });

  it("speaks up as soon as the field addresses a second SMS", () => {
    const edited = reduce(onIdentifier, {
      type: "identifier_changed",
      value: "someone@example.com",
    });
    expect(resumesSentCode(edited)).toBe(false);
  });

  it("is not fooled by an unusable field", () => {
    expect(resumesSentCode(reduce(onIdentifier, { type: "identifier_changed", value: "" }))).toBe(
      false
    );
    expect(
      resumesSentCode(reduce(onIdentifier, { type: "identifier_changed", value: "nope" }))
    ).toBe(false);
  });
});

describe("resuming a dismissed code session", () => {
  const pending = { account: ACCOUNT, mode: "signin" } as const;

  it("opens on the code step, on the account the code went to", () => {
    const state = createInitialState({ now: T0, resumeCode: pending, resendAvailableAt: at(60) });
    expect(state).toMatchObject({
      step: "code",
      account: ACCOUNT,
      identifier: ACCOUNT.account,
      codeSent: true,
      sentMode: "signin",
      code: "",
    });
    // Which makes it a real resume: back goes to the identifier field
    // holding what the code was sent to, and resend is on the clock.
    expect(canGoBack(state)).toBe(true);
    expect(canResendCode(state)).toBe(false);
  });

  it("ignores a code the opening mode cannot spend", () => {
    const state = createInitialState({ now: T0, mode: "reset", resumeCode: pending });
    expect(state).toMatchObject({ step: "identifier", account: null, codeSent: false });
  });

  it("adopts the code's own mode when the host did not ask for one", () => {
    // Every reopen mounts as sign-in. Without this a reset code the user
    // dismissed to go read is unreachable from every entry point, and the
    // only way forward is to wait out the cooldown and buy a second SMS.
    const reset = { account: ACCOUNT, mode: "reset" } as const;

    const mounted = createInitialState({ now: T0, resumeCode: reset });
    expect(mounted).toMatchObject({ mode: "reset", step: "code", sentMode: "reset" });

    const reopened = authFlowReducer(initial(), { type: "reset", now: at(15), resumeCode: reset });
    expect(reopened).toMatchObject({ mode: "reset", step: "code" });

    // An explicit request still outranks it — the host asked for sign-in.
    expect(createInitialState({ now: T0, mode: "signin", resumeCode: reset })).toMatchObject({
      mode: "signin",
      step: "identifier",
    });
  });

  it("yields to a prefilled identifier that addresses someone else", () => {
    const other = createInitialState({
      now: T0,
      resumeCode: pending,
      identifier: "someone@example.com",
    });
    expect(other).toMatchObject({ step: "identifier", identifier: "someone@example.com" });

    // The same account typed differently is still the same account.
    const same = createInitialState({
      now: T0,
      resumeCode: pending,
      identifier: "+86 138 0013 8000",
    });
    expect(same.step).toBe("code");
  });

  it("is what a close carries across, and nothing else is", () => {
    const dirty = reduce(
      initial(),
      { type: "identifier_changed", value: "13800138000" },
      codeSent(),
      { type: "code_changed", value: "123456" },
      { type: "nickname_changed", value: "Ada" }
    );
    const reopened = authFlowReducer(dirty, {
      type: "reset",
      now: at(15),
      resumeCode: pending,
    });
    expect(reopened).toMatchObject({
      step: "code",
      account: ACCOUNT,
      // The digits do not survive: they were typed against a code the
      // user may well have re-read since, and a stale six would
      // auto-submit itself the moment the step mounts.
      code: "",
      nickname: "",
      resendSeconds: 45,
    });
  });

  it("opens clean when there is nothing outstanding", () => {
    expect(createInitialState({ now: T0, resumeCode: null })).toMatchObject({
      step: "identifier",
      identifier: "",
      account: null,
      codeSent: false,
      sentMode: null,
    });
  });
});

describe("password reset", () => {
  it("is entered from the password step, keeping the typed identifier", () => {
    const state = reduce(
      initial(),
      { type: "use_password" },
      { type: "identifier_changed", value: "13800138000" },
      { type: "password_changed", value: "whatever" },
      { type: "start_reset" }
    );
    expect(state).toMatchObject({
      mode: "reset",
      step: "identifier",
      identifier: "13800138000",
      password: "",
    });
  });

  it("goes identifier → code → new password → signed in", () => {
    const onCode = reduce(initial({ mode: "reset" }), codeSent());
    expect(onCode.step).toBe("code");

    const typed = reduce(onCode, { type: "code_changed", value: "123456" });
    const onNewPassword = reduce(typed, { type: "code_confirmed" });
    expect(onNewPassword.step).toBe("reset_password");
    // Nothing here claims the code was verified — Java checks it in the
    // same call that stores the password.
    expect(onNewPassword.session).toBeNull();

    const signedIn = reduce(
      onNewPassword,
      { type: "new_password_changed", value: "hunter2" },
      { type: "confirm_password_changed", value: "hunter2" },
      { type: "logged_in", session: session(false) }
    );
    expect(signedIn.step).toBe("done");
    expect(signedIn.session).toEqual(session(false));
    // The chosen password never lingers in memory after it is stored.
    expect(signedIn.newPassword).toBe("");
    expect(signedIn.confirmPassword).toBe("");
  });

  it("refuses to confirm a code outside the reset flow", () => {
    const signin = reduce(initial(), codeSent(), { type: "code_changed", value: "123456" });
    expect(authFlowReducer(signin, { type: "code_confirmed" })).toBe(signin);
  });

  it("gates submit on length, match, and a code to spend", () => {
    const base = reduce(
      initial({ mode: "reset" }),
      codeSent(),
      { type: "code_changed", value: "123456" },
      { type: "code_confirmed" }
    );
    expect(canSubmitNewPassword(base)).toBe(false);

    const short = reduce(
      base,
      { type: "new_password_changed", value: "abc" },
      { type: "confirm_password_changed", value: "abc" }
    );
    expect(canSubmitNewPassword(short)).toBe(false);

    const mismatched = reduce(
      base,
      { type: "new_password_changed", value: "hunter2" },
      { type: "confirm_password_changed", value: "hunter3" }
    );
    expect(canSubmitNewPassword(mismatched)).toBe(false);

    const good = reduce(
      base,
      { type: "new_password_changed", value: "hunter2" },
      { type: "confirm_password_changed", value: "hunter2" }
    );
    expect(canSubmitNewPassword(good)).toBe(true);
    expect(canSubmitNewPassword({ ...good, pending: true })).toBe(false);
    expect(canSubmitNewPassword({ ...good, code: "1234" })).toBe(false);
  });

  it("cancels back to the password entry, dropping the half-typed reset", () => {
    const state = reduce(
      initial(),
      { type: "use_password" },
      { type: "start_reset" },
      codeSent(),
      { type: "code_changed", value: "123456" },
      { type: "code_confirmed" },
      { type: "new_password_changed", value: "hunter2" },
      { type: "cancel_reset" }
    );
    expect(state).toMatchObject({
      mode: "signin",
      step: "password",
      code: "",
      newPassword: "",
      confirmPassword: "",
    });
  });
});

describe("pending + errors", () => {
  it("clears the error when a request starts and restores it on failure", () => {
    const failed = reduce(
      initial(),
      { type: "request_started" },
      { type: "request_failed", error: authError("code_incorrect", "验证码错误") }
    );
    expect(failed.pending).toBe(false);
    expect(failed.error).toEqual({ code: "code_incorrect", serverMessage: "验证码错误" });
    expect(reduce(failed, { type: "request_started" }).error).toBeNull();
  });

  it("clears the error as soon as the user edits the offending field", () => {
    const failed = reduce(initial(), {
      type: "request_failed",
      error: authError("identifier_invalid"),
    });
    expect(reduce(failed, { type: "identifier_changed", value: "1" }).error).toBeNull();
    expect(reduce(failed, { type: "code_changed", value: "1" }).error).toBeNull();
    expect(reduce(failed, { type: "new_password_changed", value: "x" }).error).toBeNull();
    expect(reduce(failed, { type: "confirm_password_changed", value: "x" }).error).toBeNull();
  });

  it("tracks the avatar upload separately from the step request", () => {
    const uploading = reduce(initial(), { type: "avatar_upload_started" });
    expect(uploading.uploadingAvatar).toBe(true);
    expect(uploading.pending).toBe(false);
    const uploaded = reduce(uploading, { type: "avatar_uploaded", path: "avatars/1.png" });
    expect(uploaded).toMatchObject({ uploadingAvatar: false, avatarPath: "avatars/1.png" });
    const failed = reduce(uploading, {
      type: "avatar_upload_failed",
      error: authError("avatar_not_an_image"),
    });
    expect(failed).toMatchObject({ uploadingAvatar: false });
    expect(failed.error?.code).toBe("avatar_not_an_image");
  });
});

describe("reset", () => {
  it("wipes credentials but keeps the app's step + cooldown configuration", () => {
    const dirty = reduce(
      initial({ steps: { invite: false }, resendCooldown: 30 }),
      { type: "identifier_changed", value: "13800138000" },
      codeSent(),
      { type: "code_changed", value: "123456" }
    );
    const clean = authFlowReducer(dirty, { type: "reset", now: at(30) });
    expect(clean).toMatchObject({
      mode: "signin",
      step: "identifier",
      identifier: "",
      code: "",
      account: null,
      session: null,
      resendSeconds: 0,
      resendCooldown: 30,
      steps: { profile: true, invite: false },
    });
  });

  it("reopens in the mode the host mounted the dialog with", () => {
    const dirty = reduce(initial({ mode: "reset" }), { type: "code_changed", value: "12" });
    expect(authFlowReducer(dirty, { type: "reset", now: T0, mode: "reset" }).mode).toBe("reset");
    expect(authFlowReducer(dirty, { type: "reset", now: T0 }).mode).toBe("signin");
  });
});

describe("validation + selectors", () => {
  it("distinguishes empty from malformed", () => {
    expect(validateIdentifier("   ")).toEqual({
      ok: false,
      error: { code: "identifier_required" },
    });
    expect(validateIdentifier("nope")).toEqual({
      ok: false,
      error: { code: "identifier_invalid" },
    });
    expect(validateIdentifier("+86 138 0013 8000")).toEqual({ ok: true, value: ACCOUNT });
  });

  it("sanitizes pasted codes", () => {
    expect(sanitizeCode(" 12 34-56 ")).toBe("123456");
    expect(sanitizeCode("1234567890")).toBe("123456");
    expect(sanitizeCode("abc")).toBe("");
  });

  it("gates the buttons", () => {
    const empty = initial();
    expect(canSubmitIdentifier(empty)).toBe(false);
    expect(canSubmitIdentifier({ ...empty, identifier: " 1 " })).toBe(true);
    expect(canSubmitIdentifier({ ...empty, identifier: "1", pending: true })).toBe(false);

    const onCode = reduce(empty, codeSent());
    expect(canSubmitCode(onCode)).toBe(false);
    expect(canSubmitCode({ ...onCode, code: "123456" })).toBe(true);
    expect(canResendCode(onCode)).toBe(false);
    expect(canResendCode({ ...onCode, resendSeconds: 0 })).toBe(true);
    expect(canGoBack(onCode)).toBe(true);
  });

  it("refuses to dismiss mid-request", () => {
    const state = initial();
    expect(canDismiss(state)).toBe(true);
    expect(canDismiss({ ...state, pending: true })).toBe(false);
    expect(canDismiss({ ...state, uploadingAvatar: true })).toBe(false);
  });
});
