import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PaywallScreen } from "./paywall-screen";

const state = vi.hoisted(() => ({
  channel: "apple_iap",
  category: "community_points",
  compute: vi.fn(),
  generation: 1,
  buy: vi.fn(),
  restore: vi.fn(),
  push: vi.fn(),
  packs: vi.fn(),
  plans: vi.fn(),
  returnPath: "/ip/example",
  alert: vi.fn(),
  balance: vi.fn(),
  sync: vi.fn(),
  getOrder: vi.fn(),
  follow: vi.fn(),
  orderFulfilled: false,
}));
vi.mock("@tabler/icons-react-native", () => ({
  IconBolt: () => null,
  IconCheck: () => null,
  IconCoins: () => null,
  IconCrown: () => null,
  IconSparkles: () => null,
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: state.push }),
  useLocalSearchParams: () => ({ category: state.category, returnPath: state.returnPath }),
}));
vi.mock("react-native", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    View: Box,
    ScrollView: Box,
    KeyboardAvoidingView: Box,
    TextInput: () => null,
    ActivityIndicator: () => <span role="progressbar" />,
    Pressable: ({
      children,
      onPress,
      disabled,
    }: {
      children?: ReactNode;
      onPress?: () => void;
      disabled?: boolean;
    }) => (
      <button onClick={onPress} disabled={disabled}>
        {children}
      </button>
    ),
    Alert: { alert: state.alert },
    Platform: { OS: "ios", select: (value: { ios?: unknown }) => value.ios },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, hairlineWidth: 1 },
  };
});
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: "authenticated", user: null, generation: state.generation }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => state.generation }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/themed-view", () => ({
  ThemedView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/config", () => ({
  appEnv: { appRegion: "global", assets: { userBaseUrl: "" } },
  resolveAssetUrl: (value: string) => value,
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white" }) }));
vi.mock("@/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/navigation", () => ({ toHref: (path: string) => path }));
vi.mock("@/data/ip-api", () => ({ fetchCommunityPointBalance: state.balance }));
vi.mock("../lib/compute-wallet", () => ({ fetchComputeWalletBalance: state.compute }));
vi.mock("../lib/checkout-channel", () => ({ currentCheckoutChannel: () => state.channel }));
vi.mock("../lib/paywall-store", () => ({
  resolvePaywallCategory: () => state.category,
  PAYWALL_CATEGORIES: ["community_points", "compute_points"],
}));
vi.mock("../lib/billing-api", () => ({
  listCommunityPointPackages: state.packs,
  listMembershipPrices: state.plans,
  paywallBillingCurrency: () => "CNY",
  getBillingOrder: (...args: unknown[]) => state.getOrder(...args),
  isOrderDead: () => false,
  isOrderFulfilled: () => state.orderFulfilled,
}));
vi.mock("../lib/purchase", () => ({
  purchaseProduct: state.buy,
  restorePurchases: state.restore,
  isPurchaseCancelled: () => false,
}));
vi.mock("../lib/revenuecat-sync", () => ({
  syncRevenueCatPurchases: (...args: unknown[]) => state.sync(...args),
}));
vi.mock("../lib/wechat-order-follow", () => ({
  followWechatOrderUntilSettled: (...args: unknown[]) => state.follow(...args),
}));
vi.mock("../lib/wechat", () => ({
  communityPackProduct: (value: unknown) => value,
  membershipProduct: (value: unknown) => value,
}));
vi.mock("./wechat-scan-pay", () => ({
  WechatScanPay: ({ orderId, onClose }: { orderId: string; onClose: () => void }) => (
    <span>
      {orderId}
      <button type="button" onClick={onClose}>
        close-scan
      </button>
    </span>
  ),
}));
const FIXTURE_PACK = {
  id: "price-1",
  category: "community_points",
  storeProductId: "com.fizzdragon.community.credits.5000",
  billingPriceId: "price-1",
  displayPrice: "$50.00",
  name: "5000 credits",
  grantsPoints: "5000",
  interval: "one_time",
};
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.channel = "apple_iap";
  state.category = "community_points";
  state.compute.mockResolvedValue("0");
  state.generation = 1;
  state.orderFulfilled = false;
  state.balance.mockResolvedValue("0");
  state.buy.mockImplementation(() => new Promise(() => {}));
  state.sync.mockResolvedValue({ fulfilled: [], skipped: [] });
  state.getOrder.mockResolvedValue({ status: "pending" });
  state.follow.mockResolvedValue("timeout");
  // Nest catalog is the only source for community packs (no hardcoded SKUs).
  state.packs.mockResolvedValue([FIXTURE_PACK]);
  state.plans.mockResolvedValue([]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(<PaywallScreen />));
const PAY_LABELS = new Set([
  "paywall.buyNow",
  "paywall.confirming",
  "paywall.membership.subscribe",
]);
const payButton = () =>
  [...host.querySelectorAll("button")].find((item) =>
    PAY_LABELS.has(item.textContent?.replace(/\s+/g, "") ?? "")
  ) ??
  [...host.querySelectorAll("button")].find((item) =>
    [...PAY_LABELS].some((label) => item.textContent?.includes(label))
  )!;
it("connects the buy button to checkout and disables it while a purchase is pending", async () => {
  await render();
  const button = payButton();
  expect(button.textContent).toContain("paywall.buyNow");
  await act(async () => button.click());
  expect(state.buy).toHaveBeenCalledTimes(1);
  expect(payButton().disabled).toBe(true);
  expect(payButton().textContent).toContain("paywall.buyNow");
});
it("dispatches only one purchase for two presses before React renders", async () => {
  await render();
  const button = payButton();
  await act(async () => {
    button.click();
    button.click();
  });
  expect(state.buy).toHaveBeenCalledTimes(1);
});

it("allows a new purchase after the previous attempt fails", async () => {
  state.buy.mockRejectedValueOnce(new Error("Checkout unavailable"));
  await render();
  const button = payButton();
  await act(async () => button.click());
  expect(state.alert).toHaveBeenCalledWith("paywall.purchaseFailed", "Checkout unavailable");
  expect(payButton().disabled).toBe(false);
  await act(async () => {
    button.click();
    button.click();
  });
  expect(state.buy).toHaveBeenCalledTimes(2);
  expect(button.disabled).toBe(true);
});

it.each([false, true])(
  "ignores an old purchase completion after session replacement (failure=%s)",
  async (failure) => {
    let resolve!: (result: { mocked: boolean; productId: string }) => void;
    let reject!: (error: Error) => void;
    state.buy.mockImplementationOnce(
      () =>
        new Promise((ok, fail) => {
          resolve = ok;
          reject = fail;
        })
    );
    await render();
    const button = payButton();
    await act(async () => button.click());
    state.generation += 1;
    // A response can arrive before React renders the replacement session.
    await act(async () => {
      if (failure) reject(new Error("Old checkout failed"));
      else resolve({ mocked: false, productId: "old-product" });
    });
    expect(state.alert).not.toHaveBeenCalled();
  }
);

it("resets the busy purchase state for a replacement session", async () => {
  await render();
  await act(async () => payButton().click());
  expect(payButton().disabled).toBe(true);
  expect(payButton().textContent).toContain("paywall.buyNow");
  state.generation += 1;
  await render();
  expect(payButton().disabled).toBe(false);
  expect(payButton().textContent).toContain("paywall.buyNow");
});

it("shows purchase success after confirming a simulated store purchase", async () => {
  state.buy.mockResolvedValueOnce({ mocked: true, productId: "points-sku" });
  await render();
  await act(async () => payButton().click());
  expect(state.alert).toHaveBeenCalledWith("paywall.purchaseOkTitle", "paywall.purchaseOkSuccess");
  expect(state.alert).not.toHaveBeenCalledWith("paywall.purchaseOkTitle", "paywall.purchaseOkMock");
  expect(payButton().textContent).toContain("paywall.buyNow");
});

it("shows purchase success after confirming a live store purchase", async () => {
  state.buy.mockResolvedValueOnce({ mocked: false, productId: "points-sku" });
  await render();
  await act(async () => payButton().click());
  expect(state.alert).toHaveBeenCalledWith("paywall.purchaseOkTitle", "paywall.purchaseOkSuccess");
  expect(payButton().disabled).toBe(false);
  expect(payButton().textContent).toContain("paywall.buyNow");
});

it("shows crediting on the pay button while IAP sync and wallet refresh run", async () => {
  let finishSync!: () => void;
  state.buy.mockResolvedValueOnce({ mocked: false, productId: "points-sku" });
  state.sync.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finishSync = () => done({ fulfilled: [], skipped: [] });
      })
  );
  await render();
  await act(async () => payButton().click());
  expect(payButton().textContent).toContain("paywall.confirming");
  expect(payButton().disabled).toBe(true);
  expect(state.sync).toHaveBeenCalledTimes(1);
  let finishRefresh!: (balance: string) => void;
  state.balance.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finishRefresh = done;
      })
  );
  await act(async () => finishSync());
  expect(payButton().textContent).toContain("paywall.confirming");
  await act(async () => finishRefresh("12"));
  expect(payButton().textContent).toContain("paywall.buyNow");
  expect(state.alert).toHaveBeenCalledWith("paywall.purchaseOkTitle", "paywall.purchaseOkSuccess");
});

it("confirms WeChat credit after closing the QR once the order is fulfilled", async () => {
  state.channel = "wechat";
  state.buy.mockResolvedValueOnce({
    mocked: false,
    wechatScan: { orderId: "wx-order-1", codeUrl: "weixin://pay" },
  });
  let finishFollow!: (result: string) => void;
  state.follow.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finishFollow = done;
      })
  );
  state.balance.mockResolvedValue("88");
  await render();
  await act(async () => payButton().click());
  expect(host.textContent).toContain("wx-order-1");
  const close = [...host.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("close-scan")
  )!;
  await act(async () => close.click());
  // Unpaid dismiss polls quietly — CTA stays buyNow until fulfill is known.
  expect(payButton().textContent).toContain("paywall.buyNow");
  expect(payButton().disabled).toBe(false);
  expect(state.follow).toHaveBeenCalledWith("wx-order-1");
  await act(async () => finishFollow("fulfilled"));
  expect(state.alert).toHaveBeenCalledWith("paywall.purchaseOkTitle", "paywall.wechat.success");
  expect(host.textContent).toContain("88");
  expect(payButton().textContent).toContain("paywall.buyNow");
});

it("keeps following a WeChat order after leaving the paywall with the QR open", async () => {
  state.channel = "wechat";
  state.buy.mockResolvedValueOnce({
    mocked: false,
    wechatScan: { orderId: "wx-leave-open", codeUrl: "weixin://pay" },
  });
  state.follow.mockResolvedValue("fulfilled");
  await render();
  await act(async () => payButton().click());
  expect(host.textContent).toContain("wx-leave-open");
  await act(async () => root.render(null));
  expect(state.follow).toHaveBeenCalledWith("wx-leave-open");
  expect(state.alert).not.toHaveBeenCalled();
});

it("does not show a late purchase alert after leaving the paywall", async () => {
  let resolve!: (result: { mocked: boolean; productId: string }) => void;
  state.buy.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  await act(async () => payButton().click());
  await act(async () => root.render(null));
  await act(async () => resolve({ mocked: false, productId: "old-product" }));
  expect(state.sync).toHaveBeenCalledTimes(1);
  expect(state.alert).not.toHaveBeenCalled();
});

it("does not open a QR code from a purchase completed in an old session", async () => {
  let resolve!: (result: unknown) => void;
  state.buy.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  await act(async () => payButton().click());
  state.generation += 1;
  await act(async () =>
    resolve({ mocked: false, wechatScan: { orderId: "old-qr-order", codeUrl: "weixin://old" } })
  );
  expect(host.textContent).not.toContain("old-qr-order");
});

it("removes the previous session's open QR code", async () => {
  state.buy.mockResolvedValueOnce({
    mocked: false,
    wechatScan: { orderId: "old-qr-order", codeUrl: "weixin://old" },
  });
  await render();
  await act(async () => payButton().click());
  expect(host.textContent).toContain("old-qr-order");
  state.generation += 1;
  await render();
  expect(host.textContent).not.toContain("old-qr-order");
});

it("reloads the replacement account's balance and ignores the old account's late balance", async () => {
  state.channel = "wechat";
  let resolve!: (balance: string) => void;
  state.balance
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    )
    .mockResolvedValue("777");
  await render();
  state.generation += 1;
  await render();
  expect(state.balance).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("777");
  await act(async () => resolve("999"));
  expect(host.textContent).toContain("777");
  expect(host.textContent).not.toContain("999");
});

it("keeps the return destination when continuing to web checkout", async () => {
  state.channel = "web";
  await render();
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === "paywall.continueWeb"
  )!;
  await act(async () => button.click());
  expect(state.push).toHaveBeenCalledExactlyOnceWith("/pay/community?returnPath=%2Fip%2Fexample");
  expect(state.buy).not.toHaveBeenCalled();
});
it("renders the WeChat package loading state before prices arrive", async () => {
  state.channel = "wechat";
  state.packs.mockImplementation(() => new Promise(() => {}));
  await render();
  expect(host.querySelector('[role="progressbar"]')).not.toBeNull();
});

vi.mock("@tabler/icons-react-native/IconBolt", () => ({ default: () => null }));
vi.mock("@tabler/icons-react-native/IconCheck", () => ({ default: () => null }));
vi.mock("@tabler/icons-react-native/IconCoins", () => ({ default: () => null }));
vi.mock("@tabler/icons-react-native/IconCrown", () => ({ default: () => null }));
vi.mock("@tabler/icons-react-native/IconSparkles", () => ({ default: () => null }));

it("recovers a failed compute balance read without starting a purchase", async () => {
  state.category = "compute_points";
  state.compute.mockRejectedValueOnce(Error("Wallet unavailable")).mockResolvedValueOnce("42");
  await render();
  expect(host.textContent).toContain("Wallet unavailable");
  const retry = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "common.retry"
  )!;
  expect(retry).toBeDefined();
  await act(async () => retry.click());
  expect(host.textContent).not.toContain("Wallet unavailable");
  expect(host.textContent).toContain("42");
  expect(state.buy).not.toHaveBeenCalled();
});

it("recovers a failed community balance read without starting a purchase", async () => {
  state.balance.mockRejectedValueOnce(Error("Community unavailable")).mockResolvedValueOnce("43");
  await render();
  expect(host.textContent).toContain("Community unavailable");
  const retry = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "common.retry"
  )!;
  await act(async () => retry.click());
  expect(host.textContent).not.toContain("Community unavailable");
  expect(host.textContent).toContain("43");
  expect(state.buy).not.toHaveBeenCalled();
});

it("does not overwrite a post-purchase balance with a late initial read", async () => {
  state.buy.mockResolvedValueOnce({ mocked: false, productId: "points-sku" });
  let finishInitial!: (value: string) => void;
  state.balance
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishInitial = resolve;
        })
    )
    .mockResolvedValue("44");
  await render();
  await act(async () => payButton().click());
  expect(host.textContent).toContain("44");
  await act(async () => finishInitial("11"));
  expect(host.textContent).toContain("44");
});

it.each(["community_points", "community_membership"])(
  "retries a failed %s catalog without purchasing",
  async (category) => {
    state.category = category;
    const request = category === "community_points" ? state.packs : state.plans;
    request
      .mockRejectedValueOnce(Error("Catalog temporarily unavailable"))
      .mockResolvedValueOnce([{ ...FIXTURE_PACK, category }]);
    await render();
    expect(host.textContent).toContain("Catalog temporarily unavailable");
    expect(payButton().disabled).toBe(true);
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "common.retry"
    )!;
    await act(async () => retry.click());
    expect(host.textContent).not.toContain("Catalog temporarily unavailable");
    expect(host.textContent).toContain("$50.00");
    expect(payButton().disabled).toBe(false);
    expect(state.buy).not.toHaveBeenCalled();
  }
);

it("aborts a replaced account catalog and ignores its late result", async () => {
  let resolve!: (value: unknown[]) => void;
  state.packs.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  const signal = state.packs.mock.calls[0][1] as AbortSignal;
  state.generation++;
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve([{ ...FIXTURE_PACK, name: "Old account price", id: "old" }]));
  expect(host.textContent).not.toContain("Old account price");
  expect(host.textContent).toContain("5000");
});

it("does not follow the previous account's open WeChat order during account replacement", async () => {
  state.channel = "wechat";
  state.buy.mockResolvedValueOnce({
    mocked: false,
    wechatScan: { orderId: "previous-account-order", codeUrl: "weixin://pay" },
  });
  await render();
  await act(async () => payButton().click());
  expect(host.textContent).toContain("previous-account-order");
  state.generation = 2;
  await render();
  expect(state.follow).not.toHaveBeenCalled();
  expect(state.alert).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("previous-account-order");
});

it("refreshes displayed balances after restoring purchases without buying again", async () => {
  state.category = "community_membership";
  state.restore.mockResolvedValueOnce({ mocked: false });
  state.balance.mockResolvedValueOnce("10").mockResolvedValueOnce("55");
  await render();
  const restore = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "paywall.restore"
  )!;
  await act(async () => restore.click());
  expect(state.balance).toHaveBeenCalledTimes(2);
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("paywall.category.communityPoints"))!
      .click()
  );
  expect(host.textContent).toContain("55");
  expect(state.restore).toHaveBeenCalledTimes(1);
  expect(state.buy).not.toHaveBeenCalled();
  expect(state.alert).toHaveBeenCalledWith("paywall.restoreOkTitle", "paywall.restoreOkLive");
});
it("does not refresh or announce a restore completed for a retired account", async () => {
  state.category = "community_membership";
  let finish!: (value: { mocked: boolean }) => void;
  state.restore.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  const restore = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "paywall.restore"
  )!;
  await act(async () => restore.click());
  state.generation++;
  await render();
  const reads = state.balance.mock.calls.length;
  await act(async () => finish({ mocked: false }));
  expect(state.balance).toHaveBeenCalledTimes(reads);
  expect(state.alert).not.toHaveBeenCalled();
});
