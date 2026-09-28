import { router as imperativeRouter, type ImperativeRouter } from "expo-router";

import { toHref } from "@/lib/navigation";

import { getAuthGeneration, getAuthSnapshot } from "./auth-store";
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
let completionTimer: ReturnType<typeof setTimeout> | undefined;

function cancelCompletion() {
  if (completionTimer !== undefined) clearTimeout(completionTimer);
  completionTimer = undefined;
  completingAuth = false;
}

function scheduleCompletion(request: AuthSheetOptions | undefined, generation: number) {
  completingAuth = true;
  completionTimer = setTimeout(() => {
    completionTimer = undefined;
    completingAuth = false;
    if (getAuthGeneration() !== generation || getAuthSnapshot().status !== "authenticated") return;
    flushPendingRequest(request);
  }, COMPLETION_DELAY_MS);
}

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
  cancelCompletion();
  const mode = options.mode ?? "login";
  pendingRequest = options;
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
  if (getAuthSnapshot().status !== "authenticated") return;
  scheduleCompletion(request, getAuthGeneration());
}

export function completeAuthSheet(router: ImperativeRouter) {
  if (completingAuth || getAuthSnapshot().status !== "authenticated") return;
  const generation = getAuthGeneration();
  completingAuth = true;
  const request = pendingRequest;
  pendingRequest = undefined;
  authSheetOpen = false;
  try {
    if (router.canDismiss()) router.dismissAll();
    if (router.canGoBack()) router.back();
    else router.replace(toHref("/"));
  } catch (error) {
    completingAuth = false;
    pendingRequest = request;
    throw error;
  }
  scheduleCompletion(request, generation);
}

/** Dismiss the auth flow WITHOUT authenticating — the "skip / browse first"
 *  affordance. Returns the guest to where they were. */
export function skipAuthSheet(router: ImperativeRouter) {
  cancelCompletion();
  cancelPendingAuthRequest();
  if (router.canGoBack()) router.back();
  else router.replace(toHref("/"));
}

export function requireAuthenticated(auth: AuthState, options: AuthSheetOptions = {}): boolean {
  const current = getAuthSnapshot();
  // A retained gate from another authenticated account cannot authorize its
  // old action using the replacement account's credentials.
  if (
    auth.status === "authenticated" &&
    (current.status !== "authenticated" ||
      auth.session?.region !== current.session?.region ||
      auth.session?.token?.tokenName !== current.session?.token?.tokenName ||
      auth.session?.token?.tokenValue !== current.session?.token?.tokenValue ||
      (auth.user?.id ?? auth.user?.userId) !== (current.user?.id ?? current.user?.userId))
  )
    return false;
  if (current.status === "authenticated") {
    options.onAuthenticated?.();
    return true;
  }

  openAuthSheet(options);
  return false;
}
