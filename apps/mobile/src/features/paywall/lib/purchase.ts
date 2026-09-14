import { currentCheckoutChannel } from "./checkout-channel";
import type { PaywallProduct } from "./catalog";
import {
  PurchaseCancelledError,
  purchaseIapProduct,
  restoreIapPurchases,
  type PurchaseResult,
} from "./iap";
import { purchaseWithWechat } from "./wechat";

export { PurchaseCancelledError };
export type { PurchaseResult };

export async function purchaseProduct(product: PaywallProduct): Promise<PurchaseResult> {
  const channel = currentCheckoutChannel();
  if (channel === "wechat") return purchaseWithWechat(product);
  if (channel === "apple_iap" || channel === "google_play_iap") {
    return purchaseIapProduct(product);
  }
  throw new Error(
    "[paywall] This device has no native payment rail. Buy community points on the web."
  );
}

export async function restorePurchases(): Promise<{ mocked: boolean }> {
  const channel = currentCheckoutChannel();
  if (channel === "wechat") {
    throw new Error(
      "[paywall] WeChat has no App Store restore. Entitlements come from Nest after the order is paid."
    );
  }
  return restoreIapPurchases();
}

export function isPurchaseCancelled(error: unknown): boolean {
  return error instanceof PurchaseCancelledError;
}
