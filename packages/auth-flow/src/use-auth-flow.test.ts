// @vitest-environment jsdom

/**
 * The two contracts the hook owes its hosts.
 *
 * 1. `onSuccess` — how an app learns it has a signed-in user: `apps/web`
 *    invalidates its caches / honours `?redirect=` there, `apps/studio`
 *    refetches `/aurora/users/me`. Getting it wrong is invisible in the UI
 *    and expensive — a user who dismissed the dialog on the profile step IS
 *    authenticated (the login call already wrote the satoken), so failing to
 *    fire leaves the app rendering a signed-out shell for a signed-in person.
 *    Firing twice re-runs a navigation. So: exactly once, on every terminal
 *    path, and never before a session exists.
 *
 * 2. The send-code cooldown — `getCode` is unauthenticated and bills a real
 *    SMS per call, so "how many requests actually went out" is the assertion
 *    that matters, not what the countdown renders. Every route back to a
 *    send is exercised below.
 */

import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthMode } from "./machine";
import { clearResendDeadline } from "./resend-clock";
import type { AuthRequest, AuthTransport } from "./transport";
import type { AuthSession } from "./types";
import { useAuthFlow, type AuthFlowAnalytics, type AuthFlowController } from "./use-auth-flow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PHONE = "13800138000";
const OTHER_PHONE = "13900139000";
const CODE = "123456";

interface Harness {
  controller: AuthFlowController;
  onSuccess: ReturnType<typeof vi.fn>;
  events: AuthFlowAnalytics[];
  requests: AuthRequest[];
  /** Paths of every code-send request, in order. */
  sends: string[];
  setActive: (active: boolean) => void;
}

const mounted: Array<() => void> = [];

interface MountOptions {
  request?: AuthTransport["request"];
  initialMode?: AuthMode;
  initialIdentifier?: string;
  initialInviteCode?: string;
  verifySession?: () => Promise<boolean>;
  /** Render the dialog closed, the way an app-wide provider mounts it. */
  active?: boolean;
}

function mount(options?: MountOptions): Harness {
  const onSuccess = vi.fn();
  const events: AuthFlowAnalytics[] = [];
  const requests: AuthRequest[] = [];
  let latest: AuthFlowController | null = null;

  /** Java's happy path: codes go out, logins and resets return a session. */
  const transport: AuthTransport = {
    async request(input) {
      requests.push(input);
      if (options?.request) return options.request(input);
      if (input.path.endsWith("/reset/password")) {
        // A reset is always an EXISTING account; onboarding must not run.
        return { status: 200, body: { code: 200, token: "tok-1", userId: "42" } };
      }
      if (input.path.endsWith("/login")) {
        return { status: 200, body: { code: 200, token: "tok-1", isNewUser: true, userId: "42" } };
      }
      return { status: 200, body: { code: 200 } };
    },
  };

  function Probe({ active }: { active: boolean }) {
    latest = useAuthFlow({
      transport,
      onSuccess: onSuccess as (session: AuthSession) => void,
      onEvent: (event) => events.push(event),
      initialMode: options?.initialMode,
      initialIdentifier: options?.initialIdentifier,
      initialInviteCode: options?.initialInviteCode,
      verifySession: options?.verifySession,
      active,
    });
    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const setActive = (active: boolean) => {
    act(() => root.render(createElement(Probe, { active })));
  };
  setActive(options?.active ?? true);
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });

  return {
    get controller() {
      if (!latest) throw new Error("probe never rendered");
      return latest;
    },
    onSuccess,
    events,
    requests,
    get sends() {
      return requests.filter((request) => request.path.includes("getCode")).map((r) => r.path);
    },
    setActive,
  };
}

beforeEach(() => {
  // Module + sessionStorage state by design: it is what survives a remount.
  clearResendDeadline();
});

afterEach(() => {
  while (mounted.length) mounted.pop()!();
});

/** Drive the flow to the point where the session is real: the profile step. */
async function signIn(harness: Harness): Promise<void> {
  await act(async () => harness.controller.actions.setIdentifier(PHONE));
  await act(async () => harness.controller.actions.submitIdentifier());
  // Six digits auto-submits, which is the only way the UI logs in by code.
  await act(async () => harness.controller.actions.setCode(CODE));
  expect(harness.controller.state.step).toBe("profile");
  expect(harness.controller.state.session?.token.value).toBe("tok-1");
}

/** Get a code out and land back on the identifier field, cooldown running. */
async function sendThenGoBack(harness: Harness): Promise<void> {
  await act(async () => harness.controller.actions.setIdentifier(PHONE));
  await act(async () => harness.controller.actions.submitIdentifier());
  expect(harness.controller.state.step).toBe("code");
  expect(harness.sends).toHaveLength(1);
  await act(async () => harness.controller.actions.back());
  expect(harness.controller.state.step).toBe("identifier");
}

describe("onSuccess", () => {
  it("stays silent until a session exists", async () => {
    const harness = mount();
    expect(harness.onSuccess).not.toHaveBeenCalled();

    await act(async () => harness.controller.actions.setIdentifier(PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());
    expect(harness.controller.state.step).toBe("code");
    expect(harness.onSuccess).not.toHaveBeenCalled();

    // A dismiss here has no session behind it — nothing to hand the host,
    // and the dialog is closed by the host instead.
    await act(async () => harness.controller.actions.dismiss());
    expect(harness.controller.state.step).toBe("code");
    expect(harness.onSuccess).not.toHaveBeenCalled();
  });

  it("fires once when the user finishes every step", async () => {
    const harness = mount();
    await signIn(harness);

    await act(async () => harness.controller.actions.setNickname("Ada"));
    await act(async () => harness.controller.actions.submitProfile());
    expect(harness.controller.state.step).toBe("invite");
    expect(harness.onSuccess).not.toHaveBeenCalled();

    await act(async () => harness.controller.actions.setInviteCode("REF123"));
    await act(async () => harness.controller.actions.submitInvite());
    expect(harness.controller.state.step).toBe("done");
    expect(harness.onSuccess).toHaveBeenCalledTimes(1);
    expect(harness.onSuccess.mock.calls[0]![0]).toMatchObject({ userId: "42", isNewUser: true });
  });

  it("fires once when the user skips every step", async () => {
    const harness = mount();
    await signIn(harness);

    await act(async () => harness.controller.actions.skipProfile());
    expect(harness.onSuccess).not.toHaveBeenCalled();
    await act(async () => harness.controller.actions.skipInvite());

    expect(harness.controller.state.step).toBe("done");
    expect(harness.onSuccess).toHaveBeenCalledTimes(1);
  });

  it("fires once when the user dismisses mid-onboarding", async () => {
    const harness = mount();
    await signIn(harness);

    await act(async () => harness.controller.actions.dismiss());

    expect(harness.controller.state.step).toBe("done");
    expect(harness.onSuccess).toHaveBeenCalledTimes(1);
    expect(harness.onSuccess.mock.calls[0]![0]!).toMatchObject({ userId: "42" });
    // Reported as a skip, exactly like the explicit button — otherwise the
    // funnel would show the step as neither completed nor abandoned.
    expect(harness.events).toContainEqual({ type: "step_skipped", step: "profile" });
  });

  it("does not fire a second time when a dismiss follows a completed flow", async () => {
    const harness = mount();
    await signIn(harness);

    await act(async () => harness.controller.actions.skipProfile());
    await act(async () => harness.controller.actions.skipInvite());
    await act(async () => harness.controller.actions.dismiss());

    expect(harness.onSuccess).toHaveBeenCalledTimes(1);
  });

  it("can fire again after the flow is reset on a reused instance", async () => {
    // `reset` has to clear the once-per-open latch too. Leaving it armed
    // makes a long-lived dialog permanently unable to report its NEXT
    // sign-in — invisible until someone signs in twice without a reload.
    const harness = mount();
    await signIn(harness);
    await act(async () => harness.controller.actions.dismiss());
    expect(harness.onSuccess).toHaveBeenCalledTimes(1);

    clearResendDeadline();
    await act(async () => harness.controller.actions.reset());
    expect(harness.controller.state.step).toBe("identifier");
    expect(harness.controller.state.session).toBeNull();

    await signIn(harness);
    await act(async () => harness.controller.actions.dismiss());
    expect(harness.onSuccess).toHaveBeenCalledTimes(2);
  });
});

describe("the send-code cooldown cannot be walked around", () => {
  it("refuses a send for a DIFFERENT identifier inside the window", async () => {
    const harness = mount();
    await sendThenGoBack(harness);

    await act(async () => harness.controller.actions.setIdentifier(OTHER_PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());

    // The bypass: two clicks used to buy a second billable SMS.
    expect(harness.sends).toHaveLength(1);
    expect(harness.controller.state.step).toBe("identifier");
    expect(harness.controller.state.error?.code).toBe("resend_cooldown");
    expect(harness.controller.state.resendSeconds).toBeGreaterThan(0);
  });

  it("re-shows the code step for the SAME identifier, without sending", async () => {
    const harness = mount();
    await sendThenGoBack(harness);

    // Retyping the same number is "let me check that again", not a resend.
    await act(async () => harness.controller.actions.submitIdentifier());

    expect(harness.sends).toHaveLength(1);
    expect(harness.controller.state.step).toBe("code");
    expect(harness.controller.state.error).toBeNull();
  });

  it("survives a trip through the password entry", async () => {
    const harness = mount();
    await sendThenGoBack(harness);

    await act(async () => harness.controller.actions.usePassword());
    await act(async () => harness.controller.actions.useCode());
    await act(async () => harness.controller.actions.setIdentifier(OTHER_PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());

    expect(harness.sends).toHaveLength(1);
    expect(harness.controller.state.error?.code).toBe("resend_cooldown");
  });

  it("survives entering the reset flow — a reset code is the same SMS", async () => {
    const harness = mount();
    await sendThenGoBack(harness);

    await act(async () => harness.controller.actions.usePassword());
    await act(async () => harness.controller.actions.startReset());
    await act(async () => harness.controller.actions.setIdentifier(OTHER_PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());

    expect(harness.controller.state.mode).toBe("reset");
    expect(harness.sends).toHaveLength(1);
    expect(harness.controller.state.error?.code).toBe("resend_cooldown");
  });

  it("survives closing and reopening the dialog", async () => {
    const harness = mount();
    await sendThenGoBack(harness);

    // `active: false` wipes the flow — but not the deadline, and not the
    // code still outstanding for PHONE (see the resume suite below).
    harness.setActive(false);
    harness.setActive(true);

    await act(async () => harness.controller.actions.back());
    await act(async () => harness.controller.actions.setIdentifier(OTHER_PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());

    expect(harness.sends).toHaveLength(1);
    expect(harness.controller.state.error?.code).toBe("resend_cooldown");
  });

  it("survives a full remount of the dialog", async () => {
    const first = mount();
    await sendThenGoBack(first);
    expect(first.sends).toHaveLength(1);

    // What `<AuthDialogProvider>` does on every open: a brand-new dialog
    // with a brand-new reducer. It inherits the deadline from the clock.
    const second = mount();
    expect(second.controller.state.resendSeconds).toBeGreaterThan(0);

    await act(async () => second.controller.actions.back());
    await act(async () => second.controller.actions.setIdentifier(OTHER_PHONE));
    await act(async () => second.controller.actions.submitIdentifier());

    expect(second.sends).toHaveLength(0);
    expect(second.controller.state.error?.code).toBe("resend_cooldown");
  });

  it("reads the tab-wide clock at send time, not the state it was built with", async () => {
    // Two dialogs alive at once — a stale gate in the second one is a
    // free SMS, because its reducer was built before the first sent.
    const first = mount();
    const second = mount();
    expect(second.controller.state.resendSeconds).toBe(0);

    await act(async () => first.controller.actions.setIdentifier(PHONE));
    await act(async () => first.controller.actions.submitIdentifier());

    await act(async () => second.controller.actions.setIdentifier(OTHER_PHONE));
    await act(async () => second.controller.actions.submitIdentifier());

    expect(second.sends).toHaveLength(0);
    expect(second.controller.state.error?.code).toBe("resend_cooldown");
    // And the number beside the refusal is the deadline that refused it,
    // not the zero its own snapshot still held.
    expect(second.controller.state.resendSeconds).toBeGreaterThan(0);
  });

  it("blocks the resend button for the same window", async () => {
    const harness = mount();
    await act(async () => harness.controller.actions.setIdentifier(PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());

    expect(harness.controller.can.resendCode).toBe(false);
    await act(async () => harness.controller.actions.resendCode());
    expect(harness.sends).toHaveLength(1);
  });

  it("still refuses a malformed identifier before any cooldown talk", async () => {
    const harness = mount();
    await act(async () => harness.controller.actions.setIdentifier("nonsense"));
    await act(async () => harness.controller.actions.submitIdentifier());
    expect(harness.controller.state.error?.code).toBe("identifier_invalid");
    expect(harness.sends).toHaveLength(0);
  });

  it("does not arm the cooldown when the send itself failed", async () => {
    // Only a delivered code costs money, so only a delivered code locks
    // the field — otherwise one outage would freeze sign-in for a minute.
    const failing: AuthTransport = {
      request: async () => ({ status: 200, body: { code: 500, msg: "系统繁忙" } }),
    };
    let latest: AuthFlowController | null = null;
    function Probe() {
      latest = useAuthFlow({ transport: failing, onSuccess: vi.fn(), active: true });
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(createElement(Probe)));
    mounted.push(() => {
      act(() => root.unmount());
      container.remove();
    });

    await act(async () => latest!.actions.setIdentifier(PHONE));
    await act(async () => latest!.actions.submitIdentifier());
    expect(latest!.state.error?.code).toBe("server_error");
    expect(latest!.state.resendSeconds).toBe(0);
  });
});

describe("prefills survive a dialog that is mounted closed", () => {
  /**
   * Both apps mount the dialog once, for the whole app, and open it
   * later — so its FIRST render is `active: false`. The close effect
   * used to fire on that render and wipe the seeds, which for
   * `initialInviteCode` means referral attribution silently drops to
   * zero: the code is passed in exactly this way.
   */
  it("keeps the identifier and the invite code until it is opened", () => {
    const harness = mount({
      active: false,
      initialIdentifier: PHONE,
      initialInviteCode: "REF-123",
    });

    expect(harness.controller.state.identifier).toBe(PHONE);
    expect(harness.controller.state.inviteCode).toBe("REF-123");

    harness.setActive(true);

    expect(harness.controller.state.identifier).toBe(PHONE);
    expect(harness.controller.state.inviteCode).toBe("REF-123");
  });

  it("still wipes them when a dialog that WAS open closes", async () => {
    const harness = mount({ initialIdentifier: PHONE, initialInviteCode: "REF-123" });

    harness.setActive(false);

    expect(harness.controller.state.identifier).toBe("");
    expect(harness.controller.state.inviteCode).toBe("");
  });
});

describe("an unverified session leaves nothing behind", () => {
  it("clears the cookie the login wrote when the probe says signed out", async () => {
    document.cookie = "satoken=; path=/; max-age=0";
    const harness = mount({ verifySession: async () => false });

    await act(async () => harness.controller.actions.setIdentifier(PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());
    await act(async () => harness.controller.actions.setCode(CODE));

    expect(harness.controller.state.error?.code).toBe("session_unverified");
    expect(harness.controller.state.session).toBeNull();
    // The write happened (Java's own Set-Cookie is wrong off .com), so
    // the undo has to happen too — otherwise the app renders a
    // signed-in shell around a dialog saying the opposite.
    expect(document.cookie).not.toContain("tok-1");
  });

  it("keeps the cookie when the probe confirms the session", async () => {
    const harness = mount({ verifySession: async () => true });

    await act(async () => harness.controller.actions.setIdentifier(PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());
    await act(async () => harness.controller.actions.setCode(CODE));

    expect(harness.controller.state.step).toBe("profile");
    expect(document.cookie).toContain("tok-1");
  });
});

describe("a code belongs to the mode that issued it", () => {
  /**
   * The dead end this closes: enter a phone → Continue (a SIGN-IN code
   * goes out) → back → "use password" → "forgot password?" (the
   * identifier carries over) → Continue. On account alone the cooldown
   * gate read that as "same identifier, no send needed" and dropped the
   * user on the code step in RESET mode with no reset code ever sent.
   * They typed the SMS they really had, reached the new-password step,
   * and Java refused it — bouncing them back to a code step whose resend
   * was still on cooldown. Dead for the rest of the window.
   */
  it("refuses to resume a sign-in code into the reset flow", async () => {
    const harness = mount();
    await sendThenGoBack(harness);
    expect(harness.controller.state.sentMode).toBe("signin");

    await act(async () => harness.controller.actions.usePassword());
    await act(async () => harness.controller.actions.startReset());
    // The identifier carried over from the password step — same account,
    // different mode, and Java scopes reset codes to the reset call.
    expect(harness.controller.state.identifier).toBe(PHONE);
    await act(async () => harness.controller.actions.submitIdentifier());

    expect(harness.controller.state.step).toBe("identifier");
    expect(harness.controller.state.error?.code).toBe("resend_cooldown");
    expect(harness.sends).toHaveLength(1);
  });

  it("refuses the mirror case: a reset code resumed as a sign-in", async () => {
    const harness = mount({ initialMode: "reset" });
    await act(async () => harness.controller.actions.setIdentifier(PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());
    expect(harness.controller.state.sentMode).toBe("reset");

    await act(async () => harness.controller.actions.back());
    await act(async () => harness.controller.actions.back());
    await act(async () => harness.controller.actions.useCode());
    expect(harness.controller.state.mode).toBe("signin");
    await act(async () => harness.controller.actions.submitIdentifier());

    expect(harness.controller.state.step).toBe("identifier");
    expect(harness.controller.state.error?.code).toBe("resend_cooldown");
    expect(harness.sends).toHaveLength(1);
  });

  it("still resumes the code the CURRENT mode sent", async () => {
    const harness = mount({ initialMode: "reset" });
    await act(async () => harness.controller.actions.setIdentifier(PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());
    await act(async () => harness.controller.actions.back());

    await act(async () => harness.controller.actions.submitIdentifier());

    expect(harness.controller.state.step).toBe("code");
    expect(harness.controller.state.error).toBeNull();
    expect(harness.sends).toHaveLength(1);
  });
});

describe("a dismissed code session is resumable", () => {
  /**
   * The first-run mistake this closes: the SMS arrives, the user taps
   * away from the dialog to read it, reopens — and lands on the
   * identifier step with a live cooldown, unable to enter the code they
   * are holding and unable to ask for a new one for up to a minute.
   */
  it("reopens on the code step, on the account the code went to", async () => {
    const harness = mount();
    await act(async () => harness.controller.actions.setIdentifier(PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());

    harness.setActive(false);
    harness.setActive(true);

    expect(harness.controller.state.step).toBe("code");
    expect(harness.controller.state.account).toEqual({ kind: "phone", account: PHONE });
    expect(harness.controller.state.identifier).toBe(PHONE);
    // Resumed, not re-sent.
    expect(harness.sends).toHaveLength(1);

    // And it is a real code step: the typed code signs the user in.
    await act(async () => harness.controller.actions.setCode(CODE));
    expect(harness.controller.state.step).toBe("profile");
  });

  it("survives a full remount, which is how the web provider reopens", async () => {
    const first = mount();
    await act(async () => first.controller.actions.setIdentifier(PHONE));
    await act(async () => first.controller.actions.submitIdentifier());

    const second = mount();

    expect(second.controller.state.step).toBe("code");
    expect(second.controller.state.identifier).toBe(PHONE);
    expect(second.sends).toHaveLength(0);
  });

  it("keeps the typed code out of the resumed step", async () => {
    const harness = mount();
    await act(async () => harness.controller.actions.setIdentifier(PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());
    await act(async () => harness.controller.actions.setCode("123"));

    harness.setActive(false);
    harness.setActive(true);

    expect(harness.controller.state.code).toBe("");
  });

  it("does not resume a code the other mode sent", async () => {
    const first = mount();
    await act(async () => first.controller.actions.setIdentifier(PHONE));
    await act(async () => first.controller.actions.submitIdentifier());

    // `/forgot-password` opening while a sign-in code is outstanding.
    const second = mount({ initialMode: "reset" });

    expect(second.controller.state.step).toBe("identifier");
    expect(second.controller.state.account).toBeNull();
  });

  it("expires with the cooldown it exists to cover", async () => {
    const harness = mount();
    await act(async () => harness.controller.actions.setIdentifier(PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());

    // Past the window: Continue sends a fresh code from here, so there is
    // nothing left to be stranded by and nothing left to resume.
    clearResendDeadline();
    const reopened = mount();

    expect(reopened.controller.state.step).toBe("identifier");
    expect(reopened.controller.state.identifier).toBe("");
  });

  it("is spent by a successful sign-in", async () => {
    const harness = mount();
    await signIn(harness);
    await act(async () => harness.controller.actions.dismiss());

    const next = mount();

    expect(next.controller.state.step).toBe("identifier");
    expect(next.controller.state.account).toBeNull();
  });
});

describe("password reset", () => {
  it("goes identifier → code → new password → signed in", async () => {
    const harness = mount({ initialMode: "reset" });
    expect(harness.controller.state.mode).toBe("reset");

    await act(async () => harness.controller.actions.setIdentifier(PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());
    // The reset flow has its own, older code endpoint.
    expect(harness.sends).toEqual(["/user/getCode"]);
    expect(harness.controller.state.step).toBe("code");

    // A full code moves the screen on; it does NOT sign anyone in.
    await act(async () => harness.controller.actions.setCode(CODE));
    expect(harness.controller.state.step).toBe("reset_password");
    expect(harness.controller.state.session).toBeNull();
    expect(harness.requests.some((r) => r.path.endsWith("/new/login"))).toBe(false);

    await act(async () => harness.controller.actions.setNewPassword("hunter2"));
    await act(async () => harness.controller.actions.setConfirmPassword("hunter2"));
    expect(harness.controller.can.submitNewPassword).toBe(true);
    await act(async () => harness.controller.actions.submitNewPassword());

    expect(harness.requests.at(-1)).toEqual({
      method: "POST",
      path: "/user/reset/password",
      form: { phone: PHONE, code: CODE, password: "hunter2" },
    });
    expect(harness.onSuccess).toHaveBeenCalledTimes(1);
    expect(harness.events).toContainEqual(
      expect.objectContaining({ type: "signed_in", method: "reset" })
    );
  });

  it("refuses a short or mismatched password without a round trip", async () => {
    const harness = mount({ initialMode: "reset" });
    await act(async () => harness.controller.actions.setIdentifier(PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());
    await act(async () => harness.controller.actions.setCode(CODE));

    await act(async () => harness.controller.actions.setNewPassword("abc"));
    await act(async () => harness.controller.actions.setConfirmPassword("abc"));
    await act(async () => harness.controller.actions.submitNewPassword());
    expect(harness.controller.state.error?.code).toBe("password_too_short");

    await act(async () => harness.controller.actions.setNewPassword("hunter2"));
    await act(async () => harness.controller.actions.setConfirmPassword("hunter3"));
    await act(async () => harness.controller.actions.submitNewPassword());
    expect(harness.controller.state.error?.code).toBe("password_mismatch");

    expect(harness.requests.some((r) => r.path.includes("reset/password"))).toBe(false);
  });

  it("sends a wrong code back to the code step, where it can be fixed", async () => {
    const requests: AuthRequest[] = [];
    const transport: AuthTransport = {
      async request(input) {
        requests.push(input);
        if (input.path.includes("reset/password")) {
          return { status: 200, body: { code: 500, msg: "验证码错误" } };
        }
        return { status: 200, body: { code: 200 } };
      },
    };
    let latest: AuthFlowController | null = null;
    function Probe() {
      latest = useAuthFlow({
        transport,
        onSuccess: vi.fn(),
        initialMode: "reset",
        active: true,
      });
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(createElement(Probe)));
    mounted.push(() => {
      act(() => root.unmount());
      container.remove();
    });

    await act(async () => latest!.actions.setIdentifier(PHONE));
    await act(async () => latest!.actions.submitIdentifier());
    await act(async () => latest!.actions.setCode(CODE));
    await act(async () => latest!.actions.setNewPassword("hunter2"));
    await act(async () => latest!.actions.setConfirmPassword("hunter2"));
    await act(async () => latest!.actions.submitNewPassword());

    expect(latest!.state.step).toBe("code");
    expect(latest!.state.error).toEqual({ code: "code_incorrect", serverMessage: "验证码错误" });
  });

  it("uses the email reset endpoints for an email account", async () => {
    const harness = mount({ initialMode: "reset" });
    await act(async () => harness.controller.actions.setIdentifier("Isaac@Example.com"));
    await act(async () => harness.controller.actions.submitIdentifier());
    expect(harness.requests[0]).toEqual({
      method: "GET",
      path: "/user/email/getCode",
      // Normalized on the way out, exactly like the sign-in flow.
      query: { email: "isaac@example.com" },
    });
  });
});

describe("pending code-send ownership", () => {
  function pendingResponse() {
    let finish!: () => void;
    const promise = new Promise<{ status: number; body: { code: number } }>((resolve) => {
      finish = () => resolve({ status: 200, body: { code: 200 } });
    });
    return { promise, finish };
  }
  it("releases admission after failure so the active flow can retry", async () => {
    let attempts = 0;
    const harness = mount({
      request: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("offline"))
          : Promise.resolve({ status: 200, body: { code: 200 } });
      },
    });
    await act(async () => harness.controller.actions.setIdentifier(PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());
    expect(harness.controller.state.error).not.toBeNull();
    await act(async () => harness.controller.actions.submitIdentifier());
    expect(harness.sends).toHaveLength(2);
    expect(harness.controller.state.step).toBe("code");
  });
  it("admits only one pending code send across mounted dialogs", async () => {
    const pending = pendingResponse();
    const first = mount({ request: () => pending.promise });
    const second = mount();
    await act(async () => first.controller.actions.setIdentifier(PHONE));
    await act(async () => second.controller.actions.setIdentifier(OTHER_PHONE));
    await act(async () => first.controller.actions.submitIdentifier());
    await act(async () => second.controller.actions.submitIdentifier());
    const secondCount = second.sends.length;
    await act(async () => pending.finish());
    expect(first.sends).toHaveLength(1);
    expect(secondCount).toBe(0);
  });
  it("retains pending-send admission across close and reopen", async () => {
    const pending = pendingResponse();
    const harness = mount({ request: () => pending.promise });
    await act(async () => harness.controller.actions.setIdentifier(PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());
    harness.setActive(false);
    harness.setActive(true);
    await act(async () => harness.controller.actions.setIdentifier(OTHER_PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());
    const count = harness.sends.length;
    await act(async () => pending.finish());
    expect(count).toBe(1);
  });
  it("keeps a replacement dialog on its own input after an old send completes", async () => {
    const pending = pendingResponse();
    const harness = mount({ request: () => pending.promise });
    await act(async () => harness.controller.actions.setIdentifier(PHONE));
    await act(async () => harness.controller.actions.submitIdentifier());
    harness.setActive(false);
    harness.setActive(true);
    await act(async () => harness.controller.actions.setIdentifier(OTHER_PHONE));
    await act(async () => pending.finish());
    expect(harness.controller.state.step).toBe("identifier");
    expect(harness.controller.state.identifier).toBe(OTHER_PHONE);
    expect(harness.events).toEqual([]);
  });
});
