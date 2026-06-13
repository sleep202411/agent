import { ServiceUnavailableException } from '@nestjs/common';
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

export interface CreatePaymentIntentInput {
  requestId: string;
  /** Charge amount in minor units (cents); the adapter converts to the provider's unit. */
  amountMinor: bigint;
  currency: string;
  /** Our internal order reference, surfaced to the provider for reconciliation. */
  merchantOrderId: string;
  /** Fallback URL the provider returns the shopper to if the client omits successUrl. */
  returnUrl?: string | null;
  metadata: Record<string, string>;
}

export interface CreatePaymentIntentResult {
  providerPaymentIntentId: string;
  /** Client secret the browser SDK needs to launch the hosted/embedded payment. */
  clientSecret: string;
  providerStatus?: string | null;
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

export interface PaymentProviderCapabilities {
  hostedCheckout: boolean;
  subscriptionCheckout: boolean;
  paymentIntent: boolean;
  priceSync: boolean;
  couponSync: boolean;
  refund: boolean;
  webhookVerification: boolean;
}

export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider;
  readonly capabilities: PaymentProviderCapabilities;
  createHostedCheckout(
    input: CreateHostedCheckoutInput,
  ): Promise<HostedCheckoutResult>;
  /**
   * Create an ad-hoc, arbitrary-amount payment intent (no catalog price /
   * provider-price binding). Optional: only providers that support one-off
   * intents (e.g. Airwallex Payments) implement it.
   */
  createPaymentIntent?(
    input: CreatePaymentIntentInput,
  ): Promise<CreatePaymentIntentResult>;
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

const unsupportedCapabilities: PaymentProviderCapabilities = {
  hostedCheckout: false,
  subscriptionCheckout: false,
  paymentIntent: false,
  priceSync: false,
  couponSync: false,
  refund: false,
  webhookVerification: false,
};

export class UnsupportedPaymentProvider implements PaymentProviderAdapter {
  readonly capabilities = unsupportedCapabilities;

  constructor(readonly provider: PaymentProvider) {}

  createHostedCheckout(): Promise<HostedCheckoutResult> {
    return Promise.reject(this.unavailable('hosted checkout'));
  }

  createPaymentIntent(): Promise<CreatePaymentIntentResult> {
    return Promise.reject(this.unavailable('payment intent'));
  }

  syncPrice(): Promise<SyncProviderPriceResult> {
    return Promise.reject(this.unavailable('price sync'));
  }

  syncCoupon(): Promise<SyncProviderCouponResult> {
    return Promise.reject(this.unavailable('coupon sync'));
  }

  createRefund(): Promise<CreateProviderRefundResult> {
    return Promise.reject(this.unavailable('refund'));
  }

  verifyWebhook(): ProviderWebhookVerification {
    throw this.unavailable('webhook verification');
  }

  private unavailable(capability: string): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
      msg: `Payment provider "${this.provider}" does not support ${capability} in this deployment yet.`,
    });
  }
}
