import { beforeEach, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/persistent-storage", () => ({
  getStoredString: storage.get,
  setStoredString: storage.set,
  deleteStoredString: storage.remove,
}));
vi.mock("@/i18n", () => ({ t: (key: string) => key }));
let pending: typeof import("./pending-code");
let clock: typeof import("./resend-clock");
const alice = { kind: "email" as const, account: "alice@example.com" };
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
  storage.get.mockResolvedValue(null);
  storage.set.mockResolvedValue(undefined);
  storage.remove.mockResolvedValue(undefined);
  pending = await import("./pending-code");
  clock = await import("./resend-clock");
});
it("ignores delayed pending-code hydration after a local clear", async () => {
  const read = deferred<string>();
  storage.get.mockReturnValueOnce(read.promise);
  const hydration = pending.hydratePendingCode();
  await Promise.resolve();
  pending.clearPendingCode();
  clock.armResendDeadline(Date.now() + 60000);
  read.resolve(JSON.stringify({ account: alice, mode: "signin" }));
  await hydration;
  expect(pending.readPendingCode()).toBeNull();
});
it("orders an active old write, deletion and replacement pending-code write", async () => {
  const oldWrite = deferred<void>();
  storage.set.mockReturnValueOnce(oldWrite.promise);
  pending.writePendingCode({ account: alice, mode: "signin" });
  await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));
  pending.clearPendingCode();
  pending.writePendingCode({ account: alice, mode: "reset" });
  expect(storage.remove).not.toHaveBeenCalled();
  oldWrite.resolve();
  await vi.waitFor(() => expect(storage.set).toHaveBeenCalledTimes(2));
  expect(storage.remove.mock.invocationCallOrder[0]).toBeGreaterThan(
    storage.set.mock.invocationCallOrder[0]
  );
  expect(storage.set.mock.invocationCallOrder[1]).toBeGreaterThan(
    storage.remove.mock.invocationCallOrder[0]
  );
  expect(JSON.parse(storage.set.mock.calls[1][1] as string).mode).toBe("reset");
});
it("does not restore a cleared cooldown from delayed hydration or accept nonfinite deadlines", async () => {
  const read = deferred<string>();
  storage.get.mockReturnValueOnce(read.promise);
  const hydration = clock.hydrateResendClock();
  await Promise.resolve();
  clock.clearResendDeadline();
  read.resolve(String(Date.now() + 60000));
  await hydration;
  expect(clock.readResendDeadline()).toBe(0);
  clock.armResendDeadline(Number.NaN);
  clock.armResendDeadline(Infinity);
  expect(clock.readResendDeadline()).toBe(0);
});
