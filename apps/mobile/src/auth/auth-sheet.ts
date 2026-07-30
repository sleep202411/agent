import { router as imperativeRouter, type ImperativeRouter } from "expo-router";

import { toHref } from "@/lib/navigation";

import type { AuthState } from "./types";

export type AuthSheetMode = "login" | "register" | "forgot-password";

export interface AuthSheetOptions {
  mode?: AuthSheetMode;
  onAuthenticated?: () => void;
  /** Replace the current route instead of pushing it — for must-login deep
   *  links where returning to the locked screen makes no sense. Default: push. */
  replace?: boolean;
}

// Register is no longer a separate product surface — Continue on /login covers
// both sign-in and auto-register. Keep the mode so old callers still open auth.
const AUTH_ROUTES: Record<AuthSheetMode, string> = {
  "forgot-password": "/forgot-password",
  login: "/login",
  register: "/login",
};

const COMPLETION_DELAY_MS = 260;

let pendingRequest: AuthSheetOptions | undefined;
let completingAuth = false;
let authSheetOpen = false;

function navigateToAuth(mode: AuthSheetMode, replace: boolean) {
  const href = toHref(AUTH_ROUTES[mode]);
  // Already in the flow: swap screens in place so only ONE auth route is ever
  // on the stack — that keeps a single back() exiting the whole flow cleanly.
  if (authSheetOpen) {
    imperativeRouter.replace(href);
    return;
  }

  authSheetOpen = true;
  if (replace) imperativeRouter.replace(href);
  else imperativeRouter.push(href);
}

function flushPendingRequest(request: AuthSheetOptions | undefined) {
  if (!request?.onAuthenticated) return;
  request.onAuthenticated();
}

export function openAuthSheet(options: AuthSheetOptions = {}) {
  const mode = options.mode ?? "login";
  pendingRequest = options.onAuthenticated ? options : pendingRequest;
  navigateToAuth(mode, options.replace ?? false);
}

export function cancelPendingAuthRequest() {
  authSheetOpen = false;
  if (completingAuth) return;
  pendingRequest = undefined;
}

/**
 * Flush the pending `onAuthenticated` callback without navigating — used when
 * the auth stack is already leaving (e.g. onboarding abandoned mid-flow) so the
 * caller that opened auth still runs.
 */
export function releasePendingAuthRequest() {
  if (completingAuth) return;
  const request = pendingRequest;
  pendingRequest = undefined;
  authSheetOpen = false;
  setTimeout(() => {
    flushPendingRequest(request);
  }, COMPLETION_DELAY_MS);
}

export function completeAuthSheet(router: ImperativeRouter) {
  if (completingAuth) return;

  completingAuth = true;
  const request = pendingRequest;
  pendingRequest = undefined;
  authSheetOpen = false;

  if (router.canDismiss()) {
    router.dismissAll();
  }
  if (router.canGoBack()) router.back();
  else router.replace(toHref("/"));

  setTimeout(() => {
    completingAuth = false;
    flushPendingRequest(request);
  }, COMPLETION_DELAY_MS);
}

/** Dismiss the auth flow WITHOUT authenticating — the "skip / browse first"
 *  affordance. Returns the guest to where they were. */
export function skipAuthSheet(router: ImperativeRouter) {
  cancelPendingAuthRequest();
  if (router.canGoBack()) router.back();
  else router.replace(toHref("/"));
}

export function requireAuthenticated(auth: AuthState, options: AuthSheetOptions = {}): boolean {
  if (auth.status === "authenticated") {
    options.onAuthenticated?.();
    return true;
  }

  openAuthSheet(options);
  return false;
}
