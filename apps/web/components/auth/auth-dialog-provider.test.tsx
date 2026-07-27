// @vitest-environment jsdom

/**
 * Referral attribution through the sign-in dialog.
 *
 * The old `/register` page read `?recommendationCode=` synchronously out of
 * `useSearchParams()` at render. The dialog cannot: it opens from anywhere,
 * and its invite step runs several steps after the page whose URL carried
 * the code. The carry-through is therefore a sessionStorage stash — and the
 * ONE ordering that matters is a cold landing on `/register?recommendationCode=…`,
 * where the route's mount effect opens the dialog BEFORE this provider's own
 * effects have run. Reading the stash alone at that moment yields nothing and
 * referral attribution drops to zero, silently.
 *
 * These tests pin the two halves of the fix: `open()` captures for itself,
 * and the ambient capture re-runs when only the query string changes.
 */

import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleAuthSuccess } from "@/src/lib/auth/post-auth";
import { AuthDialogProvider, useAuthDialog, type OpenAuthOptions } from "./auth-dialog-provider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Props of every `<AuthDialog>` render, newest last. */
const captured = vi.hoisted(() => ({ dialogs: [] as Array<Record<string, unknown>> }));

vi.mock("@repo/auth-flow", () => ({
  AuthDialog: (props: Record<string, unknown>) => {
    captured.dialogs.push(props);
    return null;
  },
}));

const nav = vi.hoisted(() => ({ suspendSearchParams: false }));

vi.mock("next/navigation", () => ({
  // The provider only ever reads the current URL through these, so mirror
  // `window.location`, which the tests drive with `history.replaceState`.
  usePathname: () => window.location.pathname,
  useSearchParams: () => {
    // `useSearchParams()` is documented to bail the tree out to client-side
    // rendering; the real hook can suspend, and a suspended <ReferralCapture>
    // runs no effect at all. Simulating that is how the tests below prove the
    // capture inside `open()` — not the ambient one — is what saves the code.
    if (nav.suspendSearchParams) throw new Promise<void>(() => {});
    return new URLSearchParams(window.location.search);
  },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/image", () => ({ default: () => null }));
vi.mock("posthog-js", () => ({ default: { identify: vi.fn(), capture: vi.fn() } }));
vi.mock("@/src/env", () => ({ env: { USER_BASE_URL: "", OSS_BASE_URL: "https://oss.test" } }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/src/hooks/use-user", () => ({
  userKeys: { info: ["user", "info"], credits: ["user", "credits"] },
}));
vi.mock("@/src/services/user", () => ({ resolveAssetUrl: (path: string) => path }));
vi.mock("@/src/lib/axon", () => ({ axonLogin: vi.fn(), axonSignUp: vi.fn() }));
vi.mock("@/src/lib/auth/post-auth", () => ({ handleAuthSuccess: vi.fn() }));
vi.mock("@/src/lib/auth/transport", () => ({
  createWebAuthTransport: () => ({ request: vi.fn() }),
}));

const REFERRAL_KEY = "fd.auth.recommendationCode";

let root: Root | null = null;
let container: HTMLElement | null = null;

/** A child that opens the dialog from its own mount effect, like `/register`. */
function OpensOnMount({ options }: { options?: OpenAuthOptions }) {
  const { open } = useAuthDialog();
  useEffect(() => {
    open(options);
    // Mount-only, exactly like `<AuthRouteScreen>`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function render(children: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<AuthDialogProvider>{children}</AuthDialogProvider>));
}

/** Re-render the same tree, which is what a client-side navigation looks like here. */
function rerender(children: React.ReactNode) {
  act(() => root!.render(<AuthDialogProvider>{children}</AuthDialogProvider>));
}

function latestDialog(): Record<string, unknown> {
  const props = captured.dialogs.at(-1);
  if (!props) throw new Error("<AuthDialog> never rendered");
  return props;
}

function goTo(url: string) {
  window.history.replaceState({}, "", url);
}

/** The session the dialog hands back once the flow terminates. */
const SESSION = {
  token: { name: "satoken", value: "tok-1" },
  isNewUser: false,
  userId: "42",
  identifier: { kind: "phone" as const, account: "13800138000" },
};

function succeed() {
  const onSuccess = latestDialog().onSuccess as (session: typeof SESSION) => void;
  act(() => onSuccess(SESSION));
}

beforeEach(() => {
  captured.dialogs.length = 0;
  nav.suspendSearchParams = false;
  window.sessionStorage.clear();
  vi.mocked(handleAuthSuccess).mockClear();
  goTo("/en-US");
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("referral code on a cold landing", () => {
  // Every entry path, with the ambient capture suspended so ONLY the
  // capture inside `open()` can save the code — which is the situation a
  // cold landing is: the route's mount effect fires before the provider's.
  it.each([
    ["/en-US/register?recommendationCode=REF-COLD", "REF-COLD"],
    ["/en-US/login?recommendationCode=REF-COLD", "REF-COLD"],
    ["/en-US/forgot-password?recommendationCode=REF-COLD", "REF-COLD"],
  ])("reaches the invite step from %s", (url, expected) => {
    nav.suspendSearchParams = true;
    goTo(url);

    render(<OpensOnMount options={{ mode: "navigate" }} />);

    expect(latestDialog().open).toBe(true);
    expect(latestDialog().initialInviteCode).toBe(expected);
  });

  it("reaches an in-place gated open, ambient capture suspended", () => {
    nav.suspendSearchParams = true;
    goTo("/en-US/ips/12?recommendationCode=REF-GATED");

    render(<OpensOnMount />);

    expect(latestDialog().initialInviteCode).toBe("REF-GATED");
  });

  it("digs the code out of a ?redirect= stashed by the proxy's auth gate", () => {
    nav.suspendSearchParams = true;
    // Exactly what proxy.ts writes when a gated deep link is hit signed-out.
    const redirect = encodeURIComponent(
      "/en-US/play/interactive-film/7?recommendationCode=REF-DEEP"
    );
    goTo(`/en-US/login?redirect=${redirect}`);

    render(<OpensOnMount options={{ mode: "navigate" }} />);

    expect(latestDialog().initialInviteCode).toBe("REF-DEEP");
  });

  it("carries a code captured on an earlier page into an in-place gated open", () => {
    goTo("/en-US/ips/12?recommendationCode=REF-EARLIER");
    render(<div />);

    // The visitor browses on; the code is long gone from the URL.
    goTo("/en-US/crews");
    rerender(<OpensOnMount />);

    expect(latestDialog().initialInviteCode).toBe("REF-EARLIER");
  });

  it("re-captures when only the query string changes", () => {
    goTo("/en-US/ips/12");
    render(<div />);
    expect(window.sessionStorage.getItem(REFERRAL_KEY)).toBeNull();

    // A `router.replace` that appends the code to the SAME route — the
    // capture must not be keyed on the pathname alone.
    goTo("/en-US/ips/12?recommendationCode=REF-APPENDED");
    rerender(<div />);

    expect(window.sessionStorage.getItem(REFERRAL_KEY)).toBe("REF-APPENDED");
  });

  it("prefers the code in the current URL over a stale stash", () => {
    nav.suspendSearchParams = true;
    window.sessionStorage.setItem(REFERRAL_KEY, "REF-OLD");
    goTo("/en-US/register?recommendationCode=REF-NEW");

    render(<OpensOnMount options={{ mode: "navigate" }} />);

    expect(latestDialog().initialInviteCode).toBe("REF-NEW");
  });

  it("opens with an empty invite field when no code was ever seen", () => {
    render(<OpensOnMount />);
    expect(latestDialog().initialInviteCode).toBe("");
  });
});

describe("onSuccess reaches the caller in both modes", () => {
  it("fires on an in-place gate", () => {
    const onSuccess = vi.fn();
    render(<OpensOnMount options={{ mode: "stay", onSuccess }} />);

    succeed();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(latestDialog().open).toBe(false);
  });

  it("fires on a navigate-mode route too, BEFORE the page is torn down", () => {
    // `handleAuthSuccess` ends in `window.location.assign`, so a callback
    // queued after it never runs. /invite is the caller this stranded:
    // it resumes its own fetch state machine from here.
    const onSuccess = vi.fn();
    goTo("/en-US/login");
    render(<OpensOnMount options={{ mode: "navigate", onSuccess }} />);

    succeed();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(handleAuthSuccess).toHaveBeenCalledWith({
      tokenValue: "tok-1",
      tokenName: "satoken",
    });
    expect(vi.mocked(onSuccess).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(handleAuthSuccess).mock.invocationCallOrder[0]!
    );
  });

  it("never fires onDismiss on the way out", () => {
    const onDismiss = vi.fn();
    render(<OpensOnMount options={{ mode: "stay", onDismiss }} />);

    succeed();

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("a route change ends the prompt", () => {
  it("closes the dialog and disarms the old route's callbacks", () => {
    const onDismiss = vi.fn();
    const onSuccess = vi.fn();
    goTo("/en-US/invite");
    render(<OpensOnMount options={{ mode: "navigate", onDismiss, onSuccess }} />);
    expect(latestDialog().open).toBe(true);

    // The visitor navigates away instead of signing in.
    goTo("/en-US/crews");
    rerender(<div />);

    expect(latestDialog().open).toBe(false);
    // They declined nothing — they left. Running the old route's rescue
    // would `router.replace` them off the page they just chose.
    expect(onDismiss).not.toHaveBeenCalled();

    // And the stale mode/callbacks must not fire on a later success.
    succeed();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(handleAuthSuccess).not.toHaveBeenCalled();
  });

  it("leaves a dialog opened BY the new route alone", () => {
    // `<AuthRouteScreen>` opens from a child effect, which runs before the
    // provider's own — the close must not race it.
    goTo("/en-US/ips/12");
    render(<div />);

    goTo("/en-US/login");
    rerender(<OpensOnMount options={{ mode: "navigate" }} />);

    expect(latestDialog().open).toBe(true);
  });

  it("ignores a re-render that does not change the route", () => {
    render(<OpensOnMount />);
    expect(latestDialog().open).toBe(true);

    rerender(<div />);

    expect(latestDialog().open).toBe(true);
  });
});

describe("reset intent", () => {
  it("opens the dialog in sign-in mode by default", () => {
    render(<OpensOnMount />);
    expect(latestDialog().initialMode).toBe("signin");
  });

  it("opens straight into the reset flow for /forgot-password", () => {
    goTo("/en-US/forgot-password");
    render(<OpensOnMount options={{ mode: "navigate", intent: "reset" }} />);
    expect(latestDialog().initialMode).toBe("reset");
  });
});

describe("open() is idempotent", () => {
  it("keeps the first caller's options when a protected page opens twice", () => {
    const first = vi.fn();
    const second = vi.fn();

    render(
      <>
        {/* <AuthGate> and the page's own effect, both firing on one expiry. */}
        <OpensOnMount
          options={{ mode: "stay", identifier: "first@example.com", onDismiss: first }}
        />
        <OpensOnMount
          options={{ mode: "navigate", identifier: "second@example.com", onDismiss: second }}
        />
      </>
    );

    // A second open would have bumped the dialog's `key` and remounted it,
    // discarding anything already typed.
    expect(latestDialog().initialIdentifier).toBe("first@example.com");

    const onOpenChange = latestDialog().onOpenChange as (open: boolean) => void;
    act(() => onOpenChange(false));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(latestDialog().open).toBe(false);
  });
});
