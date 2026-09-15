import { act, createElement, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useAuthFormLifetime, useDelayedAuthFocus } from "./use-auth-form-lifetime";
const auth = vi.hoisted(() => ({ generation: 1 }));
vi.mock("./auth-store", () => ({ getAuthGeneration: () => auth.generation }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let lifetime: ReturnType<typeof useAuthFormLifetime>;
const focus = vi.fn();
function Probe({
  identity,
  focused,
  password,
}: {
  identity: string;
  focused: boolean;
  password: boolean;
}) {
  const current = useAuthFormLifetime(identity, focused);
  const target = useRef({ focus });
  useDelayedAuthFocus(target, focused && password, identity);
  useLayoutEffect(() => {
    lifetime = current;
  });
  return null;
}
async function render(identity = "login", focused = true, password = false) {
  root ??= createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe, { identity, focused, password })));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  auth.generation = 1;
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("preserves edits made before hydration and while returning to the same form", async () => {
  await render();
  const before = lifetime.capture(true);
  expect(before()).toBe(true);
  lifetime.markEdited();
  expect(before()).toBe(false);
  await render("login", false);
  await render();
  expect(lifetime.capture(true)()).toBe(false);
  expect(lifetime.capture()()).toBe(true);
});
it("does not revive callbacks after blur/refocus and resets edit protection only for a new destination", async () => {
  await render();
  const old = lifetime.capture();
  lifetime.markEdited();
  await render("login", false);
  await render();
  expect(old()).toBe(false);
  await render("reset");
  expect(lifetime.capture(true)()).toBe(true);
});
it("suppresses callbacks after replacement credentials or unmount", async () => {
  await render();
  const old = lifetime.capture();
  auth.generation++;
  expect(old()).toBe(false);
  const current = lifetime.capture();
  await act(async () => root!.unmount());
  root = undefined;
  expect(current()).toBe(false);
});
it("focuses the password input only after the delay and cancels superseded timers", async () => {
  vi.useFakeTimers();
  await render("login", true, true);
  await act(async () => vi.advanceTimersByTime(49));
  expect(focus).not.toHaveBeenCalled();
  await render("login", true, false);
  await act(async () => vi.advanceTimersByTime(1));
  expect(focus).not.toHaveBeenCalled();
  await render("login", true, true);
  await act(async () => vi.advanceTimersByTime(50));
  expect(focus).toHaveBeenCalledTimes(1);
});
it("does not focus after blur or credential replacement even before a rerender", async () => {
  vi.useFakeTimers();
  await render("login", true, true);
  auth.generation++;
  await act(async () => vi.advanceTimersByTime(50));
  expect(focus).not.toHaveBeenCalled();
  await render("login", true, true);
  await render("login", false, true);
  await act(async () => vi.advanceTimersByTime(50));
  expect(focus).not.toHaveBeenCalled();
});
