import { NativeModules, Platform } from "react-native";

import { getAuthSnapshot } from "@/auth";
import { isChinaRegion } from "@/config";

import { currentCheckoutChannel } from "./checkout-channel";
import { assertPaymentReady, mustUseMockPayments, revenueCatApiKey } from "./paywall-config";
import type { PaywallProduct } from "./catalog";
import { PurchaseCancelledError, type PurchaseResult } from "./purchase-types";
import { purchaseStoreKitProduct, restoreStoreKitPurchases } from "./storekit-iap";

export { PurchaseCancelledError, type PurchaseResult };

type PurchasesSdk = typeof import("react-native-purchases");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function purchasesUserId(): string | undefined {
  const user = getAuthSnapshot().user;
  const id = user?.userId ?? user?.id;
  return id == null ? undefined : String(id);
}

function hasPurchasesNative(): boolean {
  return Platform.OS !== "web" && NativeModules.RNPurchases != null;
}

function loadPurchases(): PurchasesSdk {
  return require("react-native-purchases") as PurchasesSdk;
}

function isPurchasesCancelled(error: unknown, Purchases: PurchasesSdk): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return error.code === Purchases.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
}

let configuredKey: string | null = null;

async function ensurePurchasesConfigured(apiKey: string): Promise<PurchasesSdk> {
  if (!hasPurchasesNative()) {
    throw new Error(
      "[paywall] RevenueCat is not in this binary. Rebuild the Expo dev client after installing react-native-purchases."
    );
  }

  const sdk = loadPurchases();
  const Purchases = sdk.default;

  if (configuredKey !== apiKey || !(await Purchases.isConfigured())) {
    Purchases.configure({ apiKey });
    configuredKey = apiKey;
  }

  const userId = purchasesUserId();
  if (userId) {
    await Purchases.logIn(userId);
  }

  return sdk;
}

export async function purchaseIapProduct(product: PaywallProduct): Promise<PurchaseResult> {
  const channel = currentCheckoutChannel();
  assertPaymentReady(channel);
  if (mustUseMockPayments(channel) || Platform.OS === "web") {
    await sleep(700);
    return { mocked: true, productId: product.storeProductId };
  }

  if (isChinaRegion) {
    return purchaseStoreKitProduct(product);
  }

  const apiKey = revenueCatApiKey(channel);
  const sdk = await ensurePurchasesConfigured(apiKey);
  try {
    await sdk.default.purchaseProduct(product.storeProductId);
    return { mocked: false, productId: product.storeProductId };
  } catch (error) {
    if (isPurchasesCancelled(error, sdk)) {
      throw new PurchaseCancelledError();
    }
    throw error;
  }
}

export async function restoreIapPurchases(): Promise<{ mocked: boolean }> {
  const channel = currentCheckoutChannel();
  assertPaymentReady(channel);
  if (mustUseMockPayments(channel) || Platform.OS === "web") {
    await sleep(500);
    return { mocked: true };
  }

  if (isChinaRegion) {
    await restoreStoreKitPurchases();
    return { mocked: false };
  }

  const apiKey = revenueCatApiKey(channel);
  const sdk = await ensurePurchasesConfigured(apiKey);
  await sdk.default.restorePurchases();
  return { mocked: false };
}
