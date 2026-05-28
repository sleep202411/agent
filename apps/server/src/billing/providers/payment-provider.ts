import type { PaymentProvider } from '@prisma/client';

export interface ProviderCheckoutLineItem {
  providerPriceId: string;
  quantity: number;
}

export interface CreateHostedCheckoutInput {
  requestId: string;
  mode: 'PAYMENT' | 'SUBSCRIPTION';
  successUrl: string;
  backUrl: string;
  lineItems: ProviderCheckoutLineItem[];
  metadata: Record<string, string>;
}

export interface HostedCheckoutResult {
  providerCheckoutId: string;
  checkoutUrl: string;
  providerStatus?: string | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  providerInvoiceId?: string | null;
  expiresAt?: Date | null;
  raw: Record<string, unknown>;
}

export interface ProviderWebhookVerification {
  ok: true;
  signatureSkipped: boolean;
}

export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider;
  createHostedCheckout(
    input: CreateHostedCheckoutInput,
  ): Promise<HostedCheckoutResult>;
  verifyWebhook(input: {
    rawBody: Buffer;
    timestamp?: string | string[];
    signature?: string | string[];
    testSecret?: string | string[];
  }): ProviderWebhookVerification;
}
