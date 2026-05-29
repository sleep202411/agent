import type { PaymentProvider } from '@prisma/client';

export interface ProviderCheckoutLineItem {
  providerPriceId?: string | null;
  internalPriceId: string;
  name: string;
  currency: string;
  amountMinor: bigint;
  quantity: number;
  providerCouponId?: string | null;
}

export interface CreateHostedCheckoutInput {
  requestId: string;
  mode: 'PAYMENT' | 'SUBSCRIPTION';
  successUrl: string;
  backUrl: string;
  lineItems: ProviderCheckoutLineItem[];
  metadata: Record<string, string>;
  providerCouponId?: string | null;
}

export interface HostedCheckoutResult {
  providerCheckoutId: string;
  checkoutUrl: string;
  providerStatus?: string | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  providerInvoiceId?: string | null;
  clientSecret?: string | null;
  expiresAt?: Date | null;
  raw: Record<string, unknown>;
}

export interface ProviderWebhookVerification {
  ok: true;
  signatureSkipped: boolean;
}

export interface SyncProviderPriceInput {
  requestId: string;
  productName: string;
  productDescription?: string | null;
  productActive: boolean;
  providerProductId?: string | null;
  priceDescription?: string | null;
  priceActive: boolean;
  currency: string;
  amountMinor: bigint;
  interval: 'one_time' | 'month' | 'year';
}

export interface SyncProviderPriceResult {
  providerProductId: string;
  providerPriceId: string;
  raw: Record<string, unknown>;
}

export interface SyncProviderCouponInput {
  requestId: string;
  name: string;
  description?: string | null;
  active: boolean;
  percentOffBps: number;
  durationType: 'once' | 'forever' | 'repeating';
  durationCount?: number | null;
  durationUnit?: string | null;
  expiresAt?: Date | null;
  metadata: Record<string, string>;
}

export interface SyncProviderCouponResult {
  providerCouponId: string;
  raw: Record<string, unknown>;
}

export interface CreateProviderRefundInput {
  requestId: string;
  providerPaymentIntentId: string;
  amountMinor: bigint;
  currency: string;
  reason: string;
  metadata: Record<string, string>;
}

export interface CreateProviderRefundResult {
  providerRefundId: string;
  providerStatus?: string | null;
  providerPaymentIntentId?: string | null;
  raw: Record<string, unknown>;
}

export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider;
  createHostedCheckout(
    input: CreateHostedCheckoutInput,
  ): Promise<HostedCheckoutResult>;
  syncPrice?(input: SyncProviderPriceInput): Promise<SyncProviderPriceResult>;
  syncCoupon?(
    input: SyncProviderCouponInput,
  ): Promise<SyncProviderCouponResult>;
  createRefund?(
    input: CreateProviderRefundInput,
  ): Promise<CreateProviderRefundResult>;
  verifyWebhook(input: {
    rawBody: Buffer;
    timestamp?: string | string[];
    signature?: string | string[];
    testSecret?: string | string[];
  }): ProviderWebhookVerification;
}
