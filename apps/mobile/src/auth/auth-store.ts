import { setApiTokenProvider, setUnauthorizedHandler, ApiRequestError } from "@/lib/api-client";

import {
  getCurrentUser,
  logout,
  registerWithIdentifier,
  signInWithIdentifier,
} from "./auth-service";
import { clearStoredSession, readStoredSession, writeStoredSession } from "./token-storage";
import type { AuthSession, AuthState, RegisterCredentials, SignInCredentials } from "./types";

const listeners = new Set<() => void>();

let state: AuthState = {
  status: "hydrating",
};

let hydratePromise: Promise<void> | undefined;

function emit() {
  for (const listener of listeners) listener();
}

function setState(nextState: AuthState) {
  state = nextState;
  emit();
}

function messageFromError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Request failed";
}

function isUnauthorized(error: unknown) {
  return error instanceof ApiRequestError && error.status === 401;
}

function toAuthenticatedState(session: AuthSession, error?: string): AuthState {
  return {
    error,
    session,
    status: "authenticated",
    user: session.user,
  };
}

async function replaceSession(session: AuthSession, error?: string) {
  await writeStoredSession(session);
  setState(toAuthenticatedState(session, error));
}

export function subscribeAuth(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAuthSnapshot() {
  return state;
}

export async function hydrateAuthSession() {
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    setState({ ...state, status: "hydrating" });
    const storedSession = await readStoredSession();
    if (!storedSession) {
      setState({ status: "anonymous" });
      return;
    }

    setState(toAuthenticatedState(storedSession));

    try {
      const freshUser = await getCurrentUser();
      if (!freshUser) {
        setState(toAuthenticatedState(storedSession));
        return;
      }

      await replaceSession({
        ...storedSession,
        updatedAt: new Date().toISOString(),
        user: freshUser,
      });
    } catch (error) {
      if (isUnauthorized(error)) {
        await clearAuthSession();
        return;
      }

      setState(toAuthenticatedState(storedSession, messageFromError(error)));
    }
  })().finally(() => {
    hydratePromise = undefined;
  });

  return hydratePromise;
}

export async function signIn(credentials: SignInCredentials) {
  setState({ ...state, error: undefined, status: "submitting" });

  try {
    const session = await signInWithIdentifier(credentials);
    await replaceSession(session);
    return session;
  } catch (error) {
    setState({
      error: messageFromError(error),
      status: "anonymous",
    });
    throw error;
  }
}

export async function register(credentials: RegisterCredentials) {
  setState({ ...state, error: undefined, status: "submitting" });

  try {
    const session = await registerWithIdentifier(credentials);
    await replaceSession(session);
    return session;
  } catch (error) {
    setState({
      error: messageFromError(error),
      status: "anonymous",
    });
    throw error;
  }
}

export async function refreshCurrentUser() {
  const session = state.session;
  if (!session) return undefined;

  const user = await getCurrentUser();
  if (!user) return session.user;

  await replaceSession({
    ...session,
    updatedAt: new Date().toISOString(),
    user,
  });
  return user;
}

export async function clearAuthSession() {
  await clearStoredSession();
  setState({ status: "anonymous" });
}

export async function signOut(options: { remote?: boolean } = {}) {
  const remote = options.remote ?? true;
  if (remote) {
    try {
      await logout();
    } catch {
      // Local session cleanup is authoritative for the app shell.
    }
  }

  await clearAuthSession();
}

setApiTokenProvider(() => state.session?.token?.tokenValue);
setUnauthorizedHandler(() => {
  void clearAuthSession();
});
