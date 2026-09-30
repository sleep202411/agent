import { beforeEach, expect, it, vi } from "vitest";
import type { PaywallProduct } from "./catalog";

const state = vi.hoisted(() => ({
  generation: 1,
  sdk: {
    isConfigured: vi.fn(),
    configure: vi.fn(),
    logIn: vi.fn(),
    purchaseProduct: vi.fn(),
    restorePurchases: vi.fn(),
  },
  sync: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => state.generation }));
vi.mock("@/auth", () => ({
  getAuthSnapshot: () => ({ user: { userId: `user-${state.generation}` } }),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, NativeModules: { RNPurchases: {} } }));
vi.mock("./checkout-channel", () => ({ currentCheckoutChannel: () => "apple_iap" }));
vi.mock("./paywall-config", () => ({
  assertPaymentReady: () => {},
  mustUseMockPayments: () => false,
  revenueCatApiKey: () => "fixture",
}));
vi.mock("./revenuecat-sync", () => ({ syncRevenueCatPurchases: state.sync }));
vi.mock("./native-payment-sdks", () => ({
  loadPurchases: () => ({
    default: state.sdk,
    PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: "cancelled" },
  }),
}));
const product: PaywallProduct = {
  id: "points",
  category: "community_points",
  storeProductId: "points-sku",
  displayPrice: "$1",
  grantsPoints: "10",
  interval: "one_time",
};
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  state.generation = 1;
  state.sdk.isConfigured.mockResolvedValue(false);
  state.sdk.logIn.mockResolvedValue({});
  state.sdk.purchaseProduct.mockResolvedValue({});
  state.sdk.restorePurchases.mockResolvedValue({});
  state.sync.mockResolvedValue({ fulfilled: [], skipped: [] });
});

it.each(["purchase", "restore"])(
  "RevenueCat does not %s after account changes during login",
  async (action) => {
    let finish!: () => void;
    state.sdk.logIn.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const module = await import("./iap");
    const operation =
      action === "purchase" ? module.purchaseIapProduct(product) : module.restoreIapPurchases();
    const assertion = expect(operation).rejects.toThrow("Account changed");
    await vi.waitFor(() => expect(state.sdk.logIn).toHaveBeenCalledWith("user-1"));
    state.generation = 2;
    finish();
    await assertion;
    expect(state.sdk.purchaseProduct).not.toHaveBeenCalled();
    expect(state.sdk.restorePurchases).not.toHaveBeenCalled();
    expect(state.sync).not.toHaveBeenCalled();
  }
);

it("RevenueCat purchase completes without syncing (caller owns confirming sync)", async () => {
  const module = await import("./iap");
  await module.purchaseIapProduct(product);
  expect(state.sdk.logIn).toHaveBeenCalledWith("user-1");
  expect(state.sdk.purchaseProduct).toHaveBeenCalledTimes(1);
  expect(state.sync).not.toHaveBeenCalled();
});

it("RevenueCat restore syncs for the unchanged session", async () => {
  const module = await import("./iap");
  await module.restoreIapPurchases();
  expect(state.sdk.logIn).toHaveBeenCalledWith("user-1");
  expect(state.sdk.restorePurchases).toHaveBeenCalledTimes(1);
  expect(state.sync).toHaveBeenCalledTimes(1);
});
