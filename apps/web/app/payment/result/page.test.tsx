import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
const s = vi.hoisted(() => ({
  order: "order/a",
  user: "a",
  get: vi.fn(),
  purchase: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: s.push }),
  useSearchParams: () => ({ get: (key: string) => (key === "order_id" ? s.order : null) }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "zh-CN",
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: s.user } }) }));
vi.mock("@/src/lib/api", () => ({ backendApi: { get: s.get } }));
vi.mock("@/src/lib/axon", () => ({ axonPurchase: s.purchase }));
let root: Root;
let node: HTMLDivElement;
async function render() {
  await act(async () => root.render(<Page />));
}
async function click(label: string) {
  const button = Array.from(node.querySelectorAll("button")).find((b) => b.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  s.order = "order/a";
  s.user = "a";
  s.get.mockReset();
  s.purchase.mockReset();
  s.push.mockReset();
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});
it("keeps an unconfirmed order pending and allows checking again", async () => {
  s.get.mockResolvedValue({ status: 0 });
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(30000));
  expect(s.get).toHaveBeenCalledTimes(10);
  expect(node.textContent).toContain("paymentUnconfirmed");
  expect(node.textContent).not.toContain("paymentFailed");
  s.get.mockResolvedValue({ status: 1, amount: 10 });
  await click("checkAgain");
  expect(node.textContent).toContain("paymentSuccess");
  expect(s.purchase).toHaveBeenCalledTimes(1);
  await click("backToStudio");
  expect(s.push).toHaveBeenCalledWith("/zh-CN/art-studio");
});
it("preserves request errors and retries", async () => {
  s.get.mockRejectedValue(new Error("Payment service unavailable"));
  await render();
  expect(node.textContent).toContain("Payment service unavailable");
  expect(node.textContent).not.toContain("paymentFailed");
  s.get.mockResolvedValue({ status: 1 });
  await click("checkAgain");
  expect(node.textContent).toContain("paymentSuccess");
});
it.each([-1, 2])("shows confirmed failure for status %s", async (status) => {
  s.get.mockResolvedValue({ status });
  await render();
  expect(node.textContent).toContain("paymentFailed");
  expect(s.purchase).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("does not query a missing order", async () => {
  s.order = "";
  await render();
  expect(node.textContent).toContain("missingOrder");
  expect(s.get).not.toHaveBeenCalled();
});
it.each(["account", "order"])("ignores a late response when the %s changes", async (kind) => {
  let resolve!: (value: { status: number }) => void;
  s.get
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    )
    .mockResolvedValue({ status: 0 });
  await render();
  const signal = s.get.mock.calls[0][1].signal as AbortSignal;
  expect(s.get.mock.calls[0][0]).toBe("/api/payment/order/status/order%2Fa");
  if (kind === "account") s.user = "b";
  else s.order = "order-b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ status: 1 }));
  expect(node.textContent).not.toContain("paymentSuccess");
  expect(s.purchase).not.toHaveBeenCalled();
});
it("cancels polling on departure", async () => {
  s.get.mockResolvedValue({ status: 0 });
  await render();
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTimeAsync(30000));
  expect(s.get).toHaveBeenCalledTimes(1);
  expect(s.get.mock.calls[0][1].signal.aborted).toBe(true);
});
it("tracks each confirmed order once across order switches", async () => {
  s.get.mockResolvedValue({ status: 1, amount: 20 });
  await render();
  s.order = "order-b";
  await render();
  s.order = "order/a";
  await render();
  expect(s.purchase).toHaveBeenCalledTimes(2);
  expect(s.purchase.mock.calls.map((c) => c[0].transactionId)).toEqual(["order/a", "order-b"]);
});
