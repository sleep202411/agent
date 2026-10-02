import { Injectable, Logger } from '@nestjs/common';
import { RPCClient } from '@alicloud/pop-core';
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

/** Aliyun RefreshObjectCaches accepts at most 100 URLs per call. */
export const ALIYUN_CDN_REFRESH_MAX_URLS = 100;
const ALIYUN_CDN_REQUEST_TIMEOUT_MS = 15_000;

type CdnPurgeMode = 'log' | 'http' | 'aliyun';

/**
 * Production CDN purge boundary.
 *
 * The app owns durable purge intent and retries; the concrete provider is
 * selected by MEDIA_CDN_PURGE_MODE because `.com` and `.cn` sit behind
 * different CDNs:
 * - `http` (or unset): POST to MEDIA_CDN_PURGE_HTTP_ENDPOINT, a small purge
 *   gateway that knows the CDN credentials;
 * - `aliyun`: call Aliyun CDN `RefreshObjectCaches` directly (the .cn
 *   `media.fizzspace.cn` domain). Credentials default to the OSS key pair of
 *   the same account (ALIYUN_CDN_ACCESS_KEY_* override it), which needs the
 *   `cdn:RefreshObjectCaches` RAM permission;
 * - `log`: local development only — accept and log, for deterministic tests
 *   and manual QA.
 */
@Injectable()
export class CdnPurgeProvider {
  private readonly logger = new Logger(CdnPurgeProvider.name);
  private aliyunClient: RPCClient | null = null;

  async purge(input: CdnPurgeInput): Promise<CdnPurgeResult> {
    const mode = purgeMode();
    if (mode === 'aliyun') {
      if (!input.url) {
        throw new Error(
          'Aliyun CDN refresh needs the public URL of the purged object; the placement URL could not be resolved.',
        );
      }
      return {
        providerTaskId: await this.refreshFiles([input.url]),
        metadata: { mode: 'aliyun' },
      };
    }
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
      // Reading failures (including aborts) must reach the worker's retry path.
      // Only JSON syntax is optional: some gateways acknowledge with no body.
      const text = await response.text();
      let payload: Record<string, unknown> | null;
      try {
        payload = JSON.parse(text) as Record<string, unknown> | null;
      } catch {
        payload = null;
      }
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

  /**
   * Refresh up to {@link ALIYUN_CDN_REFRESH_MAX_URLS} cached files by URL on
   * the Aliyun CDN. Returns the refresh task id. Provider errors are rethrown
   * with Aliyun's code and message verbatim.
   */
  async refreshFiles(urls: string[]): Promise<string> {
    if (purgeMode() !== 'aliyun') {
      throw new Error(
        'CDN file refresh requires MEDIA_CDN_PURGE_MODE=aliyun in this deployment.',
      );
    }
    if (urls.length === 0 || urls.length > ALIYUN_CDN_REFRESH_MAX_URLS) {
      throw new Error(
        `Aliyun CDN refresh takes 1-${ALIYUN_CDN_REFRESH_MAX_URLS} URLs per request (got ${urls.length}).`,
      );
    }
    let response: { RefreshTaskId?: string; RequestId?: string };
    try {
      response = await this.aliyun().request<{
        RefreshTaskId?: string;
        RequestId?: string;
      }>(
        'RefreshObjectCaches',
        { ObjectPath: urls.join('\n'), ObjectType: 'File' },
        { method: 'POST', timeout: ALIYUN_CDN_REQUEST_TIMEOUT_MS },
      );
    } catch (err) {
      throw new Error(
        `Aliyun CDN RefreshObjectCaches failed: ${aliyunErrorCode(err)}: ${aliyunErrorMessage(err)}`,
      );
    }
    const taskId = stringValue(response?.RefreshTaskId);
    if (!taskId) {
      throw new Error(
        `Aliyun CDN RefreshObjectCaches returned no RefreshTaskId (req=${response?.RequestId ?? '?'}).`,
      );
    }
    return taskId;
  }

  /**
   * Fail loud when a cell that depends on CDN file refresh is not set up for
   * it. Names every missing setting at once.
   */
  assertAliyunRefreshConfigured(context: string): void {
    const { accessKeyId, accessKeySecret } = aliyunCdnCredentials();
    const missing = [
      ...(purgeMode() === 'aliyun' ? [] : ['MEDIA_CDN_PURGE_MODE=aliyun']),
      ...(accessKeyId ? [] : ['ALIYUN_CDN_ACCESS_KEY_ID|OSS_ACCESS_KEY_ID']),
      ...(accessKeySecret
        ? []
        : ['ALIYUN_CDN_ACCESS_KEY_SECRET|OSS_ACCESS_KEY_SECRET']),
    ];
    if (missing.length > 0) {
      throw new Error(`${context} requires: ${missing.join(', ')}`);
    }
  }

  private aliyun(): RPCClient {
    if (this.aliyunClient) return this.aliyunClient;
    const { accessKeyId, accessKeySecret } = aliyunCdnCredentials();
    if (!accessKeyId || !accessKeySecret) {
      throw new Error(
        'Aliyun CDN refresh requires ALIYUN_CDN_ACCESS_KEY_ID/SECRET or OSS_ACCESS_KEY_ID/SECRET.',
      );
    }
    this.aliyunClient = new RPCClient({
      accessKeyId,
      accessKeySecret,
      endpoint:
        clean(process.env.ALIYUN_CDN_ENDPOINT) ?? 'https://cdn.aliyuncs.com',
      apiVersion: '2018-05-10',
    });
    return this.aliyunClient;
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

function purgeMode(): CdnPurgeMode {
  const mode = clean(process.env.MEDIA_CDN_PURGE_MODE)?.toLowerCase() ?? 'http';
  if (mode === 'log' || mode === 'http' || mode === 'aliyun') return mode;
  throw new Error(
    `MEDIA_CDN_PURGE_MODE must be log, http or aliyun (got "${mode}").`,
  );
}

/** The CDN key pair; defaults to the OSS keys of the same Aliyun account. */
function aliyunCdnCredentials(): {
  accessKeyId: string | null;
  accessKeySecret: string | null;
} {
  return {
    accessKeyId:
      clean(process.env.ALIYUN_CDN_ACCESS_KEY_ID) ??
      clean(process.env.OSS_ACCESS_KEY_ID),
    accessKeySecret:
      clean(process.env.ALIYUN_CDN_ACCESS_KEY_SECRET) ??
      clean(process.env.OSS_ACCESS_KEY_SECRET),
  };
}

/** pop-core puts Aliyun's error code on `code` (transport errors on `name`). */
function aliyunErrorCode(err: unknown): string {
  const error = err as { code?: unknown; name?: unknown } | null;
  return stringValue(error?.code) ?? stringValue(error?.name) ?? 'UnknownError';
}

/** Aliyun's own message from the error body, else the transport message. */
function aliyunErrorMessage(err: unknown): string {
  const data = (err as { data?: { Message?: unknown } } | null)?.data;
  return (
    stringValue(data?.Message) ??
    (err instanceof Error ? err.message : String(err))
  );
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
