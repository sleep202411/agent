import { Injectable } from '@nestjs/common';
import { falError, mapFalHttpError } from './fal-error.mapper';
import type { FalProviderConfig } from './fal-config.service';
import type {
  FalPricingResponse,
  FalRequestListResponse,
  FalStatusResponse,
  FalSubmitResponse,
} from './fal.types';

export interface FalJsonResponse<T> {
  body: T;
  headers: Record<string, string>;
  ok: boolean;
  status: number;
}

@Injectable()
export class FalClient {
  async submit(
    config: FalProviderConfig,
    endpointId: string,
    body: Record<string, unknown>,
  ): Promise<FalSubmitResponse> {
    return this.requestJson(config, `${config.queueBaseUrl}/${endpointId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async status(
    config: FalProviderConfig,
    endpointId: string,
    requestId: string,
    statusUrl?: string | null,
  ): Promise<FalStatusResponse> {
    return this.requestJson(
      config,
      statusUrl ??
        `${config.queueBaseUrl}/${endpointId}/requests/${requestId}/status`,
      { method: 'GET' },
    );
  }

  async response(
    config: FalProviderConfig,
    endpointId: string,
    requestId: string,
    responseUrl?: string | null,
  ): Promise<FalJsonResponse<unknown>> {
    return this.requestJsonWithHeaders(
      config,
      responseUrl ??
        `${config.queueBaseUrl}/${endpointId}/requests/${requestId}`,
      { method: 'GET' },
      { allowErrorBody: true },
    );
  }

  async pricing(
    config: FalProviderConfig,
    endpointId: string,
  ): Promise<FalPricingResponse> {
    const url = new URL(`${config.apiBaseUrl}/models/pricing`);
    url.searchParams.set('endpoint_id', endpointId);
    return this.requestJson(config, url.toString(), { method: 'GET' });
  }

  async requestByEndpoint(
    config: FalProviderConfig,
    endpointId: string,
    requestId: string,
  ): Promise<FalRequestListResponse> {
    const url = new URL(`${config.apiBaseUrl}/models/requests/by-endpoint`);
    url.searchParams.set('endpoint_id', endpointId);
    url.searchParams.set('request_id', requestId);
    url.searchParams.set('expand', 'payloads');
    return this.requestJson(config, url.toString(), { method: 'GET' });
  }

  async cancel(
    config: FalProviderConfig,
    endpointId: string,
    requestId: string,
    cancelUrl?: string | null,
  ): Promise<void> {
    await this.requestJson(
      config,
      cancelUrl ??
        `${config.queueBaseUrl}/${endpointId}/requests/${requestId}/cancel`,
      { method: 'PUT' },
    );
  }

  private async requestJson<T>(
    config: FalProviderConfig,
    url: string,
    init: RequestInit,
  ): Promise<T> {
    return (await this.requestJsonWithHeaders<T>(config, url, init)).body;
  }

  private async requestJsonWithHeaders<T>(
    config: FalProviderConfig,
    url: string,
    init: RequestInit,
    options: { allowErrorBody?: boolean } = {},
  ): Promise<FalJsonResponse<T>> {
    if (!config.apiKey) {
      throw falError(
        'PROVIDER_NOT_CONFIGURED',
        'FAL_API_KEY / FAL_KEY unset',
        'This model is temporarily unavailable.',
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    let response: Response;
    let raw: string;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Key ${config.apiKey}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      raw = await response.text().catch(() => '');
      controller.signal.throwIfAborted();
    } catch (err) {
      if (
        controller.signal.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        throw falError(
          'PROVIDER_TIMEOUT',
          `fal.ai request timed out after ${config.requestTimeoutMs}ms`,
          'The generation provider timed out. Please try again.',
        );
      }
      throw falError(
        'UNKNOWN',
        err instanceof Error ? err.message : 'fal.ai request failed',
      );
    } finally {
      clearTimeout(timer);
    }

    const body = parseFalBody(raw) as T;

    if (!response.ok && !options.allowErrorBody) {
      throw mapFalHttpError(response.status, raw);
    }

    return {
      body,
      headers: responseHeaders(response.headers),
      ok: response.ok,
      status: response.status,
    };
  }
}

function parseFalBody(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function responseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    const normalized = key.toLowerCase();
    if (
      normalized.startsWith('x-fal-') ||
      normalized === 'content-type' ||
      normalized === 'retry-after'
    ) {
      out[normalized] = value;
    }
  }
  return out;
}
