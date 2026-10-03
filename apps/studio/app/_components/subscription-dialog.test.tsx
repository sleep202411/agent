// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { SubscriptionDialog } from "./subscription-dialog";
const state = vi.hoisted(() => ({
  user: "a" as string | null,
  ws: "team",
  checkout: vi.fn(),
  list: vi.fn(),
  login: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./auth-provider", () => ({
  useAuth: () => ({
    user: state.user ? { id: state.user } : null,
    requireAuth: state.login,
    isCurrentAccount: (id: string) => id === state.user,
  }),
}));
vi.mock("./workspace-context", () => ({
  useWorkspace: () => ({ activeWorkspace: { id: state.ws, role: "owner" } }),
}));
vi.mock("./region-provider", () => ({ useIsCnSite: () => false }));
vi.mock("@/lib/billing", () => ({
  createBillingCheckout: state.checkout,
  listMembershipPlans: state.list,
  isWechatScanUrl: (v: string) => v.startsWith("weixin:"),
}));
vi.mock("next-intl", () => {
  const t = Object.assign((key: string) => key, { rich: (key: string) => key });
  return { useTranslations: () => t };
});
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/app/_components/wechat-scan-pay-dialog", () => ({
  WechatScanPayDialog: () => <div>QR payment</div>,
}));
const price = {
  id: "price",
  interval: "month",
  subjectType: "user",
  amountMinor: "1000",
  currency: "USD",
  metadata: {},
};
const plan = {
  id: "plan",
  name: "Pro",
  planKey: "pro",
  status: "active",
  rank: 1,
  includedComputeCredits: "100",
  marketing: {},
  benefits: { concurrentJobs: 1, queuedJobs: 2 },
  prices: [price],
};
let root: Root, host: HTMLDivElement;
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
};
const render = async (open = true) => {
  await act(async () => root.render(<SubscriptionDialog open={open} onOpenChange={state.close} />));
  await settle();
};
const buy = () =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === "plan.getStarted")!;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  state.user = "a";
  state.ws = "team";
  state.list.mockImplementation(({ productType }) =>
    Promise.resolve({ plans: productType === "membership_plan" ? [plan] : [] })
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  window.history.replaceState(null, "", "/en-US/canvas?project=42#settings/usage");
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("ignores a checkout response after dialog dismissal", async () => {
  let resolve!: (v: unknown) => void;
  state.checkout.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await act(async () => buy().click());
  const signal = state.checkout.mock.calls[0]![1] as AbortSignal;
  await render(false);
  expect(signal.aborted).toBe(true);
  await act(async () =>
    resolve({ order: { id: "order", status: "fulfilled" }, paymentIntent: null })
  );
  expect(state.success).not.toHaveBeenCalled();
  expect(state.close).not.toHaveBeenCalled();
});
it("resets checkout state and prevents stale QR display on account replacement", async () => {
  let resolve!: (v: unknown) => void;
  state.checkout.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await act(async () => buy().click());
  state.user = "b";
  await render();
  expect(buy().disabled).toBe(false);
  await act(async () =>
    resolve({ order: { id: "order" }, paymentIntent: { checkoutUrl: "weixin://fixture" } })
  );
  expect(document.body.textContent).not.toContain("QR payment");
});
it("retries the same order key and preserves the original page query and hash", async () => {
  state.checkout
    .mockRejectedValueOnce(new Error("Timeout"))
    .mockResolvedValue({ order: { status: "fulfilled" }, paymentIntent: null });
  await render();
  await act(async () => buy().click());
  await act(async () => buy().click());
  expect(state.checkout.mock.calls[0]![0].idempotencyKey).toBe(
    state.checkout.mock.calls[1]![0].idempotencyKey
  );
  const url = new URL(state.checkout.mock.calls[1]![0].successUrl);
  expect(url.searchParams.get("project")).toBe("42");
  expect(url.searchParams.get("payment")).toBe("success");
  expect(url.hash).toBe("#settings/usage");
  expect(state.success).toHaveBeenCalledOnce();
});
it("does not resume after unrelated login but resumes after the requested login succeeds", async () => {
  state.user = null;
  state.checkout.mockResolvedValue({ order: { status: "fulfilled" }, paymentIntent: null });
  await render();
  act(() => buy().click());
  expect(state.login).toHaveBeenCalledOnce();
  state.user = "b";
  await render();
  expect(state.checkout).not.toHaveBeenCalled();
  await act(async () => state.login.mock.calls[0]![0]());
  await settle();
  expect(state.checkout).toHaveBeenCalledOnce();
});
it("does not resurrect an abandoned login intent after reopening", async () => {
  state.user = null;
  await render();
  act(() => buy().click());
  const callback = state.login.mock.calls[0]![0];
  await render(false);
  state.user = "b";
  await render();
  await act(async () => callback());
  expect(state.checkout).not.toHaveBeenCalled();
});

it("aborts catalog reads when the dialog closes", async () => {
  state.list.mockImplementation(() => new Promise(() => {}));
  await render();
  const signals = state.list.mock.calls.map(([, signal]) => signal as AbortSignal);
  await render(false);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});
