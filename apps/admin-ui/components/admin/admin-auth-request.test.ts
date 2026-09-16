import { afterEach, expect, it, vi } from "vitest";
import { adminAuthRequest } from "./admin-auth-request";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it.each(["fetch", "body"])("bounds a stalled %s without retrying", async (stage) => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockImplementation(() =>
      stage === "fetch"
        ? new Promise(() => {})
        : Promise.resolve({ ok: true, json: () => new Promise(() => {}) })
    );
  vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController();
  const request = adminAuthRequest("/api/admin/auth/login", {}, controller);
  const result = expect(request).rejects.toThrow("Authentication timed out");
  await vi.advanceTimersByTimeAsync(30_000);
  await result;
  expect(controller.signal.aborted).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("settles explicit cancellation even if transport ignores its signal", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {}))
  );
  const controller = new AbortController();
  const request = adminAuthRequest("/api/admin/auth/login", {}, controller);
  const result = expect(request).rejects.toThrow("Abandoned");
  controller.abort(new Error("Abandoned"));
  await result;
  expect(vi.getTimerCount()).toBe(0);
});
it("releases the timeout after a complete response", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 200, data: { ok: true } }),
    })
  );
  const controller = new AbortController();
  await expect(adminAuthRequest("/api/admin/auth/login", {}, controller)).resolves.toEqual({
    ok: true,
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(controller.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
