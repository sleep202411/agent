import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ComputeTopupButton } from "./compute-topup-dialog";
const state = vi.hoisted(() => ({
  account: "alice" as string | null,
  search: "",
  refetch: vi.fn(),
  info: vi.fn(),
  create: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  init: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: state.account ? { id: state.account } : null }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/billing",
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/src/lib/api", () => ({ ApiRequestError: Error }));
vi.mock("sonner", () => ({
  toast: { success: state.success, error: state.error, info: state.info },
}));
vi.mock("@airwallex/components-sdk", () => ({ init: state.init }));
vi.mock("../../_hooks/use-billing", () => ({
  availableComputeBalance: () => 0n,
  useComputeWalletLedger: () => ({ data: {}, refetch: state.refetch }),
  useCreateComputeTopup: () => ({ mutateAsync: state.create, isPending: false }),
  useComputeTopupCatalog: () => ({
    data: {
      provider: "airwallex",
      prices: [
        {
          id: "pack-1",
          name: "Pack",
          amountMinor: "100",
          currency: "USD",
          grantsWalletAmount: "100",
        },
      ],
    },
  }),
}));
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogContent: Part,
    DialogBody: Part,
    DialogFooter: Part,
    DialogHeader: Part,
    DialogTitle: Part,
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
async function render() {
  await act(async () => root.render(<ComputeTopupButton variant="studio" />));
}
async function click(label: string, twice = false) {
  await act(async () => {
    const b = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === label || b.getAttribute("aria-label") === label
    )!;
    b.click();
    if (twice) b.click();
  });
}
async function mount() {
  container = document.createElement("div");
  root = createRoot(container);
  await render();
  await click("computeBilling.openRecharge");
}
afterEach(() => {
  act(() => root?.unmount());
  vi.resetAllMocks();
  state.account = "alice";
  state.search = "";
});
it("prevents duplicate checkout requests and reuses the key after response failure", async () => {
  state.create.mockRejectedValue(new Error("Connection lost"));
  await mount();
  await click("computeBilling.payNowWithAmount", true);
  expect(state.create).toHaveBeenCalledTimes(1);
  const key = state.create.mock.calls[0]![0].idempotencyKey;
  await click("computeBilling.payNowWithAmount");
  expect(state.create).toHaveBeenCalledTimes(2);
  expect(state.create.mock.calls[1]![0].idempotencyKey).toBe(key);
});
it("discards a fulfilled checkout response after account switching", async () => {
  let finish!: (value: unknown) => void;
  state.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await mount();
  await click("computeBilling.payNowWithAmount");
  state.account = "bob";
  await render();
  await act(async () => finish({ order: { status: "fulfilled" }, paymentIntent: null }));
  expect(state.success).not.toHaveBeenCalled();
});
it("ignores a checkout error after closing and reopening", async () => {
  let fail!: (value: Error) => void;
  state.create.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      })
  );
  await mount();
  await click("computeBilling.payNowWithAmount");
  await click("computeBilling.cancel");
  await click("computeBilling.openRecharge");
  await act(async () => fail(new Error("Old checkout error")));
  expect(state.error).not.toHaveBeenCalled();
});
it("does not redirect after the payment SDK finishes in an ended account session", async () => {
  let finish!: (value: unknown) => void;
  state.create.mockResolvedValue({
    order: { provider: "airwallex", status: "pending", currency: "USD" },
    paymentIntent: { providerPaymentIntentId: "pi-1", clientSecret: "test-secret" },
    env: "demo",
    shopperCountry: "SG",
  });
  state.init.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await mount();
  await click("computeBilling.payNowWithAmount");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(state.init).toHaveBeenCalledTimes(1);
  state.account = "bob";
  await render();
  await act(async () => finish({ payments: { redirectToCheckout: state.redirect } }));
  expect(state.redirect).not.toHaveBeenCalled();
});

it("refreshes a checkout return once without claiming payment success", async () => {
  state.search = "computeTopup=success&tab=history";
  await mount();
  await render();
  await render();
  expect(state.refetch).toHaveBeenCalledTimes(1);
  expect(state.success).not.toHaveBeenCalled();
  expect(state.info).toHaveBeenCalledExactlyOnceWith("computeBilling.returnedToast");
  state.account = "bob";
  await render();
  expect(state.refetch).toHaveBeenCalledTimes(1);
});
it("waits for sign-in before refreshing a return and handles a later return", async () => {
  state.account = null;
  state.search = "computeTopup=success";
  await mount();
  expect(state.refetch).not.toHaveBeenCalled();
  state.account = "alice";
  await render();
  expect(state.refetch).toHaveBeenCalledTimes(1);
  state.search = "";
  await render();
  state.search = "computeTopup=success";
  await render();
  expect(state.refetch).toHaveBeenCalledTimes(2);
});

it("preserves existing query parameters and anchors in checkout return URLs", async () => {
  window.history.replaceState({}, "", "/billing?tab=history#ledger");
  state.create.mockRejectedValue(new Error("Test request"));
  await mount();
  await click("computeBilling.payNowWithAmount");
  const input = state.create.mock.calls[0]![0];
  for (const [field, status] of [
    ["successUrl", "success"],
    ["backUrl", "cancelled"],
  ]) {
    const url = new URL(input[field!]);
    expect(url.searchParams.get("tab")).toBe("history");
    expect(url.searchParams.get("computeTopup")).toBe(status);
    expect(url.hash).toBe("#ledger");
  }
  window.history.replaceState({}, "", "/");
});
