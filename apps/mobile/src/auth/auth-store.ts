import { setApiTokenProvider, setUnauthorizedHandler, ApiRequestError } from "@/lib/api-client";

import {
  bindInviteCode,
  getCurrentUser,
  loginWithCode,
  loginWithPassword,
  logout,
  normalizeIdentifier,
  resetPasswordWithIdentifier,
  setAccountPassword,
  type NormalizedIdentifier,
  updateUserNickname,
} from "./auth-service";
import { clearPendingCode } from "./pending-code";
import { clearStoredSession, readStoredSession, writeStoredSession } from "./token-storage";
import type { AuthSession, AuthState, SignInCredentials } from "./types";

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

    // Persisted sessions are never "new user" for onboarding purposes.
    setState(toAuthenticatedState({ ...storedSession, isNewUser: false }));

    try {
      const freshUser = await getCurrentUser();
      if (!freshUser) {
        setState(toAuthenticatedState({ ...storedSession, isNewUser: false }));
        return;
      }

      await replaceSession({
        ...storedSession,
        isNewUser: false,
        updatedAt: new Date().toISOString(),
        user: freshUser,
      });
    } catch (error) {
      if (isUnauthorized(error)) {
        await clearAuthSession();
        return;
      }

      setState(
        toAuthenticatedState({ ...storedSession, isNewUser: false }, messageFromError(error))
      );
    }
  })().finally(() => {
    hydratePromise = undefined;
  });

  return hydratePromise;
}

/** OTP Continue path — may auto-register; returns `isNewUser` on the session. */
export async function continueWithCode(identifier: NormalizedIdentifier, code: string) {
  setState({ ...state, error: undefined, status: "submitting" });

  try {
    const session = await loginWithCode(identifier, code);
    clearPendingCode();
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

/** Secondary password login (`type=pwd`). Never auto-registers. */
export async function signIn(credentials: SignInCredentials) {
  setState({ ...state, error: undefined, status: "submitting" });

  try {
    const identifier = normalizeIdentifier(credentials.identifier);
    if (!identifier) throw new Error("Enter a valid phone number or email.");
    const session = await loginWithPassword(identifier, credentials.password);
    clearPendingCode();
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

/**
 * Reset password then sign in — web auth-flow parity (`resetPassword` returns
 * a session; mobile previously only mutated the password and bounced to login).
 */
export async function resetPasswordAndSignIn(params: {
  identifier: string;
  code: string;
  password: string;
}) {
  setState({ ...state, error: undefined, status: "submitting" });

  try {
    const session = await resetPasswordWithIdentifier(params);
    clearPendingCode();
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

export async function saveOnboardingNickname(nickName: string) {
  await updateUserNickname(nickName);
  // Keep isNewUser through invite — refreshCurrentUser would clear it.
  const session = state.session;
  if (session) {
    await replaceSession({
      ...session,
      isNewUser: true,
      updatedAt: new Date().toISOString(),
      user: { ...session.user, nickName, nickname: nickName },
    });
  }
}

export async function submitInviteCode(recommendationCode: string) {
  await bindInviteCode(recommendationCode);
}

export async function saveAccountPassword(password: string, oldPassword?: string) {
  await setAccountPassword(password, oldPassword);
}

export async function refreshCurrentUser() {
  const session = state.session;
  if (!session) return undefined;

  const user = await getCurrentUser();
  if (!user) return session.user;

  await replaceSession({
    ...session,
    isNewUser: false,
    updatedAt: new Date().toISOString(),
    user,
  });
  return user;
}

/** Clear the one-shot onboarding flag without a network round-trip. */
export async function clearIsNewUserFlag() {
  const session = state.session;
  if (!session?.isNewUser) return;
  await replaceSession({ ...session, isNewUser: false });
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

setApiTokenProvider(() => {
  const token = state.session?.token;
  return token ? { name: token.tokenName, value: token.tokenValue } : undefined;
});
setUnauthorizedHandler(() => {
  void clearAuthSession();
});
