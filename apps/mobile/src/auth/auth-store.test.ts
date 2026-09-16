import { beforeEach, expect, it, vi } from "vitest";
import type { AuthSession } from "./types";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  clear: vi.fn(),
  user: vi.fn(),
  password: vi.fn(),
  code: vi.fn(),
  reset: vi.fn(),
  nickname: vi.fn(),
  logout: vi.fn(),
  pending: vi.fn(),
  cookie: vi.fn(),
  clearCookies: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({
  setApiTokenProvider: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  ApiRequestError: class extends Error {
    status = 401;
  },
}));
vi.mock("./session-cookie", () => ({
  persistSessionCookie: mocks.cookie,
  clearSessionCookies: mocks.clearCookies,
}));
vi.mock("./token-storage", () => ({
  readStoredSession: mocks.read,
  writeStoredSession: mocks.write,
  clearStoredSession: mocks.clear,
}));
vi.mock("./pending-code", () => ({ clearPendingCode: mocks.pending }));
vi.mock("./auth-service", () => ({
  getCurrentUser: mocks.user,
  loginWithPassword: mocks.password,
  loginWithCode: mocks.code,
  resetPasswordWithIdentifier: mocks.reset,
  updateUserNickname: mocks.nickname,
  logout: mocks.logout,
  normalizeIdentifier: (account: string) => ({ kind: "email", account }),
  bindInviteCode: vi.fn(),
  setAccountPassword: vi.fn(),
}));
let store: typeof import("./auth-store");
const session = (id: string): AuthSession => ({
  region: "global",
  user: { id },
  token: { tokenName: "satoken", tokenValue: id },
  updatedAt: "2026-09-13T00:00:00Z",
});
const credentials = { identifier: "alice@example.com", password: "password" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(undefined);
  mocks.write.mockResolvedValue(undefined);
  mocks.clear.mockResolvedValue(undefined);
  mocks.logout.mockResolvedValue(undefined);
  mocks.password.mockResolvedValue(session("alice"));
  store = await import("./auth-store");
});
it("ignores stored-session hydration returned after a newer login", async () => {
  const read = deferred<AuthSession>();
  mocks.read.mockReturnValueOnce(read.promise);
  const hydration = store.hydrateAuthSession();
  await Promise.resolve();
  const login = store.signIn(credentials);
  read.resolve(session("old"));
  await Promise.all([hydration, login]);
  expect(store.getAuthSnapshot().user?.id).toBe("alice");
  expect(mocks.user).not.toHaveBeenCalled();
  expect(mocks.write).toHaveBeenCalledTimes(1);
});
it("does not let a late hydration profile failure clear a replacement account", async () => {
  const user = deferred<{ id: string }>();
  mocks.read.mockResolvedValueOnce(session("old"));
  mocks.user.mockReturnValueOnce(user.promise);
  const hydration = store.hydrateAuthSession();
  await vi.waitFor(() => expect(mocks.user).toHaveBeenCalled());
  await store.signIn(credentials);
  const { ApiRequestError } = await import("@/lib/api-client");
  user.reject(new ApiRequestError("UNAUTHORIZED", "Unauthorized", 401));
  await hydration;
  expect(store.getAuthSnapshot().user?.id).toBe("alice");
  expect(mocks.clear).not.toHaveBeenCalled();
});
it.each(["code", "reset"] as const)(
  "rejects a superseded %s login without publishing it",
  async (kind) => {
    const old = deferred<AuthSession>();
    mocks[kind].mockReturnValueOnce(old.promise);
    const attempt =
      kind === "code"
        ? store.continueWithCode({ kind: "email", account: "old@example.com" }, "123456")
        : store.resetPasswordAndSignIn({
            identifier: "old@example.com",
            code: "123456",
            password: "password",
          });
    const result = attempt.catch((error: unknown) => error);
    await store.signIn(credentials);
    old.resolve(session("old"));
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(store.getAuthSnapshot().user?.id).toBe("alice");
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.pending).toHaveBeenCalledTimes(1);
  }
);
it("suppresses an old login failure after the newer login succeeds", async () => {
  const old = deferred<AuthSession>();
  mocks.password.mockReturnValueOnce(old.promise);
  const attempt = store.signIn(credentials).catch((error: unknown) => error);
  await store.signIn(credentials);
  old.reject(new Error("old failure"));
  await attempt;
  expect(store.getAuthSnapshot()).toMatchObject({ status: "authenticated", user: { id: "alice" } });
  expect(store.getAuthSnapshot().error).toBeUndefined();
});
it("serializes storage so a logout clear follows an already running login write", async () => {
  const write = deferred<void>();
  mocks.write.mockReturnValueOnce(write.promise);
  const login = store.signIn(credentials).catch((error: unknown) => error);
  await vi.waitFor(() => expect(mocks.write).toHaveBeenCalled());
  const clear = store.clearAuthSession();
  expect(store.getAuthSnapshot().status).toBe("anonymous");
  expect(mocks.clear).not.toHaveBeenCalled();
  write.resolve();
  await clear;
  expect(await login).toMatchObject({ name: "AbortError" });
  expect(mocks.clear).toHaveBeenCalledTimes(1);
  expect(store.getAuthSnapshot().status).toBe("anonymous");
});
it("clears local access before remote logout finishes and leaves a replacement login intact", async () => {
  await store.signIn(credentials);
  const remote = deferred<void>();
  mocks.logout.mockReturnValueOnce(remote.promise);
  const logout = store.signOut();
  expect(store.getAuthSnapshot().status).toBe("anonymous");
  mocks.password.mockResolvedValueOnce(session("bob"));
  await store.signIn(credentials);
  remote.reject(new Error("offline"));
  await logout;
  expect(store.getAuthSnapshot().user?.id).toBe("bob");
});
it("does not apply a delayed nickname update to a new account", async () => {
  await store.signIn(credentials);
  const nickname = deferred<void>();
  mocks.nickname.mockReturnValueOnce(nickname.promise);
  const update = store.saveOnboardingNickname("Alice nickname");
  mocks.password.mockResolvedValueOnce(session("bob"));
  await store.signIn(credentials);
  nickname.resolve();
  await update;
  expect(store.getAuthSnapshot().user).toEqual({ id: "bob" });
  expect(mocks.write).toHaveBeenCalledTimes(2);
});
it("preserves the latest requested profile and suppresses an earlier delayed refresh", async () => {
  await store.signIn(credentials);
  const old = deferred<{ id: string; nickName: string }>();
  mocks.user
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ id: "alice", nickName: "latest" });
  const first = store.refreshCurrentUser();
  await store.refreshCurrentUser();
  old.resolve({ id: "alice", nickName: "old" });
  expect(await first).toBeUndefined();
  expect(store.getAuthSnapshot().user?.nickName).toBe("latest");
});
it("surfaces a storage-read error without leaving authentication stuck hydrating", async () => {
  mocks.read.mockRejectedValueOnce(new Error("Keychain unavailable"));
  await store.hydrateAuthSession();
  expect(store.getAuthSnapshot()).toEqual({ status: "anonymous", error: "Keychain unavailable" });
});

it("persists a newer login after an old SecureStore write has already started", async () => {
  const write = deferred<void>();
  mocks.write.mockReturnValueOnce(write.promise);
  const old = store.signIn(credentials).catch((error: unknown) => error);
  await vi.waitFor(() => expect(mocks.write).toHaveBeenCalled());
  mocks.password.mockResolvedValueOnce(session("bob"));
  const replacement = store.signIn(credentials);
  write.resolve();
  await replacement;
  expect(await old).toMatchObject({ name: "AbortError" });
  expect(mocks.write.mock.calls.map(([value]) => (value as AuthSession).user.id)).toEqual([
    "alice",
    "bob",
  ]);
  expect(store.getAuthSnapshot().user?.id).toBe("bob");
});

it("publishes cookies only for accepted logins and clears a failed replacement's persisted session", async () => {
  await store.signIn(credentials);
  expect(mocks.cookie).toHaveBeenLastCalledWith(session("alice").token);
  mocks.password.mockRejectedValueOnce(new Error("Wrong password"));
  await expect(store.signIn(credentials)).rejects.toThrow("Wrong password");
  expect(mocks.clear).toHaveBeenCalledTimes(1);
  expect(mocks.clearCookies).toHaveBeenLastCalledWith(session("alice").token);
  expect(store.getAuthSnapshot().status).toBe("anonymous");
});
it("does not clear replacement persistence or publish an abandoned login cookie", async () => {
  const old = deferred<AuthSession>();
  mocks.password.mockReturnValueOnce(old.promise).mockResolvedValueOnce(session("bob"));
  const attempt = store.signIn(credentials).catch((error: unknown) => error);
  await store.signIn(credentials);
  old.reject(new Error("Old failure"));
  await attempt;
  expect(mocks.cookie).toHaveBeenCalledTimes(1);
  expect(mocks.cookie).toHaveBeenCalledWith(session("bob").token);
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(mocks.clearCookies).not.toHaveBeenCalled();
});
it("serializes failed-login cleanup before replacement persistence", async () => {
  const clear = deferred<void>();
  mocks.clear.mockReturnValueOnce(clear.promise);
  mocks.password
    .mockRejectedValueOnce(new Error("Login failed"))
    .mockResolvedValueOnce(session("bob"));
  const failed = store.signIn(credentials).catch((error: unknown) => error);
  await vi.waitFor(() => expect(mocks.clear).toHaveBeenCalled());
  const replacement = store.signIn(credentials);
  clear.resolve();
  await Promise.all([failed, replacement]);
  expect(store.getAuthSnapshot().user?.id).toBe("bob");
  expect(mocks.write).toHaveBeenLastCalledWith(session("bob"));
});

it("clears local access and persisted credentials even when browser cookie cleanup throws", async () => {
  await store.signIn(credentials);
  mocks.clearCookies.mockImplementationOnce(() => {
    throw new Error("Cookie storage denied");
  });
  await store.clearAuthSession();
  expect(mocks.clear).toHaveBeenCalledTimes(1);
  expect(store.getAuthSnapshot()).toMatchObject({
    status: "anonymous",
    error: "Cookie storage denied",
  });
});
it("finishes failed-login cleanup even if cookie publication and removal both fail", async () => {
  mocks.cookie.mockImplementationOnce(() => {
    throw new Error("Cookie publication denied");
  });
  mocks.clearCookies.mockImplementationOnce(() => {
    throw new Error("Cookie cleanup denied");
  });
  await expect(store.signIn(credentials)).rejects.toThrow("Cookie publication denied");
  expect(mocks.clear).toHaveBeenCalledTimes(1);
  expect(store.getAuthSnapshot().status).toBe("anonymous");
  expect(store.getAuthSnapshot().error).toContain("Cookie cleanup denied");
});
