import { Injectable, Logger } from '@nestjs/common';
import type { MediaObjectPlacement } from '@prisma/client';

export interface CdnPurgeInput {
  actionId: string;
  provider: string | null;
  cacheKey: string | null;
  url: string | null;
  placement: Pick<
    MediaObjectPlacement,
    | 'id'
    | 'assetId'
    | 'variantId'
    | 'role'
    | 'storageProvider'
    | 'bucket'
    | 'region'
    | 'objectKey'
    | 'externalUrl'
    | 'publicBaseUrl'
    | 'cdnProvider'
    | 'cdnCacheKey'
  >;
}

export interface CdnPurgeResult {
  providerTaskId: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Production CDN purge boundary.
 *
 * The app owns durable purge intent and retries; the concrete provider is
 * intentionally externalized because `.com` and `.cn` may sit behind different
 * CDNs. In production set MEDIA_CDN_PURGE_HTTP_ENDPOINT to a small purge
 * gateway that knows Azure CDN / Aliyun CDN credentials. Local development can
 * opt into MEDIA_CDN_PURGE_MODE=log for deterministic tests and manual QA.
 */
@Injectable()
export class CdnPurgeProvider {
  private readonly logger = new Logger(CdnPurgeProvider.name);

  async purge(input: CdnPurgeInput): Promise<CdnPurgeResult> {
    const mode = clean(process.env.MEDIA_CDN_PURGE_MODE);
    if (mode === 'log') {
      this.logger.warn(
        `MEDIA_CDN_PURGE_MODE=log accepted purge action=${input.actionId} provider=${input.provider ?? 'unmapped'} cacheKey=${input.cacheKey ?? 'none'}`,
      );
      return {
        providerTaskId: `local-log:${input.actionId}`,
        metadata: { mode: 'log' },
      };
    }

    const endpoint = clean(process.env.MEDIA_CDN_PURGE_HTTP_ENDPOINT);
    if (!endpoint) {
      throw new Error(
        'CDN purge provider is not configured. Set MEDIA_CDN_PURGE_HTTP_ENDPOINT, or set MEDIA_CDN_PURGE_MODE=log for local development only.',
      );
    }

    const timeoutMs = positiveInt(
      process.env.MEDIA_CDN_PURGE_HTTP_TIMEOUT_MS,
      15_000,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(toPayload(input)),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (!response.ok) {
        throw new Error(
          `CDN purge gateway failed with HTTP ${response.status}: ${errorMessage(payload)}`,
        );
      }
      return {
        providerTaskId:
          stringValue(payload?.taskId) ??
          stringValue(payload?.providerTaskId) ??
          null,
        metadata: payload ?? undefined,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    const token = clean(process.env.MEDIA_CDN_PURGE_HTTP_BEARER_TOKEN);
    if (token) headers.authorization = `Bearer ${token}`;
    const apiKey = clean(process.env.MEDIA_CDN_PURGE_HTTP_API_KEY);
    if (apiKey) headers['x-api-key'] = apiKey;
    return headers;
  }
}

function toPayload(input: CdnPurgeInput): Record<string, unknown> {
  return {
    actionId: input.actionId,
    provider: input.provider,
    cacheKey: input.cacheKey,
    url: input.url,
    placement: {
      id: input.placement.id,
      assetId: input.placement.assetId,
      variantId: input.placement.variantId,
      role: input.placement.role,
      storageProvider: input.placement.storageProvider,
      bucket: input.placement.bucket,
      region: input.placement.region,
      objectKey: input.placement.objectKey,
      externalUrl: input.placement.externalUrl,
      publicBaseUrl: input.placement.publicBaseUrl,
      cdnProvider: input.placement.cdnProvider,
      cdnCacheKey: input.placement.cdnCacheKey,
    },
  };
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(payload: Record<string, unknown> | null): string {
  return (
    stringValue(payload?.message) ??
    stringValue(payload?.msg) ??
    stringValue(payload?.error) ??
    'unknown error'
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
