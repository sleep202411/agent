import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthState } from "./types";
const mocks = vi.hoisted(() => ({
  generation: 0,
  state: { status: "anonymous" } as AuthState,
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  dismissAll: vi.fn(),
  canDismiss: vi.fn(),
  canGoBack: vi.fn(),
}));
vi.mock("expo-router", () => ({ router: mocks }));
vi.mock("@/lib/navigation", () => ({ toHref: (path: string) => path }));
vi.mock("./auth-store", () => ({
  getAuthGeneration: () => mocks.generation,
  getAuthSnapshot: () => mocks.state,
}));
let sheet: typeof import("./auth-sheet");
const router = mocks as unknown as import("expo-router").ImperativeRouter;
function login(id = "alice") {
  mocks.generation += 1;
  mocks.state = {
    status: "authenticated",
    user: { id },
    session: {
      user: { id },
      region: "global",
      updatedAt: "now",
      token: { tokenName: "satoken", tokenValue: id },
    },
  };
}
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.generation = 0;
  mocks.state = { status: "anonymous" };
  mocks.canGoBack.mockReturnValue(true);
  mocks.canDismiss.mockReturnValue(false);
  sheet = await import("./auth-sheet");
});
afterEach(() => vi.useRealTimers());
it("runs a completed callback once while normal auth-layout cleanup occurs", async () => {
  const done = vi.fn();
  sheet.openAuthSheet({ onAuthenticated: done });
  login();
  sheet.completeAuthSheet(router);
  sheet.cancelPendingAuthRequest();
  sheet.completeAuthSheet(router);
  await vi.advanceTimersByTimeAsync(260);
  expect(done).toHaveBeenCalledTimes(1);
  expect(mocks.back).toHaveBeenCalledTimes(1);
});
it.each(["logout", "replacement"])("rejects deferred completion after %s", async (kind) => {
  const done = vi.fn();
  sheet.openAuthSheet({ onAuthenticated: done });
  login();
  sheet.completeAuthSheet(router);
  if (kind === "logout") {
    mocks.generation += 1;
    mocks.state = { status: "anonymous" };
  } else login("bob");
  await vi.advanceTimersByTimeAsync(260);
  expect(done).not.toHaveBeenCalled();
});
it("new sheet intent replaces a scheduled callback and opening without a callback drops the old intent", async () => {
  const old = vi.fn();
  sheet.openAuthSheet({ onAuthenticated: old });
  login();
  sheet.completeAuthSheet(router);
  sheet.openAuthSheet();
  await vi.advanceTimersByTimeAsync(260);
  expect(old).not.toHaveBeenCalled();
  sheet.completeAuthSheet(router);
  await vi.advanceTimersByTimeAsync(260);
  expect(old).not.toHaveBeenCalled();
});
it("allows profile refresh within the same generation but cancels explicitly skipped completion", async () => {
  const done = vi.fn();
  sheet.openAuthSheet({ onAuthenticated: done });
  login();
  sheet.releasePendingAuthRequest();
  mocks.state = { ...mocks.state, user: { id: "alice", nickName: "fresh" } };
  await vi.advanceTimersByTimeAsync(260);
  expect(done).toHaveBeenCalledTimes(1);
  sheet.openAuthSheet({ onAuthenticated: done });
  sheet.releasePendingAuthRequest();
  sheet.skipAuthSheet(router);
  await vi.advanceTimersByTimeAsync(260);
  expect(done).toHaveBeenCalledTimes(1);
});
it("does not run a gate captured for a different account or navigate unauthenticated completion", () => {
  const done = vi.fn();
  sheet.completeAuthSheet(router);
  expect(mocks.back).not.toHaveBeenCalled();
  login();
  const old = mocks.state;
  login("bob");
  expect(sheet.requireAuthenticated(old, { onAuthenticated: done })).toBe(false);
  expect(done).not.toHaveBeenCalled();
  expect(sheet.requireAuthenticated(mocks.state, { onAuthenticated: done })).toBe(true);
  expect(done).toHaveBeenCalledTimes(1);
});
it("releases the completion guard after navigation failure so the current request can retry", async () => {
  const done = vi.fn();
  sheet.openAuthSheet({ onAuthenticated: done });
  login();
  mocks.back.mockImplementationOnce(() => {
    throw new Error("Navigation unavailable");
  });
  expect(() => sheet.completeAuthSheet(router)).toThrow("Navigation unavailable");
  sheet.completeAuthSheet(router);
  await vi.advanceTimersByTimeAsync(260);
  expect(done).toHaveBeenCalledTimes(1);
});
