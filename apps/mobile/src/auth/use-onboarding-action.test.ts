import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useOnboardingAction } from "./use-onboarding-action";
const auth = vi.hoisted(() => ({ generation: 1, token: "alice" }));
vi.mock("./auth-store", () => ({ getAuthGeneration: () => auth.generation }));
vi.mock("@/auth/use-auth", () => ({
  useAuth: () => ({
    status: "authenticated",
    generation: auth.generation,
    user: { id: "alice" },
    session: { token: { tokenName: "satoken", tokenValue: auth.token } },
  }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let action: ReturnType<typeof useOnboardingAction>;
function Probe() {
  const observed = useOnboardingAction("profile");
  useLayoutEffect(() => {
    action = observed;
  }, [observed]);
  return null;
}
async function render() {
  root ??= createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe)));
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
  auth.token = "alice";
});
it("admits one onboarding mutation and retains its error for retry", async () => {
  const request = deferred();
  const dispatch = vi.fn(() => request.promise);
  const done = vi.fn();
  await render();
  let first!: Promise<void>;
  await act(async () => {
    first = action.run(dispatch, done, "fallback");
    void action.run(dispatch, done, "fallback");
  });
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(action.busy).toBe(true);
  await act(async () => {
    request.reject(new Error("Nickname rejected"));
    await first;
  });
  expect(action.error).toBe("Nickname rejected");
  expect(action.busy).toBe(false);
  await act(async () => action.run(() => Promise.resolve(), done, "fallback"));
  expect(done).toHaveBeenCalledTimes(1);
  expect(action.error).toBeUndefined();
});
it("does not navigate after unmount", async () => {
  const request = deferred();
  const done = vi.fn();
  await render();
  let first!: Promise<void>;
  await act(async () => {
    first = action.run(() => request.promise, done, "fallback");
  });
  await act(async () => root!.unmount());
  root = undefined;
  await act(async () => {
    request.resolve();
    await first;
  });
  expect(done).not.toHaveBeenCalled();
});
it("releases replacement work even when a same-credential login displaces a stalled request", async () => {
  const old = deferred();
  const next = deferred();
  const done = vi.fn();
  await render();
  const oldRun = action.run;
  let first!: Promise<void>;
  await act(async () => {
    first = action.run(() => old.promise, done, "fallback");
  });
  auth.generation += 1;
  await render();
  expect(action.busy).toBe(false);
  const staleDispatch = vi.fn(() => Promise.resolve());
  await act(async () => oldRun(staleDispatch, done, "fallback"));
  expect(staleDispatch).not.toHaveBeenCalled();
  let second!: Promise<void>;
  await act(async () => {
    second = action.run(() => next.promise, done, "fallback");
  });
  await act(async () => {
    old.reject(new Error("old"));
    await first;
  });
  expect(action.busy).toBe(true);
  expect(action.error).toBeUndefined();
  await act(async () => {
    next.resolve();
    await second;
  });
  expect(done).toHaveBeenCalledTimes(1);
});
it("checks identity before a second awaited completion action publishes navigation", async () => {
  const finish = deferred();
  const navigate = vi.fn();
  await render();
  let first!: Promise<void>;
  await act(async () => {
    first = action.run(
      () => Promise.resolve(),
      async (current) => {
        await finish.promise;
        if (current()) navigate();
      },
      "fallback"
    );
  });
  auth.generation += 1;
  await render();
  await act(async () => {
    finish.resolve();
    await first;
  });
  expect(navigate).not.toHaveBeenCalled();
});
