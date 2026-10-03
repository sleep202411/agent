// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { useRechargeAttempt } from "./use-recharge-attempt";
const state = vi.hoisted(() => ({ id: "a", create: vi.fn() }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: state.id }, isCurrentAccount: (id: string) => id === state.id }),
}));
vi.mock("./billing", () => ({ createComputeCustomRecharge: state.create }));
let owner: ReturnType<typeof useRechargeAttempt>, root: Root, host: HTMLDivElement;
function Probe() {
  const current = useRechargeAttempt();
  useLayoutEffect(() => {
    owner = current;
  }, [current]);
  return null;
}
const input = {
  amountDollars: 50,
  workspaceId: "team",
  successUrl: "https://example.test/en-US/settings/billing",
  backUrl: "https://example.test/en-US/settings/billing",
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.id = "a";
  state.create.mockReset();
  host = document.createElement("div");
  root = createRoot(host);
  act(() => root.render(<Probe />));
});
afterEach(() => {
  act(() => root.unmount());
});
it("reuses the order key for a failed attempt and starts a fresh key after completion", async () => {
  state.create
    .mockRejectedValueOnce(new Error("Timeout"))
    .mockResolvedValue({ order: { id: "order" } });
  await expect(owner.request(input)).rejects.toThrow("Timeout");
  owner.finish();
  await owner.request(input);
  owner.complete();
  owner.finish();
  await owner.request(input);
  const keys = state.create.mock.calls.map(([value]) => value.idempotencyKey);
  expect(keys[0]).toBe(keys[1]);
  expect(keys[2]).not.toBe(keys[1]);
});
it("cancels on departure and ignores a late response", async () => {
  let resolve!: (v: unknown) => void;
  state.create.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const promise = owner.request(input);
  const signal = state.create.mock.calls[0]![1] as AbortSignal;
  act(() => root.render(null));
  expect(signal.aborted).toBe(true);
  resolve({ order: { id: "late" } });
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
});
it("blocks redirect continuation as soon as the account changes", () => {
  state.id = "b";
  expect(owner.assertCurrent).toThrow("Payment session changed");
});
it("duplicate attempts cannot unlock the in-flight request", async () => {
  state.create.mockImplementation(() => new Promise(() => {}));
  void owner.request(input);
  const error = await owner.request(input).catch((e) => e);
  owner.finish(error);
  await expect(owner.request(input)).rejects.toMatchObject({ name: "AbortError" });
  expect(state.create).toHaveBeenCalledOnce();
  owner.cancel();
});
