import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useAuthFormOperation } from "./use-auth-form-operation";
const auth = vi.hoisted(() => ({ generation: 1 }));
vi.mock("./auth-store", () => ({ getAuthGeneration: () => auth.generation }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let action: ReturnType<typeof useAuthFormOperation>;
function Probe({ focused, identity }: { focused: boolean; identity: string }) {
  const current = useAuthFormOperation(identity, focused);
  useLayoutEffect(() => {
    action = current;
  });
  return null;
}
async function render(focused = true, identity = "login") {
  root ??= createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe, { focused, identity })));
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  auth.generation = 1;
});
it("claims rapid OTP/manual verification requests once and preserves its own login generation", async () => {
  const pending = deferred();
  const request = vi.fn(() => {
    auth.generation++;
    return pending.promise;
  });
  const done = vi.fn();
  const failed = vi.fn();
  await render();
  await act(async () => {
    void action.run(request, done, failed);
    void action.run(request, done, failed);
  });
  await render();
  expect(action.busy).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve());
  expect(done).toHaveBeenCalledTimes(1);
  expect(failed).not.toHaveBeenCalled();
  expect(action.busy).toBe(false);
});
it.each(["blur", "route", "unmount"])(
  "discards completion after %s and rejects retained callbacks",
  async (change) => {
    const pending = deferred();
    const request = vi.fn(() => pending.promise);
    const done = vi.fn();
    const failed = vi.fn();
    await render();
    const old = action.run;
    await act(async () => {
      void old(request, done, failed);
    });
    if (change === "unmount") {
      await act(async () => root!.unmount());
      root = undefined;
    } else await render(change !== "blur", change === "route" ? "reset" : "login");
    await act(async () => {
      void old(request, done, failed);
      pending.resolve();
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  }
);
it("releases a displaced generation for replacement work and preserves replacement pending state", async () => {
  const old = deferred();
  const next = deferred();
  const done = vi.fn();
  const failed = vi.fn();
  await render();
  const stale = action.run;
  await act(async () => {
    void stale(() => old.promise, done, failed);
  });
  auth.generation++;
  await render();
  expect(action.busy).toBe(false);
  const blocked = vi.fn(() => Promise.resolve());
  await act(async () => {
    void stale(blocked, done, failed);
    void action.run(() => next.promise, done, failed);
  });
  expect(blocked).not.toHaveBeenCalled();
  await act(async () => old.reject(new Error("old failure")));
  expect(failed).not.toHaveBeenCalled();
  expect(action.busy).toBe(true);
  await act(async () => next.resolve());
  expect(done).toHaveBeenCalledTimes(1);
});
it("reports active failures and admits manual retry without automatic resending", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("Code rejected"))
    .mockResolvedValueOnce(undefined);
  const done = vi.fn();
  const failed = vi.fn();
  await render();
  await act(async () => action.run(request, done, failed));
  expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: "Code rejected" }));
  expect(request).toHaveBeenCalledTimes(1);
  expect(action.busy).toBe(false);
  await act(async () => action.run(request, done, failed));
  expect(done).toHaveBeenCalledTimes(1);
});
