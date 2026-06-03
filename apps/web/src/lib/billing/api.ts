// Thin client for the NestJS billing endpoints (`/aurora/billing/*`).
//
// Community-point top-ups go through this path: list `community_point_pack`
// packages, create a hosted checkout, redirect to the provider (Airwallex),
// and the provider webhook credits the user's PG `community_point` wallet.
// Studio (AI generation) credits stay on the legacy Java path — see
// components/payment/credits-recharge-dialog.tsx.

import { api } from "@/src/lib/api";

/** A billing price row as returned by `GET /aurora/billing/prices`. */
export interface BillingPackage {
  id: string;
  code: string;
  name: string;
  description: string | null;
  productType: string;
  currency: string;
  /** Fiat charge in minor units (cents). */
  amountMinor: string;
  /** Wallet currency the purchase grants (e.g. `community_point`). */
  grantsWalletCurrency: string | null;
  /** Credits granted on payment, as an integer string. */
  grantsWalletAmount: string | null;
  isActive: boolean;
}

/** List active `community_point_pack` packages for the given fiat currency. */
export function listCommunityPointPackages(currency: string) {
  return api.get<{ provider: string; prices: BillingPackage[] }>("/aurora/billing/prices", {
    params: { productType: "community_point_pack", currency },
  });
}

export interface CreateBillingCheckoutInput {
  priceId: string;
  quantity?: number;
  idempotencyKey: string;
  successUrl: string;
  backUrl: string;
  promotionCode?: string;
}

export interface BillingCheckoutResult {
  order: { id: string; orderNo: string; status: string };
  paymentIntent: { checkoutUrl: string | null } | null;
}

/** Create a hosted checkout. Returns the provider checkout URL to redirect to. */
export function createBillingCheckout(input: CreateBillingCheckoutInput) {
  return api.post<BillingCheckoutResult>("/aurora/billing/checkout", { data: input });
}

export interface CreateCustomRechargeInput {
  /** Whole US dollars (server clamps to $10–$5000). */
  amountDollars: number;
  idempotencyKey: string;
  successUrl: string;
  backUrl: string;
}

/**
 * Result of an ad-hoc custom-amount recharge. Unlike the preset hosted checkout,
 * an Airwallex Payment Intent has no server-issued URL — the browser SDK launches
 * the hosted page from the intent id + client secret. `env` mirrors the server's
 * Airwallex environment so the SDK init matches (mismatch invalidates the secret).
 */
export interface CustomRechargeResult {
  order: { id: string; orderNo: string; status: string; currency: string };
  paymentIntent: {
    providerPaymentIntentId: string | null;
    clientSecret: string | null;
  } | null;
  shopperCountry: string;
  env: "demo" | "prod";
}

/** Create an arbitrary-amount community-point recharge via Airwallex Payment Intents. */
export function createCustomRecharge(input: CreateCustomRechargeInput) {
  return api.post<CustomRechargeResult>("/aurora/billing/recharge-custom", { data: input });
}
