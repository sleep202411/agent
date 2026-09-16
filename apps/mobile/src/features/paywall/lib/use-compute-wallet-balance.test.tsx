import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useComputeWalletBalance } from "./use-compute-wallet-balance";

const harness = vi.hoisted(() => ({ status: "authenticated", generation: 1, get: vi.fn() }));
vi.mock("@/auth", () => ({ useAuth: () => harness }));
vi.mock("@/lib/api-client", () => ({ api: { get: (...args: unknown[]) => harness.get(...args) } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let latest: string | null;
function Harness() {
  const balance = useComputeWalletBalance();
  useLayoutEffect(() => {
    latest = balance;
  });
  return null;
}
const render = () => act(() => root.render(<Harness />));
const balance = (value: string) => ({ accounts: [{ status: "active", availableBalance: value }] });
beforeEach(() => {
  harness.status = "authenticated";
  harness.generation = 1;
  harness.get.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));

it("cancels abandoned balance reads and suppresses delayed results after account replacement", async () => {
  let resolveOld!: (value: unknown) => void;
  harness.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      })
  );
  render();
  const old = harness.get.mock.calls[0][1] as { signal: AbortSignal; cache: string };
  expect(old.cache).toBe("no-store");
  harness.generation = 2;
  harness.get.mockResolvedValueOnce(balance("25"));
  await act(async () => render());
  expect(old.signal.aborted).toBe(true);
  expect(latest).toBe("25");
  await act(async () => resolveOld(balance("900")));
  expect(latest).toBe("25");
});

it("clears loaded data immediately on logout and reads again for a new session", async () => {
  harness.get.mockResolvedValue(balance("81"));
  await act(async () => render());
  expect(latest).toBe("81");
  harness.status = "anonymous";
  harness.generation = 2;
  render();
  expect(latest).toBeNull();
  expect(harness.get).toHaveBeenCalledTimes(1);
  harness.status = "authenticated";
  harness.generation = 3;
  harness.get.mockResolvedValue(balance("12"));
  await act(async () => render());
  expect(latest).toBe("12");
  expect(harness.get).toHaveBeenCalledTimes(2);
});

it("does not read for guests and aborts an authenticated read when the view leaves", () => {
  harness.status = "anonymous";
  render();
  expect(harness.get).not.toHaveBeenCalled();
  harness.status = "authenticated";
  harness.get.mockImplementation(() => new Promise(() => {}));
  render();
  const { signal } = harness.get.mock.calls[0][1] as { signal: AbortSignal };
  act(() => root.render(null));
  expect(signal.aborted).toBe(true);
});
