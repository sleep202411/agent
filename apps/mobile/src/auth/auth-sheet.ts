import { router as imperativeRouter, type ImperativeRouter } from "expo-router";

import { toHref } from "@/lib/navigation";

import type { AuthState } from "./types";

export type AuthSheetMode = "login" | "register" | "forgot-password";

export interface AuthSheetOptions {
  mode?: AuthSheetMode;
  onAuthenticated?: () => void;
}

const AUTH_ROUTES: Record<AuthSheetMode, string> = {
  "forgot-password": "/forgot-password",
  login: "/login",
  register: "/register",
};

const COMPLETION_DELAY_MS = 260;

let pendingRequest: AuthSheetOptions | undefined;
let completingAuth = false;
let authSheetOpen = false;

function navigateToAuth(mode: AuthSheetMode) {
  const href = toHref(AUTH_ROUTES[mode]);
  if (authSheetOpen) {
    imperativeRouter.replace(href);
    return;
  }

  authSheetOpen = true;
  imperativeRouter.push(href);
}

function flushPendingRequest(request: AuthSheetOptions | undefined) {
  if (!request?.onAuthenticated) return;
  request.onAuthenticated();
}

export function openAuthSheet(options: AuthSheetOptions = {}) {
  const mode = options.mode ?? "login";
  pendingRequest = options.onAuthenticated ? options : pendingRequest;
  navigateToAuth(mode);
}

export function cancelPendingAuthRequest() {
  authSheetOpen = false;
  if (completingAuth) return;
  pendingRequest = undefined;
}

export function completeAuthSheet(router: ImperativeRouter) {
  if (completingAuth) return;

  completingAuth = true;
  const request = pendingRequest;
  pendingRequest = undefined;
  authSheetOpen = false;

  if (router.canDismiss()) router.dismiss();
  else router.replace(toHref("/"));

  setTimeout(() => {
    completingAuth = false;
    flushPendingRequest(request);
  }, COMPLETION_DELAY_MS);
}

export function requireAuthenticated(auth: AuthState, options: AuthSheetOptions = {}): boolean {
  if (auth.status === "authenticated") {
    options.onAuthenticated?.();
    return true;
  }

  openAuthSheet(options);
  return false;
}
