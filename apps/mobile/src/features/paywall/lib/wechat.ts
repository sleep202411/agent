import { capturePaymentSession } from "./payment-session";
import { Platform } from "react-native";

import { webBaseUrl } from "@/config";

import {
  chargedAmountMinor,
  createBillingCheckout,
  createComputeCustomRecharge,
  formatCny,
  isOrderFulfilled,
  isWechatScanUrl,
  listMembershipPrices,
  type BillingCheckoutResult,
  type BillingPrice,
} from "./billing-api";
import type { PaywallProduct } from "./catalog";
import { currentCheckoutChannel } from "./checkout-channel";
import { assertPaymentReady, mustUseMockPayments } from "./paywall-config";
import type { PurchaseResult, WechatScanCheckout } from "./purchase-types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto;
  if (typeof cryptoObj?.randomUUID === "function") return cryptoObj.randomUUID();
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function returnUrls(): { successUrl: string; backUrl: string } {
  const url = `${webBaseUrl}/`;
  return { successUrl: url, backUrl: url };
}

function scanFromCheckout(result: BillingCheckoutResult): WechatScanCheckout | null {
  const url = result.paymentIntent?.checkoutUrl ?? null;
  if (isOrderFulfilled(result.order.status) && !isWechatScanUrl(url)) return null;
  if (!isWechatScanUrl(url)) {
    throw new Error("[paywall] WeChat checkout did not return a scan code.");
  }
  return { orderId: result.order.id, codeUrl: url };
}

async function createWechatScanCheckout(
  product: PaywallProduct
): Promise<WechatScanCheckout | null> {
  const assertCurrentSession = capturePaymentSession();
  const urls = returnUrls();
  const idempotencyKey = newIdempotencyKey();

  if (product.category === "compute_points") {
    const match = /^compute_points_custom_(\d+)$/.exec(product.id);
    const amount = match ? Number(match[1]) : NaN;
    if (!Number.isInteger(amount)) {
      throw new Error("[paywall] Enter a whole-yuan compute amount before paying.");
    }
    const result = await createComputeCustomRecharge({
      amountDollars: amount,
      idempotencyKey,
      ...urls,
    });
    return scanFromCheckout(result);
  }

  let priceId = product.billingPriceId;
  if (
    !priceId &&
    (product.category === "compute_membership" || product.category === "community_membership")
  ) {
    const prices = await listMembershipPrices({
      productType:
        product.category === "community_membership"
          ? "community_membership_plan"
          : "membership_plan",
      currency: "CNY",
    });
    const interval = product.interval ?? "month";
    const matches = prices.filter(
      (price) => price.interval === interval && price.currency === "CNY" && price.isActive !== false
    );
    // A missing interval must never silently buy another billing period. If
    // multiple plans match, the caller must supply its selected billingPriceId.
    if (matches.length !== 1) {
      throw new Error(
        "[paywall] No unique active CNY price matches the selected membership. Refresh the catalog and select a price."
      );
    }
    priceId = matches[0]!.id;
  }
  if (!priceId) {
    throw new Error("[paywall] No CNY WeChat price is available for this product.");
  }

  assertCurrentSession();
  const result = await createBillingCheckout({ priceId, idempotencyKey, ...urls });
  return scanFromCheckout(result);
}

export function communityPackProduct(price: BillingPrice): PaywallProduct {
  return {
    id: price.id,
    category: "community_points",
    storeProductId: price.id,
    billingPriceId: price.id,
    displayPrice: formatCny(chargedAmountMinor(price)),
    name: price.name,
    grantsPoints: price.grantsWalletAmount,
    interval: "one_time",
  };
}

/**
 * CN Android WeChat Pay: Nest Native 扫码 (same checkout as web). The caller
 * renders `wechatScan.codeUrl` as a QR and polls the order. APP支付 / H5 is not used.
 */
export async function purchaseWithWechat(product: PaywallProduct): Promise<PurchaseResult> {
  const channel = currentCheckoutChannel();
  assertPaymentReady(channel);
  if (Platform.OS === "web" || mustUseMockPayments(channel)) {
    await sleep(700);
    return { mocked: true, productId: product.storeProductId };
  }

  if (Platform.OS !== "android") {
    throw new Error("[paywall] WeChat Pay is only used on the CN Android build.");
  }

  const wechatScan = await createWechatScanCheckout(product);
  return {
    mocked: false,
    productId: product.billingPriceId ?? product.storeProductId,
    ...(wechatScan ? { wechatScan } : {}),
  };
}
