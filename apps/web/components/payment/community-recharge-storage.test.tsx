import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CommunityRechargeDialog } from "./community-recharge-dialog";

const h = vi.hoisted(() => ({ loading: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: h }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: { prices: [] } }) }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/src/lib/ip-commerce", () => ({ useCommunityPointBalance: () => ({ balance: 0 }) }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/src/config/site", () => ({
  siteConfig: { defaultCurrency: "USD", currencies: [], paymentProviders: [] },
}));
vi.mock("@/src/lib/api", () => ({ ApiRequestError: class extends Error {} }));
vi.mock("@/src/lib/axon", () => ({
  axonAleid: vi.fn(),
  axonAddToCart: vi.fn(),
  axonBeginCheckout: vi.fn(),
  axonFlushPendingPurchase: vi.fn(),
  axonStashPendingPurchase: vi.fn(),
  axonViewItem: vi.fn(),
}));
vi.mock("@/src/lib/billing/api", () => ({
  createBillingCheckout: vi.fn(),
  createCustomRecharge: vi.fn(),
  isWechatScanUrl: vi.fn(),
  listCommunityPointPackages: vi.fn(),
}));
vi.mock("./wechat-scan-pay-dialog", () => ({ WechatScanPayPanel: () => null }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: () => null,
  DialogContent: () => null,
  DialogDescription: () => null,
  DialogHeader: () => null,
  DialogTitle: () => null,
}));

it("refreshes the balance after a provider return even when session storage is blocked", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  const original = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;
  const root = createRoot(document.createElement("div"));
  const refresh = vi.fn().mockResolvedValue(undefined);
  window.history.replaceState(null, "", "/?recharge=success&keep=yes");
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get() {
      throw new DOMException("Blocked", "SecurityError");
    },
  });
  try {
    await act(async () =>
      root.render(
        <CommunityRechargeDialog open={false} onOpenChange={() => {}} onSuccess={refresh} />
      )
    );
    await act(async () => vi.advanceTimersByTimeAsync(2500));
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(window.location.search).toBe("?keep=yes");
    expect(h.success).toHaveBeenCalled();
    expect(h.error).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    Object.defineProperty(window, "sessionStorage", original);
    window.history.replaceState(null, "", "/");
    vi.useRealTimers();
  }
});
