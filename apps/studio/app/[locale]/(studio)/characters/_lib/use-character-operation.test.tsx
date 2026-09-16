// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useCharacterOperation } from "./use-character-operation";
const state = vi.hoisted(() => ({ user: "a" as string | null, scope: "character" }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: state.user ? { id: state.user } : null }),
}));
let root: Root;
let operation: ReturnType<typeof useCharacterOperation>;
const reset = vi.fn();
function Harness() {
  const current = useCharacterOperation(state.scope, reset);
  useLayoutEffect(() => {
    operation = current;
  });
  return null;
}
const render = () => act(async () => root.render(<Harness />));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.user = "a";
  state.scope = "character";
  reset.mockClear();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it("serializes overlapping mutations and releases an active failure for retry", async () => {
  await render();
  const first = operation.start()!;
  expect(operation.start()).toBeNull();
  expect(operation.isCurrent(first)).toBe(true);
  expect(operation.finish(first)).toBe(true);
  expect(operation.start()).not.toBeNull();
});
it.each(["account", "scope"])(
  "retires %s work and preserves its replacement against late cleanup",
  async (change) => {
    await render();
    const old = operation;
    const run = old.start()!;
    if (change === "account") state.user = "b";
    else state.scope = "other";
    await render();
    const replacement = operation.start()!;
    expect(reset).toHaveBeenCalledOnce();
    expect(run.signal.aborted).toBe(true);
    expect(replacement.signal.aborted).toBe(false);
    expect(old.isCurrent(run)).toBe(false);
    expect(old.finish(run)).toBe(false);
    expect(operation.isCurrent(replacement)).toBe(true);
    expect(old.start()).toBeNull();
  }
);
it("does not admit signed-out mutations", async () => {
  state.user = null;
  await render();
  expect(operation.start()).toBeNull();
});

it("aborts an active request on unmount", async () => {
  await render();
  const run = operation.start()!;
  await act(async () => root.render(null));
  expect(run.signal.aborted).toBe(true);
});
