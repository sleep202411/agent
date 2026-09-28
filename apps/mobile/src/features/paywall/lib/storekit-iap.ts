import { capturePaymentSession } from "./payment-session";
import { loadIap } from "./native-payment-sdks";
import { isMembershipCategory } from "./catalog";
import type { PaywallProduct } from "./catalog";
import { PurchaseCancelledError, type PurchaseResult } from "./purchase-types";
import { hasStoreKitIapNative } from "./storekit-native";

type IapSdk = typeof import("react-native-iap");

let connected = false;

async function ensureStoreKitConnected(): Promise<IapSdk> {
  if (!hasStoreKitIapNative()) {
    throw new Error(
      "[paywall] react-native-iap is not in this binary. Rebuild the CN iOS client after installing react-native-iap."
    );
  }

  const iap = loadIap();
  if (!connected) {
    const ok = await iap.initConnection();
    if (!ok) {
      throw new Error("[paywall] StoreKit connection failed.");
    }
    connected = true;
  }
  return iap;
}

function productType(product: PaywallProduct): "in-app" | "subs" {
  return isMembershipCategory(product.category) ? "subs" : "in-app";
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Couldn't find product.";
}

export async function purchaseStoreKitProduct(product: PaywallProduct): Promise<PurchaseResult> {
  const assertCurrentSession = capturePaymentSession();
  const iap = await ensureStoreKitConnected();
  assertCurrentSession();
  const sku = product.storeProductId;
  const type = productType(product);
  const products = await iap.fetchProducts({ skus: [sku], type });
  assertCurrentSession();
  if (!products?.length) {
    throw new Error("Couldn't find product.");
  }

  await new Promise<void>((resolve, reject) => {
    const succeed = iap.purchaseUpdatedListener((purchase) => {
      if (purchase.productId !== sku) return;
      succeed.remove();
      fail.remove();
      void iap
        .finishTransaction({ purchase, isConsumable: type === "in-app" })
        .then(() => resolve())
        .catch(reject);
    });
    const fail = iap.purchaseErrorListener((error) => {
      succeed.remove();
      fail.remove();
      if (iap.isUserCancelledError(error)) {
        reject(new PurchaseCancelledError());
        return;
      }
      reject(new Error(errorMessage(error)));
    });
    void iap
      .requestPurchase({
        request: { apple: { sku } },
        type,
      })
      .catch((error: unknown) => {
        succeed.remove();
        fail.remove();
        if (iap.isUserCancelledError(error)) {
          reject(new PurchaseCancelledError());
          return;
        }
        reject(error instanceof Error ? error : new Error(errorMessage(error)));
      });
  });

  return { mocked: false, productId: sku };
}

export async function restoreStoreKitPurchases(): Promise<void> {
  const assertCurrentSession = capturePaymentSession();
  const iap = await ensureStoreKitConnected();
  assertCurrentSession();
  await iap.restorePurchases();
}
