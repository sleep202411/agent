"use client";

/**
 * The app's single sign-in surface.
 *
 * One `<AuthDialog>` is mounted for the whole app, and everything that
 * used to send the user to `/login` now calls `useAuthDialog().open()`
 * instead. That is the point of the rewrite: a visitor who hits a gate
 * halfway through something keeps their page, their scroll position and
 * their in-progress state.
 *
 * Two success modes, because the two entry shapes genuinely differ:
 *
 *   "navigate" — the `/login`, `/register` and `/forgot-password`
 *     routes. There is nothing behind the dialog to return to, and
 *     `?redirect=` has to be honoured. Hands off to `handleAuthSuccess`,
 *     which owns the Safari cookie race and the open-redirect guard.
 *
 *   "stay" — every in-place gate. Close the dialog, drop the signed-out
 *     caches and `router.refresh()` so server components re-render with
 *     the new cookie. No navigation: the user is already where they
 *     wanted to be.
 *
 * The analytics the deleted login/register pages fired (PostHog identify
 * + capture, Axon login/signup) move here, driven by the package's
 * `onEvent` stream, so attribution survives the flow change.
 */

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import posthog from "posthog-js";
import {
  AuthDialog,
  type AuthMode,
  type AuthSession,
  type AuthTranslate,
  type AuthTranslationKey,
} from "@repo/auth-flow";
import enUS from "@/messages/en-US.json";

import { env } from "@/src/env";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { userKeys } from "@/src/hooks/use-user";
import { resolveAssetUrl } from "@/src/services/user";
import { axonLogin, axonSignUp } from "@/src/lib/axon";
import { handleAuthSuccess } from "@/src/lib/auth/post-auth";
import { captureReferralCode, clearReferralCode, readReferralCode } from "@/src/lib/auth/referral";
import { createWebAuthTransport } from "@/src/lib/auth/transport";

export type AuthSuccessMode = "navigate" | "stay";

export interface OpenAuthOptions {
  /**
   * What happens after the last step. Defaults to "stay" — an in-place
   * gate is the common case, and navigating a user away from the thing
   * they just tried to do is the behaviour this rewrite removes.
   */
  mode?: AuthSuccessMode;
  /**
   * Which flow to open on. `/forgot-password` is the only caller that
   * passes "reset"; everywhere else starts on the code flow, where the
   * dialog offers the reset entry only once the user chooses to sign in
   * with a password.
   */
  intent?: AuthMode;
  /** Prefill the identifier field (nothing uses it yet; the dialog supports it). */
  identifier?: string;
  /**
   * Fired ONLY when the user dismisses without signing in (Escape, the
   * backdrop, the close button) — never after a success.
   *
   * The distinction matters: `/login` sends a dismissing visitor home,
   * and if that also ran on success it would race the `?redirect=`
   * navigation and sometimes win, silently dropping the destination
   * the proxy stashed.
   */
  onDismiss?: () => void;
  /**
   * Fired after a successful sign-in, on BOTH modes.
   *
   * For callers whose page state is not in React Query — `/invite`
   * drives its own fetch/poll state machine — this is how they resume
   * the action the gate interrupted, which is the point of prompting in
   * place rather than navigating away. It runs before the mode's own
   * handling, because "navigate" ends in a full-page `location.assign`
   * that never returns.
   */
  onSuccess?: () => void;
}

interface AuthDialogContextValue {
  open: (options?: OpenAuthOptions) => void;
  close: () => void;
  isOpen: boolean;
}

/**
 * Message-file coverage, enforced at compile time.
 *
 * `AuthTranslate` already makes a MISSPELLED key a type error at the
 * call site, but it cannot see whether `messages/*.json` actually
 * defines the key — a key the package adds later would type-check here
 * and render as the raw string `auth.newKey` in production. This
 * assignment closes that gap: `Record<AuthTranslationKey, string>`
 * only accepts an object that defines every key in the union, so
 * `npm run check-types` fails until the `auth` namespace is filled in.
 *
 * en-US is the reference; the other two locales are kept in step by the
 * same review that touches this file (i18next falls back to en-US, so a
 * missing zh key degrades to English rather than to a raw key).
 */
const _authKeysCovered: Record<AuthTranslationKey, string> = enUS.auth;
void _authKeysCovered;

const AuthDialogContext = createContext<AuthDialogContextValue | null>(null);

/**
 * Access the app-wide sign-in dialog.
 *
 * Safe to call from anywhere under `<Providers>`; throws only if the
 * provider is genuinely missing, which is a wiring bug rather than a
 * runtime condition.
 */
export function useAuthDialog(): AuthDialogContextValue {
  const context = useContext(AuthDialogContext);
  if (!context) throw new Error("useAuthDialog must be used inside <AuthDialogProvider>");
  return context;
}

export function AuthDialogProvider({ children }: { children: React.ReactNode }) {
  const raw = useTranslations("auth");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const queryClient = useQueryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [identifier, setIdentifier] = useState<string | undefined>(undefined);
  const [intent, setIntent] = useState<AuthMode>("signin");
  const [inviteCode, setInviteCode] = useState("");
  /**
   * Bumped on every open, and used as the dialog's React `key`.
   *
   * The flow machine seeds `initialIdentifier` / `initialInviteCode`
   * once, when its reducer is created, and its internal `reset` (fired
   * when the dialog closes) rebuilds state WITHOUT them. Since this
   * provider mounts one long-lived dialog for the whole app, a visitor
   * who opened the dialog, closed it, and opened it again would get an
   * empty invite field — dropping the referral code on exactly the
   * second attempt. Remounting on each open re-seeds the prefills.
   */
  const [sessionKey, setSessionKey] = useState(0);
  // Read at success time, not render time — the mode is decided by
  // whoever opened the dialog, and a re-render must not change it.
  const modeRef = useRef<AuthSuccessMode>("stay");
  const dismissRef = useRef<(() => void) | null>(null);
  const successRef = useRef<(() => void) | null>(null);
  /**
   * `isOpen`, readable synchronously. Two effects can call `open()` on the
   * same tick (see the idempotence note below) and neither would see the
   * other's `setIsOpen` — state does not update until React re-renders.
   */
  const openRef = useRef(false);
  /**
   * The route the dialog was opened over, so the effect below can tell a
   * navigation AWAY from the open that a navigation just caused.
   */
  const openedAt = useRef<string | null>(null);

  const setOpenState = useCallback((next: boolean) => {
    openRef.current = next;
    setIsOpen(next);
  }, []);

  const open = useCallback(
    (options?: OpenAuthOptions) => {
      // Idempotent. `/profile` is protected, so on a mid-session expiry
      // BOTH <AuthGate> and the page's own effect call open() — a second
      // open would bump `sessionKey`, remounting the dialog and wiping
      // whatever the user had already typed into it, and would replace the
      // first caller's mode + callbacks. First caller wins.
      if (openRef.current) return;
      modeRef.current = options?.mode ?? "stay";
      dismissRef.current = options?.onDismiss ?? null;
      successRef.current = options?.onSuccess ?? null;
      // `window.location`, not `usePathname()`: a route that opens the
      // dialog from its own mount effect does so BEFORE this provider's
      // effects run, and history is already committed by then while a
      // captured render value could still be the previous route. Same
      // reason the referral capture below reads `window.location.search`.
      openedAt.current = window.location.pathname;
      setIdentifier(options?.identifier);
      setIntent(options?.intent ?? "signin");
      // CAPTURE, then read — never `readReferralCode()` alone. A cold
      // landing on /register?recommendationCode=… opens the dialog from a
      // child effect, and child effects run BEFORE this provider's own, so
      // at this point the stash can still be empty while the code is
      // sitting right there in the URL. Capturing here makes the two
      // orderings identical, and `captureReferralCode` returns the stash
      // when the current URL carries nothing.
      setInviteCode(captureReferralCode(window.location.search));
      setSessionKey((key) => key + 1);
      setOpenState(true);
    },
    [setOpenState]
  );

  const close = useCallback(() => setOpenState(false), [setOpenState]);

  /**
   * A route change ends the prompt.
   *
   * Nothing else did: the provider outlives every page, so a dialog
   * opened by `/invite`'s gate stayed mounted after a client-side
   * navigation — over an unrelated page, still holding the OLD route's
   * `mode` and `onDismiss`. Signing in there would run
   * `handleAuthSuccess` (a hard navigation to a `?redirect=` from a page
   * the user left) and dismissing it would `router.replace` them home
   * from a page they had deliberately navigated to.
   *
   * `onDismiss` is deliberately NOT fired: the user did not decline
   * anything, they went somewhere else, and its callers exist to rescue
   * a visitor stranded on a page that needs a session — which is exactly
   * what leaving that page already did.
   */
  useEffect(() => {
    if (!openRef.current) return;
    // The route that just opened us (`<AuthRouteScreen>` mounts and calls
    // `open()` in a child effect, which runs BEFORE this one).
    if (openedAt.current === pathname) return;
    openedAt.current = null;
    modeRef.current = "stay";
    dismissRef.current = null;
    successRef.current = null;
    setOpenState(false);
  }, [pathname, setOpenState]);

  /**
   * The dialog's own dismiss affordances (Escape / backdrop / close).
   * Success closes via `setOpenState(false)` in `onSuccess` instead, so it
   * never reaches this path and never fires `onDismiss`. A dismiss AFTER a
   * successful sign-in doesn't reach it either: the flow treats that as
   * "skip the rest" and exits through `onSuccess` (see `@repo/auth-flow`'s
   * `dismissed` event).
   */
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (next) return;
      const onDismiss = dismissRef.current;
      dismissRef.current = null;
      onDismiss?.();
    },
    [setOpenState]
  );

  // The package's key union is the contract; this cast is the single
  // place the app's loosely-typed i18next wrapper meets it, so a key the
  // package adds later fails to compile here instead of rendering raw.
  const t = useMemo<AuthTranslate>(() => (key, vars) => raw(key, vars), [raw]);

  const transport = useMemo(() => createWebAuthTransport(locale), [locale]);

  const resolveAvatarUrl = useCallback(
    (path: string) => resolveAssetUrl(path, env.USER_BASE_URL || env.OSS_BASE_URL) ?? path,
    []
  );

  const onSuccess = useCallback(
    (session: AuthSession) => {
      // The invite step has already bound (or skipped) the code by now —
      // holding it any longer would prefill a stranger's next signup in
      // the same tab.
      clearReferralCode();
      dismissRef.current = null;
      openedAt.current = null;
      const onDone = successRef.current;
      successRef.current = null;
      setOpenState(false);

      // BEFORE the mode branch: `handleAuthSuccess` does a full-page
      // `window.location.assign`, so anything queued after it never runs.
      // The caller was promised this fires on every success, and a caller
      // that resumes an interrupted action (`/invite`) is exactly the one
      // a navigate-mode open would otherwise silently drop.
      onDone?.();

      if (modeRef.current === "navigate") {
        // `handleAuthSuccess` owns the cookie write and the `?redirect=`
        // sanitising. It reads the query off `window.location`, which on
        // /login is exactly the `?redirect=` proxy.ts set.
        handleAuthSuccess({
          tokenValue: session.token.value,
          tokenName: session.token.name,
        });
        return;
      }

      // Stay put: re-fetch everything that was resolved as signed-out.
      queryClient.invalidateQueries({ queryKey: userKeys.info });
      queryClient.invalidateQueries({ queryKey: userKeys.credits });
      router.refresh();
    },
    [queryClient, router, setOpenState]
  );

  const onEvent = useCallback(
    (event: Parameters<NonNullable<React.ComponentProps<typeof AuthDialog>["onEvent"]>>[0]) => {
      switch (event.type) {
        case "signed_in": {
          const userId = event.session.userId ?? event.session.identifier.account;
          const isEmail = event.session.identifier.kind === "email";
          posthog.identify(userId, {
            [isEmail ? "email" : "phone"]: event.session.identifier.account,
          });
          posthog.capture("user_logged_in", {
            method: event.method === "password" ? "password" : event.session.identifier.kind,
          });
          axonLogin({
            user_id: userId,
            email: isEmail ? event.session.identifier.account.toLowerCase() : undefined,
          });
          break;
        }
        case "registered": {
          const userId = event.session.userId ?? event.session.identifier.account;
          const isEmail = event.session.identifier.kind === "email";
          posthog.capture("user_registered", {
            method: event.session.identifier.kind,
            has_referral_code: Boolean(readReferralCode()),
          });
          axonSignUp(event.session.identifier.kind, {
            user_id: userId,
            email: isEmail ? event.session.identifier.account.toLowerCase() : undefined,
          });
          break;
        }
        case "invite_bound":
          posthog.capture("referral_code_bound");
          break;
        default:
          break;
      }
    },
    []
  );

  const value = useMemo<AuthDialogContextValue>(
    () => ({ open, close, isOpen }),
    [open, close, isOpen]
  );

  return (
    <AuthDialogContext.Provider value={value}>
      <Suspense fallback={null}>
        <ReferralCapture />
      </Suspense>
      {children}
      <AuthDialog
        key={sessionKey}
        open={isOpen}
        onOpenChange={handleOpenChange}
        t={t}
        transport={transport}
        onSuccess={onSuccess}
        onEvent={onEvent}
        steps={{ profile: true, invite: true }}
        initialMode={intent}
        resolveAvatarUrl={resolveAvatarUrl}
        initialIdentifier={identifier}
        initialInviteCode={inviteCode}
        brand={<AuthBrand />}
        legal={<AuthLegal locale={locale} />}
      />
    </AuthDialogContext.Provider>
  );
}

/**
 * Stashes the referrer's code on every page, not just the ones that open
 * the dialog: the code rides a deep link (`?recommendationCode=`, or one
 * buried in `?redirect=`) that may be several navigations behind by the
 * time the visitor decides to sign up.
 *
 * Keyed on the query string as well as the path — a `router.replace` that
 * only APPENDS the code (same route, new search) is a real entry shape,
 * and a pathname-only key ignores it.
 *
 * Its own component behind `<Suspense>` because `useSearchParams()` opts
 * the client tree up to the nearest boundary out of static rendering;
 * isolating it keeps that cost on a component that renders nothing. It is
 * NOT what makes `open()` correct — `open()` captures for itself — so a
 * suspended first paint cannot drop a code.
 */
function ReferralCapture() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    // `window.location.search` rather than the re-serialized `search`:
    // this is the string the URL actually carries.
    captureReferralCode(window.location.search);
  }, [pathname, search]);
  return null;
}

function AuthBrand() {
  return (
    <Image
      src="/logo.png"
      alt="FizzDragon"
      width={439}
      height={78}
      priority
      className="h-7 w-auto"
    />
  );
}

/**
 * Terms + privacy + the zero-tolerance acknowledgement.
 *
 * The deleted pages gated submit behind an explicit checkbox. The
 * one-button flow has no separate "register" action to gate, so consent
 * is carried by the continue action itself and stated here — the
 * wording, including the zero-tolerance sentence the app stores require,
 * is unchanged and still links to the same in-app legal routes.
 */
function AuthLegal({ locale }: { locale: Locale }) {
  const t = useTranslations("auth");
  return (
    <>
      {t("agreePrefix")}{" "}
      <a
        href={localizePath("/terms-of-service", locale)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground underline-offset-2 hover:underline"
      >
        {t("terms")}
      </a>{" "}
      {t("and")}{" "}
      <a
        href={localizePath("/privacy-policy", locale)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground underline-offset-2 hover:underline"
      >
        {t("privacy")}
      </a>
      {t("agreementZeroTolerance") ? ` ${t("agreementZeroTolerance")}` : null}
    </>
  );
}
