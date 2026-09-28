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
  iap: {
    initConnection: vi.fn(),
    fetchProducts: vi.fn(),
    requestPurchase: vi.fn(),
    restorePurchases: vi.fn(),
    purchaseUpdatedListener: vi.fn(),
    purchaseErrorListener: vi.fn(),
    finishTransaction: vi.fn(),
    isUserCancelledError: vi.fn(),
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => state.generation }));
vi.mock("@/auth", () => ({
  getAuthSnapshot: () => ({ user: { userId: `user-${state.generation}` } }),
}));
vi.mock("@/config", () => ({ isChinaRegion: false }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, NativeModules: { RNPurchases: {} } }));
vi.mock("./checkout-channel", () => ({ currentCheckoutChannel: () => "apple_iap" }));
vi.mock("./paywall-config", () => ({
  assertPaymentReady: () => {},
  mustUseMockPayments: () => false,
  revenueCatApiKey: () => "fixture",
}));
vi.mock("./storekit-native", () => ({ hasStoreKitIapNative: () => true }));
vi.mock("./native-payment-sdks", () => ({
  loadPurchases: () => ({
    default: state.sdk,
    PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: "cancelled" },
  }),
  loadIap: () => state.iap,
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
  state.iap.initConnection.mockResolvedValue(true);
  state.iap.fetchProducts.mockResolvedValue([{ id: "points-sku" }]);
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
  }
);

it.each(["purchase", "restore"])(
  "RevenueCat permits %s for the unchanged session",
  async (action) => {
    const module = await import("./iap");
    await (action === "purchase"
      ? module.purchaseIapProduct(product)
      : module.restoreIapPurchases());
    expect(state.sdk.logIn).toHaveBeenCalledWith("user-1");
    expect(
      action === "purchase" ? state.sdk.purchaseProduct : state.sdk.restorePurchases
    ).toHaveBeenCalledTimes(1);
  }
);

it.each(["purchase", "restore"])(
  "StoreKit does not %s after account changes during connection",
  async (action) => {
    let finish!: (result: boolean) => void;
    state.iap.initConnection.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    const module = await import("./storekit-iap");
    const operation =
      action === "purchase"
        ? module.purchaseStoreKitProduct(product)
        : module.restoreStoreKitPurchases();
    const assertion = expect(operation).rejects.toThrow("Account changed");
    state.generation = 2;
    finish(true);
    await assertion;
    expect(state.iap.fetchProducts).not.toHaveBeenCalled();
    expect(state.iap.requestPurchase).not.toHaveBeenCalled();
    expect(state.iap.restorePurchases).not.toHaveBeenCalled();
  }
);

it("StoreKit does not install transaction listeners or purchase after an old product lookup", async () => {
  let finish!: (result: unknown[]) => void;
  state.iap.fetchProducts.mockImplementation(
    () =>
      new Promise<unknown[]>((resolve) => {
        finish = resolve;
      })
  );
  const module = await import("./storekit-iap");
  const operation = module.purchaseStoreKitProduct(product);
  const assertion = expect(operation).rejects.toThrow("Account changed");
  await vi.waitFor(() => expect(state.iap.fetchProducts).toHaveBeenCalled());
  state.generation = 2;
  finish([{ id: "points-sku" }]);
  await assertion;
  expect(state.iap.purchaseUpdatedListener).not.toHaveBeenCalled();
  expect(state.iap.requestPurchase).not.toHaveBeenCalled();
});

it("StoreKit still restores for an unchanged session", async () => {
  const module = await import("./storekit-iap");
  await module.restoreStoreKitPurchases();
  expect(state.iap.restorePurchases).toHaveBeenCalledTimes(1);
});

it("StoreKit still starts the selected purchase for an unchanged session", async () => {
  let complete!: (purchase: { productId: string }) => void;
  state.iap.purchaseUpdatedListener.mockImplementation((listener) => {
    complete = listener;
    return { remove: vi.fn() };
  });
  state.iap.purchaseErrorListener.mockReturnValue({ remove: vi.fn() });
  state.iap.requestPurchase.mockResolvedValue(undefined);
  state.iap.finishTransaction.mockResolvedValue(undefined);
  const module = await import("./storekit-iap");
  const operation = module.purchaseStoreKitProduct(product);
  await vi.waitFor(() =>
    expect(state.iap.requestPurchase).toHaveBeenCalledWith({
      request: { apple: { sku: "points-sku" } },
      type: "in-app",
    })
  );
  complete({ productId: "points-sku" });
  await expect(operation).resolves.toMatchObject({ mocked: false, productId: "points-sku" });
});
