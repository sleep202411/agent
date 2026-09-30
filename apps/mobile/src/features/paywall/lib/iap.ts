import { capturePaymentSession } from "./payment-session";
import { loadPurchases } from "./native-payment-sdks";
import { NativeModules, Platform } from "react-native";

import { getAuthSnapshot } from "@/auth";

import { currentCheckoutChannel } from "./checkout-channel";
import { assertPaymentReady, mustUseMockPayments, revenueCatApiKey } from "./paywall-config";
import type { PaywallProduct } from "./catalog";
import { PurchaseCancelledError, type PurchaseResult } from "./purchase-types";
import { syncRevenueCatPurchases } from "./revenuecat-sync";

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

function isPurchasesCancelled(error: unknown, Purchases: PurchasesSdk): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return error.code === Purchases.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
}

let configuredKey: string | null = null;

async function ensurePurchasesConfigured(
  apiKey: string,
  assertCurrentSession: () => void
): Promise<PurchasesSdk> {
  if (!hasPurchasesNative()) {
    throw new Error(
      "[paywall] RevenueCat is not in this binary. Rebuild the Expo dev client after installing react-native-purchases."
    );
  }

  const userId = purchasesUserId();
  const sdk = loadPurchases();
  const Purchases = sdk.default;

  if (configuredKey !== apiKey || !(await Purchases.isConfigured())) {
    assertCurrentSession();
    Purchases.configure({ apiKey });
    configuredKey = apiKey;
  }

  assertCurrentSession();
  if (userId) {
    await Purchases.logIn(userId);
  }

  assertCurrentSession();
  return sdk;
}

export async function purchaseIapProduct(product: PaywallProduct): Promise<PurchaseResult> {
  const channel = currentCheckoutChannel();
  assertPaymentReady(channel);
  if (mustUseMockPayments(channel) || Platform.OS === "web") {
    // Long enough to see the pay-button spinner the same way StoreKit holds it.
    await sleep(1_600);
    return { mocked: true, productId: product.storeProductId };
  }

  const apiKey = revenueCatApiKey(channel);
  const assertCurrentSession = capturePaymentSession();
  const sdk = await ensurePurchasesConfigured(apiKey, assertCurrentSession);
  assertCurrentSession();
  try {
    await sdk.default.purchaseProduct(product.storeProductId);
    assertCurrentSession();
    // Caller runs RevenueCat → Nest sync under the "confirming" button label.
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

  const apiKey = revenueCatApiKey(channel);
  const assertCurrentSession = capturePaymentSession();
  const sdk = await ensurePurchasesConfigured(apiKey, assertCurrentSession);
  assertCurrentSession();
  await sdk.default.restorePurchases();
  assertCurrentSession();
  await syncRevenueCatPurchases();
  return { mocked: false };
}
