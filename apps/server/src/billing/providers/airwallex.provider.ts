import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  CreateHostedCheckoutInput,
  HostedCheckoutResult,
  PaymentProviderAdapter,
  ProviderWebhookVerification,
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

@Injectable()
export class AirwallexProvider implements PaymentProviderAdapter {
  readonly provider = PaymentProvider.airwallex;
  private readonly logger = new Logger(AirwallexProvider.name);
  private token: AirwallexToken | null = null;

  async createHostedCheckout(
    input: CreateHostedCheckoutInput,
  ): Promise<HostedCheckoutResult> {
    const token = await this.getAccessToken();
    const body: Record<string, unknown> = {
      request_id: input.requestId,
      mode: input.mode,
      legal_entity_id: requiredEnv('AIRWALLEX_LEGAL_ENTITY_ID'),
      linked_payment_account_id: requiredEnv(
        'AIRWALLEX_LINKED_PAYMENT_ACCOUNT_ID',
      ),
      success_url: input.successUrl,
      back_url: input.backUrl,
      line_items: input.lineItems.map((item) => ({
        price_id: item.providerPriceId,
        quantity: item.quantity,
      })),
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
