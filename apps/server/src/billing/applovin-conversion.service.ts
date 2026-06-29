/**
 * AppLovin (Axon) server-side Conversions API client.
 *
 * Reports web purchases to AppLovin's Event API (server-to-server), the
 * authoritative + ad-blocker-proof counterpart to the browser Axon pixel. Used
 * for AppLovin web-ad optimisation + ROAS on the international (.com) side.
 *
 * Spec (verified against AppLovin official docs 2026-06-29):
 *   POST https://b.applovin.com/v1/event?pixel_id=<PIXEL_ID>
 *   Header: Authorization: <Conversions API access token>
 *   Body:   { "events": [ <event> ] }
 * Event (purchase):
 *   { event_time (unix ms), event_source_url, name:"purchase", dedupe_id,
 *     user_data:{ aleid, client_ip_address?, client_user_agent?, country_code?,
 *                 esi:"web", email?(sha256), phone?(sha256) },
 *     data:{ currency, value, transaction_id, shipping, tax } }
 * Dedup: AppLovin merges this server event with the browser pixel's purchase
 *   event when both carry an identical `dedupe_id` AND arrive within 5 minutes
 *   (use the order id). Past 5 min the later duplicate is dropped — so we always
 *   pass the order id as both `dedupe_id` and `transaction_id`.
 *   Refs: support.applovin.com/.../api/conversions-api-for-partners
 *         support.applovin.com/.../track-and-optimize/deduplicating-events
 *
 * CN-dead: AppLovin has no China presence; gate callers to the .com cell.
 * No-op + warn-once when AXON_CAPI_ACCESS_TOKEN / AXON_PIXEL_ID are unset, so
 * the integration ships inert until the token is provisioned (Axon dashboard →
 * Account → General → Keys) — mirroring the browser pixel's env gate.
 */
import { Injectable, Logger } from '@nestjs/common';

const DEFAULT_BASE_URL = 'https://b.applovin.com';
const REQUEST_TIMEOUT_MS = 10_000;

export interface AppLovinPurchaseInput {
  /** Stable order id — used as BOTH transaction_id and dedupe_id (pixel match). */
  orderId: string;
  /** ISO-4217 fiat currency actually charged (e.g. "USD"). */
  currency: string;
  /** Monetary value in MAJOR units (e.g. dollars), i.e. amountMinor / 100. */
  value: number;
  /** AppLovin click id, captured browser-side (?aleid / _axeid cookie). May be
   *  absent if the buyer didn't arrive from an AppLovin ad — the event is still
   *  reported (AppLovin ignores unattributable conversions). */
  aleid?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
  /** ISO 3166 billing country code, if known. */
  countryCode?: string | null;
  /** Full URL where the conversion originated (the checkout/return page). */
  eventSourceUrl?: string | null;
  /** Unix epoch ms; defaults to now. */
  eventTimeMs?: number;
}

@Injectable()
export class AppLovinConversionService {
  private readonly logger = new Logger(AppLovinConversionService.name);
  private warnedUnconfigured = false;

  private config(): { token: string; pixelId: string; baseUrl: string } | null {
    const token = (process.env.AXON_CAPI_ACCESS_TOKEN ?? '').trim();
    const pixelId = (
      process.env.AXON_PIXEL_ID ??
      process.env.NEXT_PUBLIC_AXON_PIXEL_KEY ??
      ''
    ).trim();
    if (!token || !pixelId) {
      if (!this.warnedUnconfigured) {
        this.warnedUnconfigured = true;
        this.logger.warn(
          'AXON_CAPI_ACCESS_TOKEN / AXON_PIXEL_ID unset — AppLovin S2S purchase reporting is a no-op.',
        );
      }
      return null;
    }
    const baseUrl = (process.env.AXON_API_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      '',
    );
    return { token, pixelId, baseUrl };
  }

  /** True when the S2S credentials are present (i.e. on a configured .com cell). */
  isConfigured(): boolean {
    return this.config() != null;
  }

  /**
   * Report a completed web purchase. Best-effort: NEVER throws — a failure here
   * must not affect order fulfilment. Returns true if AppLovin accepted it.
   */
  async reportWebPurchase(input: AppLovinPurchaseInput): Promise<boolean> {
    const config = this.config();
    if (!config) return false;

    const userData: Record<string, unknown> = { esi: 'web' };
    if (input.aleid) userData.aleid = input.aleid;
    if (input.clientIpAddress)
      userData.client_ip_address = input.clientIpAddress;
    if (input.clientUserAgent)
      userData.client_user_agent = input.clientUserAgent;
    if (input.countryCode) userData.country_code = input.countryCode;

    const body = {
      events: [
        {
          event_time: input.eventTimeMs ?? Date.now(),
          event_source_url: input.eventSourceUrl ?? undefined,
          name: 'purchase',
          dedupe_id: input.orderId,
          user_data: userData,
          data: {
            currency: input.currency,
            value: input.value,
            transaction_id: input.orderId,
            shipping: 0,
            tax: 0,
          },
        },
      ],
    };

    const url = `${config.baseUrl}/v1/event?pixel_id=${encodeURIComponent(config.pixelId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          // Per AppLovin docs the access token is the raw Authorization value
          // (no "Bearer" prefix). If a live call returns 401, this is the one
          // line to revisit.
          Authorization: config.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(
          `AppLovin S2S purchase rejected (order=${input.orderId}) status=${res.status} body=${text.slice(0, 500)}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(
        `AppLovin S2S purchase failed (order=${input.orderId}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
