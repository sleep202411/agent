import { appEnv } from "@/config";

import type { CheckoutChannel } from "./checkout-channel";
import type { PaywallCategory } from "./paywall-store";

export type BillingInterval = "month" | "year" | "one_time";

export type PaywallProduct = {
  id: string;
  category: PaywallCategory;
  /** App Store / Play / RevenueCat product identifier. */
  storeProductId: string;
  /**
   * Nest billing price id for WeChat Native checkout. Set when the paywall
   * loaded `community_point_pack` / membership prices from `/billing/prices`.
   */
  billingPriceId?: string;
  displayPrice: string;
  /** Server catalog name, when this row came from `/billing/prices`. */
  name?: string;
  /** Whole points granted; null for memberships. */
  grantsPoints: string | null;
  interval?: BillingInterval;
};

/** Studio billing chips — shortcuts into a custom $10–$5,000 (or ¥) amount. */
export const COMPUTE_RECHARGE_PRESETS = [10, 50, 100, 500] as const;
export const COMPUTE_RECHARGE_MIN = 10;
export const COMPUTE_RECHARGE_MAX = 5000;
export const COMPUTE_RECHARGE_DEFAULT = "50";

/** CN WeChat: ¥7 = 100 credits. Global Airwallex: 1 credit = 1 USD cent. */
export function isCnComputeRecharge(): boolean {
  return appEnv.appRegion === "cn";
}

export function computeRechargeCurrencySymbol(): "$" | "¥" {
  return isCnComputeRecharge() ? "¥" : "$";
}

function computeMinorPerPoint(): number {
  return isCnComputeRecharge() ? 7 : 1;
}

export function parseComputeRechargeAmount(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < COMPUTE_RECHARGE_MIN || amount > COMPUTE_RECHARGE_MAX) {
    return null;
  }
  return amount;
}

export function estimatedComputeCredits(amount: number): number {
  return Math.floor((amount * 100) / computeMinorPerPoint());
}

/** One-shot product for the current custom amount (mock / WeChat / IAP plumbing). */
export function computeCustomProduct(amountText: string): PaywallProduct | null {
  const amount = parseComputeRechargeAmount(amountText);
  if (amount == null) return null;
  const credits = estimatedComputeCredits(amount);
  const symbol = computeRechargeCurrencySymbol();
  return {
    id: `compute_points_custom_${amount}`,
    category: "compute_points",
    storeProductId: `compute_points_custom_${amount}`,
    displayPrice: `${symbol}${amount}`,
    grantsPoints: String(credits),
  };
}

const COMPUTE_MEMBERSHIP: PaywallProduct[] = [
  {
    id: "compute_membership_month",
    category: "compute_membership",
    storeProductId: "compute_membership_month",
    displayPrice: "$9.99",
    grantsPoints: null,
    interval: "month",
  },
];

/**
 * Community-point packs always load from Nest `/billing/prices`.
 * StoreKit / Play product ids are derived as `com.fizzdragon.community.credits.{points}`.
 */
const BY_CATEGORY: Record<PaywallCategory, PaywallProduct[]> = {
  community_points: [],
  compute_points: [],
  compute_membership: COMPUTE_MEMBERSHIP,
  community_membership: [],
};

function priceAmount(price: string): number {
  const value = Number(price.replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

/** Annual savings vs 12× monthly, same rounding as the web membership dialog. */
export function yearlySavePercent(products: PaywallProduct[]): number {
  const monthly = products.find((item) => item.interval === "month");
  const yearly = products.find((item) => item.interval === "year");
  if (!monthly || !yearly) return 0;
  const month = priceAmount(monthly.displayPrice);
  const year = priceAmount(yearly.displayPrice);
  if (month <= 0 || year <= 0) return 0;
  return Math.max(0, Math.round((1 - year / (month * 12)) * 100));
}

export function isMembershipCategory(category: PaywallCategory): boolean {
  return category === "community_membership" || category === "compute_membership";
}

/** Products shown on the paywall. Hidden IAP categories stay in BY_CATEGORY. */
export function productsForCategory(category: PaywallCategory): PaywallProduct[] {
  return BY_CATEGORY[category];
}

/**
 * Native checkout rails load community packs from Nest (region currency).
 * `web` still sends the user to the site — no in-app catalog.
 */
export function communityPointsUseBillingApi(channel: CheckoutChannel): boolean {
  return channel === "wechat" || channel === "apple_iap" || channel === "google_play_iap";
}

/** App Store / Play consumable id, e.g. 5000 points → `com.fizzdragon.community.credits.5000`. */
export function communityStoreProductId(grantsPoints: string | null | undefined): string | null {
  if (!grantsPoints || !/^[1-9]\d*$/.test(grantsPoints)) return null;
  return `com.fizzdragon.community.credits.${grantsPoints}`;
}
