// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { getAuthUser, logout } from "./auth";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.cookie = "satoken=; path=/; max-age=0";
});
it("clears logout cookies before a delayed response and preserves a later login", async () => {
  let finish!: (r: Response) => void;
  let sent = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      sent = document.cookie;
      return new Promise<Response>((r) => {
        finish = r;
      });
    })
  );
  document.cookie = "satoken=old; path=/";
  const pending = logout();
  expect(sent).toContain("satoken=old");
  expect(document.cookie).not.toContain("satoken=");
  document.cookie = "satoken=new; path=/";
  finish(new Response(null, { status: 204 }));
  await pending;
  expect(document.cookie).toContain("satoken=new");
});
it("bounds stalled revocation and keeps local logout after synchronous transport failure", async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, init: RequestInit) => {
      signal = init.signal!;
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason))
      );
    })
  );
  const pending = logout();
  await vi.advanceTimersByTimeAsync(30_000);
  await pending;
  expect(signal.aborted).toBe(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("unavailable");
    })
  );
  document.cookie = "satoken=old; path=/";
  await logout();
  expect(document.cookie).not.toContain("satoken=");
});
it("cancels current-user response consumption without returning stale identity", async () => {
  const controller = new AbortController();
  let finish!: (value: unknown) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((r) => {
            finish = r;
          }),
      })
    )
  );
  const pending = getAuthUser(controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  controller.abort();
  finish({ data: { id: "old-user" } });
  await rejected;
  expect(fetch).toHaveBeenCalledWith(
    "/aurora/users/me",
    expect.objectContaining({ signal: controller.signal })
  );
});

it("accepts the official React Query callback context", async () => {
  const controller = new AbortController();
  const request = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
  vi.stubGlobal("fetch", request);
  expect(await getAuthUser({ signal: controller.signal })).toBeNull();
  expect(request.mock.calls[0][1].signal).toBe(controller.signal);
});
