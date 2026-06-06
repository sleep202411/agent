"use client";

import { api } from "@/src/lib/api";

export type ComputeTopupProvider = "airwallex" | "wechat_pay" | "alipay";

export interface ComputeTopupPrice {
  id: string;
  itemId: string;
  productType: "compute_point_pack";
  code: string;
  name: string;
  description: string | null;
  provider: ComputeTopupProvider;
  availableProviders: Array<{
    provider: ComputeTopupProvider;
    status: string;
    providerMode: string | null;
  }>;
  currency: string;
  amountMinor: string;
  interval: "one_time";
  subjectType: "user";
  grantsWalletCurrency: "compute_point";
  grantsWalletBalanceKind: "consumable";
  grantsWalletAmount: string;
  isActive: boolean;
  metadata: Record<string, unknown>;
}

export interface ComputeTopupCatalog {
  provider: ComputeTopupProvider;
  providers: ComputeTopupProvider[];
  currency: string;
  cell: "global" | "cn";
  exchangeRate: {
    computePointsPerUsdCent: number;
    usdCentsPerComputePoint: number;
  } | null;
  rateMode: "usd_cent_anchor" | "explicit_admin_pricing";
  prices: ComputeTopupPrice[];
}

export interface ComputeWalletAccount {
  id: string;
  ownerType: "user" | "workspace";
  ownerId: string;
  currency: "compute_point";
  balanceKind: "consumable";
  status: string;
  availableBalance: string;
  heldBalance: string;
  updatedAt: string;
}

export interface ComputeWalletLedgerData {
  accounts: ComputeWalletAccount[];
  entries: Array<{
    id: string;
    transactionId: string;
    amount: string;
    availableDelta: string;
    availableBalanceAfter: string;
    reason: string;
    description: string | null;
    createdAt: string;
  }>;
}

export interface CreateComputeTopupInput {
  priceId: string;
  provider?: ComputeTopupProvider;
  promotionCode?: string;
  idempotencyKey: string;
  successUrl: string;
  backUrl: string;
}

export interface ComputeTopupResult {
  order: {
    id: string;
    orderNo: string;
    status: string;
    provider: string;
    currency: string;
    amountMinor: string;
    subtotalAmountMinor: string;
    discountAmountMinor: string;
    grantsWalletAmount: string | null;
  };
  paymentIntent: {
    id: string;
    provider: string;
    checkoutUrl: string | null;
    clientSecret: string | null;
    providerPaymentIntentId: string | null;
  } | null;
  shopperCountry: string;
  env: "demo" | "prod";
}

export async function listComputeTopupPackages(): Promise<ComputeTopupCatalog> {
  return api.get<ComputeTopupCatalog>("/aurora/billing/compute-topup-packages");
}

export async function getComputeWalletLedger(): Promise<ComputeWalletLedgerData> {
  return api.get<ComputeWalletLedgerData>("/aurora/billing/wallet-ledger", {
    params: { currency: "compute_point", balanceKind: "consumable", limit: 12 },
  });
}

export async function createComputeTopup(input: CreateComputeTopupInput) {
  return api.post<ComputeTopupResult>("/aurora/billing/compute-topup", { data: input });
}
