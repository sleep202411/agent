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
import { clearSessionCookies, persistSessionCookie } from "./session-cookie";
import { clearPendingCode } from "./pending-code";
import { clearStoredSession, readStoredSession, writeStoredSession } from "./token-storage";
import type { AuthSession, AuthState, SignInCredentials } from "./types";

const listeners = new Set<() => void>();

let state: AuthState = {
  status: "hydrating",
};

let hydratePromise: Promise<void> | undefined;
let generation = 0;
let profileRevision = 0;
let storageTail: Promise<void> = Promise.resolve();

// SecureStore writes cannot be cancelled. Serialize them so a late old write
// cannot land after a newer login or local logout has persisted.
function withStorage<T>(work: () => Promise<T>): Promise<T> {
  const result = storageTail.then(work);
  storageTail = result.then(
    () => {},
    () => {}
  );
  return result;
}
function abandonedLogin() {
  const error = new Error("Authentication request was superseded.");
  error.name = "AbortError";
  return error;
}

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

async function replaceSession(session: AuthSession, current: () => boolean, error?: string) {
  return withStorage(async () => {
    if (!current()) return false;
    await writeStoredSession(session);
    if (!current()) return false;
    persistSessionCookie(session.token);
    setState(toAuthenticatedState(session, error));
    return true;
  });
}

async function authenticate(request: () => Promise<AuthSession>) {
  const owner = ++generation;
  const previousToken = state.session?.token;
  profileRevision += 1;
  setState({ status: "submitting" });
  try {
    const session = await request();
    if (generation !== owner) throw abandonedLogin();
    if (!(await replaceSession(session, () => generation === owner)) || generation !== owner)
      throw abandonedLogin();
    clearPendingCode();
    return session;
  } catch (error) {
    if (generation === owner) {
      let message = messageFromError(error);
      try {
        clearSessionCookies(previousToken);
      } catch (cookieError) {
        message += ` (${messageFromError(cookieError)})`;
      }
      try {
        await withStorage(async () => {
          if (generation === owner) await clearStoredSession();
        });
      } catch (storageError) {
        message += ` (${messageFromError(storageError)})`;
      }
      if (generation === owner) setState({ status: "anonymous", error: message });
    }
    throw error;
  }
}

export function subscribeAuth(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** In-memory identity generation; profile refreshes do not change it. */
export function getAuthGeneration() {
  return generation;
}

export function getAuthSnapshot() {
  return state;
}

export async function hydrateAuthSession() {
  if (hydratePromise) return hydratePromise;
  if (state.status !== "hydrating") return;
  const owner = generation;
  const current = () => generation === owner;
  const pending = (async () => {
    try {
      const storedSession = await withStorage(readStoredSession);
      if (!current()) return;
      if (!storedSession) {
        setState({ status: "anonymous" });
        return;
      }
      const restored = { ...storedSession, isNewUser: false };
      setState(toAuthenticatedState(restored));
      const revision = profileRevision;
      const currentProfile = () => current() && profileRevision === revision;
      try {
        const freshUser = await getCurrentUser(storedSession.token);
        if (!currentProfile() || !freshUser) return;
        await replaceSession(
          { ...restored, updatedAt: new Date().toISOString(), user: freshUser },
          currentProfile
        );
      } catch (error) {
        if (!currentProfile()) return;
        if (isUnauthorized(error)) {
          await clearAuthSession();
          return;
        }
        setState(toAuthenticatedState(restored, messageFromError(error)));
      }
    } catch (error) {
      if (current()) setState({ status: "anonymous", error: messageFromError(error) });
    }
  })();
  hydratePromise = pending;
  try {
    await pending;
  } finally {
    if (hydratePromise === pending) hydratePromise = undefined;
  }
}

/** OTP Continue path — may auto-register; returns `isNewUser` on the session. */
export async function continueWithCode(identifier: NormalizedIdentifier, code: string) {
  return authenticate(() => loginWithCode(identifier, code));
}

/** Secondary password login (`type=pwd`). Never auto-registers. */
export async function signIn(credentials: SignInCredentials) {
  return authenticate(() => {
    const identifier = normalizeIdentifier(credentials.identifier);
    if (!identifier) return Promise.reject(new Error("Enter a valid phone number or email."));
    return loginWithPassword(identifier, credentials.password);
  });
}

/** Reset the password and establish the returned session. */
export async function resetPasswordAndSignIn(params: {
  identifier: string;
  code: string;
  password: string;
}) {
  return authenticate(() => resetPasswordWithIdentifier(params));
}

export async function saveOnboardingNickname(nickName: string) {
  const session = state.session;
  if (!session) return;
  const owner = generation;
  const revision = ++profileRevision;
  await updateUserNickname(nickName);
  await replaceSession(
    {
      ...session,
      isNewUser: true,
      updatedAt: new Date().toISOString(),
      user: { ...session.user, nickName, nickname: nickName },
    },
    () => generation === owner && profileRevision === revision
  );
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
  const owner = generation;
  const revision = ++profileRevision;
  const current = () => generation === owner && profileRevision === revision;
  const user = await getCurrentUser(session.token);
  if (!current()) return undefined;
  if (!user) return session.user;
  const saved = await replaceSession(
    { ...session, isNewUser: false, updatedAt: new Date().toISOString(), user },
    current
  );
  return saved ? user : undefined;
}

/** Clear the one-shot onboarding flag without a network round-trip. */
export async function clearIsNewUserFlag() {
  const session = state.session;
  if (!session?.isNewUser) return;
  const owner = generation;
  const revision = ++profileRevision;
  await replaceSession(
    { ...session, isNewUser: false },
    () => generation === owner && profileRevision === revision
  );
}

export async function clearAuthSession() {
  const previousToken = state.session?.token;
  const owner = ++generation;
  profileRevision += 1;
  setState({ status: "anonymous" });
  let cleanupError: string | undefined;
  try {
    clearSessionCookies(previousToken);
  } catch (error) {
    cleanupError = messageFromError(error);
  }
  try {
    await withStorage(clearStoredSession);
  } catch (error) {
    cleanupError = [cleanupError, messageFromError(error)].filter(Boolean).join("; ");
  }
  if (cleanupError && generation === owner) setState({ status: "anonymous", error: cleanupError });
}

export async function signOut(options: { remote?: boolean } = {}) {
  // Dispatch while the old token is still available, then clear local access
  // immediately. The eventual remote result never touches a replacement login.
  const remote =
    (options.remote ?? true) && state.session ? logout().catch(() => {}) : Promise.resolve();
  await clearAuthSession();
  await remote;
}

setApiTokenProvider(() => {
  const token = state.session?.token;
  return token ? { name: token.tokenName, value: token.tokenValue } : undefined;
});
setUnauthorizedHandler(() => {
  void clearAuthSession();
});
