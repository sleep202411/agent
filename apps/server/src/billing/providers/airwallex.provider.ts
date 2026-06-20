import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import type {
  CreateHostedCheckoutInput,
  CreatePaymentIntentInput,
  CreatePaymentIntentResult,
  CreateProviderRefundInput,
  CreateProviderRefundResult,
  HostedCheckoutResult,
  PaymentProviderAdapter,
  ProviderWebhookVerification,
  SyncProviderCouponInput,
  SyncProviderCouponResult,
  SyncProviderPriceInput,
  SyncProviderPriceResult,
} from './payment-provider';

interface AirwallexToken {
  value: string;
  expiresAt: number;
}

interface AirwallexCheckoutResponse {
  id?: string;
  url?: string;
  status?: string;
  billing_customer_id?: string;
  subscription_id?: string;
  invoice_id?: string;
  expires_at?: string;
  [key: string]: unknown;
}

interface AirwallexProductResponse {
  id?: string;
  [key: string]: unknown;
}

interface AirwallexPriceResponse {
  id?: string;
  [key: string]: unknown;
}

interface AirwallexCouponResponse {
  id?: string;
  [key: string]: unknown;
}

interface AirwallexRefundResponse {
  id?: string;
  request_id?: string;
  payment_intent_id?: string;
  status?: string;
  [key: string]: unknown;
}

interface AirwallexPaymentIntentResponse {
  id?: string;
  client_secret?: string;
  status?: string;
  [key: string]: unknown;
}

@Injectable()
export class AirwallexProvider implements PaymentProviderAdapter {
  readonly provider = PaymentProvider.airwallex;
  readonly capabilities = {
    hostedCheckout: true,
    subscriptionCheckout: true,
    paymentIntent: true,
    priceSync: true,
    couponSync: true,
    refund: true,
    webhookVerification: true,
  };
  private readonly logger = new Logger(AirwallexProvider.name);
  private token: AirwallexToken | null = null;

  async createHostedCheckout(
    input: CreateHostedCheckoutInput,
  ): Promise<HostedCheckoutResult> {
    const token = await this.getAccessToken();
    const lineItems = input.lineItems.map((item) => {
      if (!item.providerPriceId) {
        throw new ServiceUnavailableException({
          code: 'AIRWALLEX_PRICE_BINDING_INCOMPLETE',
          msg: `Airwallex price binding is missing provider_price_id for ${item.internalPriceId}.`,
        });
      }
      return {
        price_id: item.providerPriceId,
        quantity: item.quantity,
        ...(item.providerCouponId
          ? {
              discounts: [
                {
                  type: 'COUPON',
                  coupon: { id: item.providerCouponId },
                },
              ],
            }
          : {}),
      };
    });
    const body: Record<string, unknown> = {
      request_id: input.requestId,
      mode: input.mode,
      linked_payment_account_id: requiredEnv(
        'AIRWALLEX_LINKED_PAYMENT_ACCOUNT_ID',
      ),
      success_url: input.successUrl,
      back_url: input.backUrl,
      line_items: lineItems,
      // PAYMENT (one-off) checkouts must carry invoice_data — Airwallex builds a
      // one-off invoice on completion and rejects the create call without it
      // ("invoice_data must be provided for PAYMENT mode in checkout"). The
      // customer + collection are handled by the hosted checkout itself (mode +
      // linked_payment_account_id above), so the invoice only needs the order
      // currency (the fiat charge currency carried on the line items).
      // SUBSCRIPTION mode derives its invoice from the subscription, so skip it.
      ...(input.mode === 'PAYMENT'
        ? { invoice_data: { currency: input.lineItems[0]?.currency } }
        : {}),
      ...(input.providerCouponId
        ? {
            discounts: [
              {
                type: 'COUPON',
                coupon: { id: input.providerCouponId },
              },
            ],
          }
        : {}),
    };

    const checkout = await this.request<AirwallexCheckoutResponse>(
      '/api/v1/billing_checkouts/create',
      {
        method: 'POST',
        token,
        body,
      },
    );

    if (!checkout.id || !checkout.url) {
      throw new ServiceUnavailableException({
        code: 'AIRWALLEX_CHECKOUT_INVALID_RESPONSE',
        msg: 'Airwallex did not return a valid hosted checkout URL.',
      });
    }

    await this.attachCheckoutMetadata(checkout.id, input.metadata);

    return {
      providerCheckoutId: checkout.id,
      checkoutUrl: checkout.url,
      providerStatus: checkout.status ?? null,
      providerCustomerId: checkout.billing_customer_id ?? null,
      providerSubscriptionId: checkout.subscription_id ?? null,
      providerInvoiceId: checkout.invoice_id ?? null,
      expiresAt: parseDate(checkout.expires_at),
      raw: checkout,
    };
  }

  async createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<CreatePaymentIntentResult> {
    const token = await this.getAccessToken();
    // Payments product (/api/v1/pa), NOT billing_checkouts. Amount is in MAJOR
    // units (e.g. 10.00), so reuse minorToMajorNumber to avoid a 100x error. No
    // price_id / invoice_data / linked_payment_account_id here — those are
    // billing-product concepts and would 400 on the /pa namespace.
    const intent = await this.request<AirwallexPaymentIntentResponse>(
      '/api/v1/pa/payment_intents/create',
      {
        method: 'POST',
        token,
        body: {
          request_id: input.requestId,
          amount: minorToMajorNumber(input.amountMinor),
          currency: input.currency,
          merchant_order_id: input.merchantOrderId,
          ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
          // The webhook matcher keys off metadata.fizzdragon_order_id, so it MUST
          // be present for payment_intent.succeeded to fulfil the order.
          metadata: input.metadata,
        },
      },
    );
    if (!intent.id || !intent.client_secret) {
      throw new ServiceUnavailableException({
        code: 'AIRWALLEX_PAYMENT_INTENT_INVALID_RESPONSE',
        msg: 'Airwallex did not return a valid payment intent.',
      });
    }
    return {
      providerPaymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      providerStatus: intent.status ?? null,
      raw: intent,
    };
  }

  async syncPrice(
    input: SyncProviderPriceInput,
  ): Promise<SyncProviderPriceResult> {
    const token = await this.getAccessToken();
    const providerProductId =
      input.providerProductId ??
      (
        await this.request<AirwallexProductResponse>(
          '/api/v1/products/create',
          {
            method: 'POST',
            token,
            body: {
              request_id: randomUUID(),
              active: input.productActive,
              name: input.productName,
              description: input.productDescription ?? undefined,
            },
          },
        )
      ).id;
    if (!providerProductId) {
      throw new ServiceUnavailableException({
        code: 'AIRWALLEX_PRODUCT_INVALID_RESPONSE',
        msg: 'Airwallex did not return a product id.',
      });
    }

    const recurring =
      input.interval === 'one_time'
        ? null
        : {
            period: 1,
            period_unit: input.interval === 'month' ? 'MONTH' : 'YEAR',
          };
    const price = await this.request<AirwallexPriceResponse>(
      '/api/v1/prices/create',
      {
        method: 'POST',
        token,
        body: {
          request_id: randomUUID(),
          active: input.priceActive,
          billing_type: 'IN_ADVANCE',
          currency: input.currency,
          pricing_model: 'PER_UNIT',
          unit_amount: minorToMajorNumber(input.amountMinor),
          description: input.priceDescription ?? undefined,
          product_id: providerProductId,
          recurring,
        },
      },
    );
    if (!price.id) {
      throw new ServiceUnavailableException({
        code: 'AIRWALLEX_PRICE_INVALID_RESPONSE',
        msg: 'Airwallex did not return a price id.',
      });
    }
    return {
      providerProductId,
      providerPriceId: price.id,
      raw: price,
    };
  }

  async syncCoupon(
    input: SyncProviderCouponInput,
  ): Promise<SyncProviderCouponResult> {
    const token = await this.getAccessToken();
    const body: Record<string, unknown> = {
      request_id: input.requestId,
      active: input.active,
      name: input.name,
      description: input.description ?? undefined,
      // Absolute (fixed-amount) vs percentage coupon. The ABSOLUTE field shape
      // follows Airwallex's coupons API; verify against the live API before prod
      // reliance — a mismatch surfaces as a visible binding sync_error, not silent.
      ...(input.amountOffMinor != null
        ? {
            discount_model: 'ABSOLUTE',
            fixed_amount_discount: {
              amount: input.amountOffMinor / 100,
              currency: input.amountOffCurrency,
            },
          }
        : {
            discount_model: 'PERCENTAGE',
            percentage_off: (input.percentOffBps ?? 0) / 100,
          }),
      duration_type:
        input.durationType === 'forever'
          ? 'INDEFINITELY'
          : input.durationType === 'repeating'
            ? 'CUSTOM'
            : 'ONCE',
      expires_at: input.expiresAt?.toISOString(),
      metadata: input.metadata,
    };
    if (input.durationType === 'repeating') {
      body.duration = {
        period: input.durationCount,
        period_unit: durationUnitToAirwallex(input.durationUnit),
      };
    }

    const coupon = await this.request<AirwallexCouponResponse>(
      '/api/v1/coupons/create',
      {
        method: 'POST',
        token,
        body,
      },
    );
    if (!coupon.id) {
      throw new ServiceUnavailableException({
        code: 'AIRWALLEX_COUPON_INVALID_RESPONSE',
        msg: 'Airwallex did not return a coupon id.',
      });
    }
    return { providerCouponId: coupon.id, raw: coupon };
  }

  async createRefund(
    input: CreateProviderRefundInput,
  ): Promise<CreateProviderRefundResult> {
    const token = await this.getAccessToken();
    const refund = await this.request<AirwallexRefundResponse>(
      '/api/v1/pa/refunds/create',
      {
        method: 'POST',
        token,
        body: {
          request_id: input.requestId,
          payment_intent_id: input.providerPaymentIntentId,
          amount: minorToMajorNumber(input.amountMinor),
          reason: input.reason,
        },
      },
    );
    if (!refund.id) {
      throw new ServiceUnavailableException({
        code: 'AIRWALLEX_REFUND_INVALID_RESPONSE',
        msg: 'Airwallex did not return a refund id.',
      });
    }
    return {
      providerRefundId: refund.id,
      providerStatus: refund.status ?? null,
      providerPaymentIntentId:
        refund.payment_intent_id ?? input.providerPaymentIntentId,
      raw: refund,
    };
  }

  verifyWebhook(input: {
    rawBody: Buffer;
    timestamp?: string | string[];
    signature?: string | string[];
    testSecret?: string | string[];
  }): ProviderWebhookVerification {
    const secret =
      singleHeader(input.testSecret) || process.env.AIRWALLEX_WEBHOOK_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException({
          code: 'AIRWALLEX_WEBHOOK_SECRET_MISSING',
          msg: 'Airwallex webhook secret is not configured.',
        });
      }
      this.logger.warn(
        'Airwallex webhook signature skipped in non-production.',
      );
      return { ok: true, signatureSkipped: true };
    }

    const timestamp = singleHeader(input.timestamp);
    const signature = singleHeader(input.signature);
    if (!timestamp || !signature) {
      throw new UnauthorizedException({
        code: 'AIRWALLEX_WEBHOOK_SIGNATURE_MISSING',
        msg: 'Airwallex webhook signature headers are missing.',
      });
    }

    const expected = createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(timestamp), input.rawBody]))
      .digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const receivedBuffer = Buffer.from(signature, 'hex');
    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException({
        code: 'AIRWALLEX_WEBHOOK_SIGNATURE_INVALID',
        msg: 'Airwallex webhook signature verification failed.',
      });
    }

    const rawTimestamp = Number.parseInt(timestamp, 10);
    const timestampMs =
      rawTimestamp < 10_000_000_000 ? rawTimestamp * 1000 : rawTimestamp;
    if (
      Number.isFinite(timestampMs) &&
      Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000
    ) {
      throw new UnauthorizedException({
        code: 'AIRWALLEX_WEBHOOK_TIMESTAMP_STALE',
        msg: 'Airwallex webhook timestamp is outside the accepted tolerance.',
      });
    }

    return { ok: true, signatureSkipped: false };
  }

  private async attachCheckoutMetadata(
    checkoutId: string,
    metadata: Record<string, string>,
  ): Promise<void> {
    const token = await this.getAccessToken();
    await this.request(`/api/v1/billing_checkouts/${checkoutId}/update`, {
      method: 'POST',
      token,
      body: { metadata },
    });
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }

    const clientId = requiredEnv('AIRWALLEX_CLIENT_ID');
    const apiKey = requiredEnv('AIRWALLEX_API_KEY');
    const loginAs = process.env.AIRWALLEX_LOGIN_AS_ACCOUNT_ID;
    const response = await fetch(
      `${apiBaseUrl()}/api/v1/authentication/login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': clientId,
          'x-api-key': apiKey,
          ...(loginAs ? { 'x-login-as': loginAs } : {}),
        },
      },
    );

    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      throw new ServiceUnavailableException({
        code: 'AIRWALLEX_AUTH_FAILED',
        msg: `Airwallex authentication failed with status ${response.status}.`,
        details: body,
      });
    }

    const token =
      stringField(body, 'token') ?? stringField(body, 'access_token');
    if (!token) {
      throw new ServiceUnavailableException({
        code: 'AIRWALLEX_AUTH_INVALID_RESPONSE',
        msg: 'Airwallex authentication did not return an access token.',
      });
    }
    this.token = {
      value: token,
      expiresAt: Date.now() + 29 * 60 * 1000,
    };
    return token;
  }

  private async request<T = Record<string, unknown>>(
    path: string,
    options: {
      method: 'POST' | 'GET';
      token: string;
      body?: unknown;
    },
  ): Promise<T> {
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const body = (await response.json().catch(() => ({}))) as T;
    if (!response.ok) {
      throw new ServiceUnavailableException({
        code: 'AIRWALLEX_API_FAILED',
        msg: `Airwallex API ${path} failed with status ${response.status}.`,
        details: body,
      });
    }
    return body;
  }
}

function apiBaseUrl(): string {
  return (
    process.env.AIRWALLEX_API_BASE_URL?.replace(/\/$/, '') ??
    'https://api-demo.airwallex.com'
  );
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ServiceUnavailableException({
      code: 'AIRWALLEX_CONFIG_MISSING',
      msg: `${name} is required to create Airwallex checkouts.`,
    });
  }
  return value;
}

function singleHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function stringField(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const field = value[key];
  return typeof field === 'string' && field.trim() ? field : null;
}

function minorToMajorNumber(amountMinor: bigint): number {
  if (amountMinor < 0n || amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ServiceUnavailableException({
      code: 'AIRWALLEX_AMOUNT_OUT_OF_RANGE',
      msg: 'Airwallex amount is outside the safe supported range.',
    });
  }
  return Number(amountMinor) / 100;
}

function durationUnitToAirwallex(unit: string | null | undefined): string {
  switch (unit) {
    case 'day':
      return 'DAY';
    case 'week':
      return 'WEEK';
    case 'month':
      return 'MONTH';
    case 'year':
      return 'YEAR';
    default:
      throw new ServiceUnavailableException({
        code: 'AIRWALLEX_COUPON_DURATION_UNIT_INVALID',
        msg: 'Airwallex coupon duration unit is invalid.',
      });
  }
}
